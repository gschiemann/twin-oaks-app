"use server";

import { redirect } from "next/navigation";
import { attachExpenseToBankTransaction } from "@/app/banking/link-expense";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { ALL_DIVISIONS, TAX_STATUSES } from "@/lib/domain";
import { splitByCategory } from "../receipts/receipt-lines";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

async function expenseDataFromForm(accountId: string, formData: FormData) {
  const date = parseDateInput(formData.get("date")) ?? new Date();
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const description = str(formData.get("description"));
  const division = str(formData.get("division"));
  const accountingCategory = str(formData.get("accountingCategory"));

  if (amountCents == null || !description || !accountingCategory) return null;
  if (!division || !(ALL_DIVISIONS as readonly string[]).includes(division)) return null;

  const taxStatus = str(formData.get("taxStatus"));
  const vendorName = str(formData.get("vendorName"));

  // Vendors dedupe by name (per account) so reports can group by vendor.
  let vendorId: string | null = null;
  if (vendorName) {
    const vendor = await prisma.vendor.upsert({
      where: { accountId_name: { accountId, name: vendorName } },
      create: { accountId, name: vendorName },
      update: {},
    });
    vendorId = vendor.id;
  }

  return {
    accountId,
    date,
    taxYear: taxYearOf(date),
    amountCents,
    description,
    division,
    accountingCategory,
    vendorId,
    vendorName,
    salesTaxCents: parseDollarsToCents(formData.get("salesTax")),
    paymentMethod: str(formData.get("paymentMethod")),
    managementCategory: str(formData.get("managementCategory")),
    businessPurpose: str(formData.get("businessPurpose")),
    assetId: str(formData.get("assetId")),
    notes: str(formData.get("notes")),
    // Tax-safety principle (SPEC §1): default is NEEDS_REVIEW, never
    // silently "deductible".
    taxStatus:
      taxStatus && (TAX_STATUSES as readonly string[]).includes(taxStatus)
        ? taxStatus
        : "NEEDS_REVIEW",
    isCapital: formData.get("isCapital") === "on",
  };
}

export async function createExpense(formData: FormData) {
  const accountId = await requireAccountId();
  // Categorizing straight from a receipt links the original document and
  // completes the Inbox → Categorized flow (SPEC §4). Read BEFORE the
  // validation bounce below, so a typo'd amount can't silently orphan the
  // receipt it came from.
  const fromReceiptId = str(formData.get("fromReceiptId"));
  // Same reasoning for a bank line: read it BEFORE the bounce so a typo'd
  // amount can't leave the transaction stranded on the review list.
  const fromBankTxn = str(formData.get("fromBankTxn"));
  const data = await expenseDataFromForm(accountId, formData);
  if (!data) {
    // Hand the typed values straight back so nothing has to be retyped.
    const back = new URLSearchParams({ error: "missing" });
    if (fromReceiptId) back.set("fromReceipt", fromReceiptId);
    if (fromBankTxn) back.set("fromBankTxn", fromBankTxn);
    for (const [key, field] of [["d", "description"], ["v", "vendorName"], ["a", "amount"]]) {
      const value = str(formData.get(field));
      if (value) back.set(key, value.slice(0, 200));
    }
    redirect(`/expenses/new?${back.toString()}`);
  }

  const expense = await prisma.expense.create({ data });

  if (fromReceiptId) {
    await prisma.receipt
      .updateMany({
        where: { id: fromReceiptId, accountId },
        data: {
          expenseId: expense.id,
          status: "CATEGORIZED",
          vendorName: data.vendorName ?? undefined,
          totalCents: data.amountCents,
          receiptDate: data.date,
        },
      })
      .catch(() => {}); // receipt may have been archived meanwhile — expense still stands
  }

  if (fromBankTxn) {
    // Never throws — a failed link must not undo a save that already worked.
    await attachExpenseToBankTransaction(accountId, fromBankTxn, expense.id);
    redirect("/banking?matched=1");
  }

  // Categorizing from the Inbox drops you back in the Inbox to do the next
  // one; everything else lands on the Expenses list. Never a dead-end page.
  redirect(fromReceiptId ? "/receipts?categorized=1" : "/expenses?saved=1");
}

