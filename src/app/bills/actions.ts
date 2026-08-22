"use server";

// Regular bills — create / edit / pause / remove.
//
// These actions only ever touch the RecurringBill table. Declaring a bill
// never writes an Expense: see the constraint at the top of src/lib/bills.ts.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/money";
import { clampBillDay } from "@/lib/bills";
import { ACCOUNTING_CATEGORIES, ALL_DIVISIONS } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// One validator for add + edit, so the two screens can never disagree about
// what a complete bill is.
function billDataFromForm(formData: FormData) {
  const description = str(formData.get("description"));
  const division = str(formData.get("division"));
  const accountingCategory = str(formData.get("accountingCategory"));
  const amountCents = parseDollarsToCents(formData.get("amount"));

  if (!description) return { error: "missing" as const };
  if (!division || !(ALL_DIVISIONS as readonly string[]).includes(division)) {
    return { error: "missing" as const };
  }
  if (
    !accountingCategory ||
    !(ACCOUNTING_CATEGORIES as readonly string[]).includes(accountingCategory)
  ) {
    return { error: "missing" as const };
  }
  // A zero or negative bill would quietly poison every total on the
  // dashboard, so it is refused rather than rounded away.
  if (amountCents == null || amountCents <= 0) return { error: "amount" as const };

  return {
    error: null,
    data: {
      description,
      amountCents,
      division,
      accountingCategory,
      vendorName: str(formData.get("vendorName")),
      dayOfMonth: clampBillDay(num(formData.get("dayOfMonth")) ?? 1),
      // An unchecked checkbox sends nothing at all, so absence means paused.
      active: formData.get("active") === "on",
      notes: str(formData.get("notes")),
    },
  };
}

export async function createBill(formData: FormData) {
  const accountId = await requireAccountId();
  const parsed = billDataFromForm(formData);
  if (parsed.error) redirect(`/bills/new?error=${parsed.error}`);

  await prisma.recurringBill.create({ data: { ...parsed.data, accountId } });
  redirect("/bills?saved=1");
}

export async function updateBill(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/bills");
  const parsed = billDataFromForm(formData);
  if (parsed.error) redirect(`/bills/${id}/edit?error=${parsed.error}`);

  await prisma.recurringBill.updateMany({ where: { id, accountId }, data: parsed.data });
  redirect("/bills?saved=1");
}

// Pause / resume. Pausing keeps the record (and everything the operator
// typed) but drops it out of the upcoming list and the monthly total.
export async function setBillActive(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/bills");
  const active = str(formData.get("active")) === "1";
  await prisma.recurringBill.updateMany({ where: { id, accountId }, data: { active } });
  redirect("/bills");
}

// Removing a bill removes a REMINDER, never a payment — expenses already
// recorded against it stay in the books untouched.
export async function deleteBill(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (id) await prisma.recurringBill.deleteMany({ where: { id, accountId } });
  redirect("/bills");
}
