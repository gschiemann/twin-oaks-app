"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { HOUSEHOLD_CATEGORIES } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// The month being viewed rides along so adding to March keeps you on March.
function backTo(formData: FormData): string {
  const m = str(formData.get("m"));
  return m && /^\d{4}-\d{2}$/.test(m) ? `/household?m=${m}` : "/household";
}

export async function addHouseholdExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const category = str(formData.get("category"));
  if (amountCents == null || amountCents <= 0) redirect(`${backTo(formData)}&error=amount`);
  if (!category || !(HOUSEHOLD_CATEGORIES as readonly string[]).includes(category)) {
    redirect(`${backTo(formData)}&error=category`);
  }

  await prisma.householdExpense.create({
    data: {
      accountId,
      date: parseDateInput(formData.get("date")) ?? new Date(),
      amountCents,
      category,
      description: str(formData.get("description")),
      paymentMethod: str(formData.get("paymentMethod")),
      notes: str(formData.get("notes")),
    },
  });
  redirect(backTo(formData));
}

export async function deleteHouseholdExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (id) await prisma.householdExpense.deleteMany({ where: { id, accountId } });
  redirect(backTo(formData));
}

// One number per category; blank or zero clears the budget for it.
export async function saveHouseholdBudgets(formData: FormData) {
  const accountId = await requireAccountId();
  for (const category of HOUSEHOLD_CATEGORIES) {
    const cents = parseDollarsToCents(formData.get(`budget-${category}`));
    if (cents != null && cents > 0) {
      await prisma.householdBudget.upsert({
        where: { accountId_category: { accountId, category } },
        create: { accountId, category, monthlyCents: cents },
        update: { monthlyCents: cents },
      });
    } else {
      await prisma.householdBudget.deleteMany({ where: { accountId, category } });
    }
  }
  redirect("/household?saved=1");
}