// FR-006 — one receipt, several categories, one expense each.
//
// NEVER automatic. This runs only when the operator taps the split button on
// the categorize screen, and that button only exists when the receipt's own
// lines name two or more accounting categories. The single-expense path is
// untouched and remains the default.
//
// Every guarantee createExpense makes still holds here: the receipt id is
// read BEFORE anything can bounce, a rejected split lands on a form that says
// why, and a successful one links the receipt, marks it CATEGORIZED, and
// finishes on the Inbox with the same confirmation.
export async function createSplitExpensesFromReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  // Read first — a validation bounce must never orphan the receipt it came
  // from (same reason as createExpense).
  const fromReceiptId = str(formData.get("fromReceiptId"));
  if (!fromReceiptId) redirect("/expenses/new?error=missing");

  const receipt = await prisma.receipt.findFirst({ where: { id: fromReceiptId, accountId } });
  if (!receipt) redirect("/expenses/new?error=missing");

  const bounce = `/expenses/new?fromReceipt=${fromReceiptId}&error=split`;

  const division = str(formData.get("division"));
  if (!division || !(ALL_DIVISIONS as readonly string[]).includes(division)) redirect(bounce);

  const lines = await prisma.receiptLine.findMany({
    where: { receiptId: receipt.id, accountId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const parts = splitByCategory(lines);
  // Nothing to split — the operator should use the ordinary form.
  if (parts.length < 2) redirect(bounce);

  // The receipt's own day keeps every part on the date of the purchase.
  const date = receipt.receiptDate ?? new Date();
  const vendorName = receipt.vendorName;

  // Vendors dedupe by name (per account), exactly like the single path.
  let vendorId: string | null = null;
  if (vendorName) {
    const vendor = await prisma.vendor.upsert({
      where: { accountId_name: { accountId, name: vendorName } },
      create: { accountId, name: vendorName },
      update: {},
    });
    vendorId = vendor.id;
  }

  const created: { id: string }[] = [];
  for (const [i, part] of parts.entries()) {
    const expense = await prisma.expense.create({
      data: {
        accountId,
        date,
        taxYear: taxYearOf(date),
        amountCents: part.amountCents,
        description:
          part.lineCount === 1
            ? part.descriptions[0]
            : `${part.accountingCategory} — ${part.lineCount} items`,
        division,
        accountingCategory: part.accountingCategory,
        vendorId,
        vendorName,
        paymentMethod: receipt.paymentMethod,
        // The paper trail, in the operator's own words.
        notes: `Part ${i + 1} of ${parts.length} — one receipt${
          vendorName ? ` from ${vendorName}` : ""
        }, split by category.`,
        // Tax-safety principle (SPEC §1): a split is bookkeeping, not a
        // deductibility call. Every part still starts at NEEDS_REVIEW.
        taxStatus: "NEEDS_REVIEW",
      },
    });
    created.push(expense);
  }

  // A receipt row can only point at one expense, so it points at the biggest
  // part; the receipt page finds the rest from it. The receipt is linked and
  // categorized either way — it is never left in the Inbox after being filed.
  await prisma.receipt
    .updateMany({
      where: { id: receipt.id, accountId },
      data: { expenseId: created[0].id, status: "CATEGORIZED" },
    })
    .catch(() => {}); // archived meanwhile — the expenses still stand

  redirect("/receipts?categorized=1");
}

export async function updateExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/expenses");
  const data = await expenseDataFromForm(accountId, formData);
  if (!data) redirect(`/expenses/${id}/edit?error=missing`);

  await prisma.expense.updateMany({ where: { id, accountId }, data });
  redirect("/expenses?saved=1");
}

export async function deleteExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/expenses");

  // Never orphan documentation silently: linked receipts go back to
  // NEEDS_REVIEW instead of disappearing with the expense.
  await prisma.receipt.updateMany({
    where: { expenseId: id, accountId },
    data: { status: "NEEDS_REVIEW" },
  });
  await prisma.expense.deleteMany({ where: { id, accountId } });
  redirect("/expenses");
}
