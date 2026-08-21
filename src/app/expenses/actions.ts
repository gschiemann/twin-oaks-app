"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { ALL_DIVISIONS, TAX_STATUSES } from "@/lib/domain";

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
  const data = await expenseDataFromForm(accountId, formData);
  if (!data) {
    // Hand the typed values straight back so nothing has to be retyped.
    const back = new URLSearchParams({ error: "missing" });
    if (fromReceiptId) back.set("fromReceipt", fromReceiptId);
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

  // Categorizing from the Inbox drops you back in the Inbox to do the next
  // one; everything else lands on the Expenses list. Never a dead-end page.
  redirect(fromReceiptId ? "/receipts?categorized=1" : "/expenses?saved=1");
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
