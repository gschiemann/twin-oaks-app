"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { householdExpenseCategories, isHouseholdIncomeCategory } from "@/lib/household";

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

// One validator for add + edit. The entry's KIND is derived from the chosen
// category: pick "Paycheck" and it's income — no separate toggle to fumble.
async function entryFromForm(accountId: string, formData: FormData) {
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const category = str(formData.get("category"));
  if (amountCents == null || amountCents <= 0) return { error: "amount" as const };

  const profile = await getBusinessProfile(accountId);
  const validExpense = householdExpenseCategories(profile.householdCategoriesCsv);
  const isIncome = category != null && isHouseholdIncomeCategory(category);
  if (!category || (!isIncome && !validExpense.includes(category))) {
    return { error: "category" as const };
  }

  return {
    error: null,
    data: {
      date: parseDateInput(formData.get("date")) ?? new Date(),
      amountCents,
      kind: isIncome ? "INCOME" : "EXPENSE",
      category,
      description: str(formData.get("description")),
      paymentMethod: str(formData.get("paymentMethod")),
      notes: str(formData.get("notes")),
    },
  };
}

export async function addHouseholdExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const parsed = await entryFromForm(accountId, formData);
  if (parsed.error) redirect(`${backTo(formData)}&error=${parsed.error}`);

  await prisma.householdExpense.create({ data: { accountId, ...parsed.data } });
  redirect(backTo(formData));
}

export async function updateHouseholdExpense(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/household");
  const parsed = await entryFromForm(accountId, formData);
  if (parsed.error) redirect(`/household/entry/${id}?error=${parsed.error}`);

  await prisma.householdExpense.updateMany({ where: { id, accountId }, data: parsed.data });
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
  const profile = await getBusinessProfile(accountId);
  for (const category of householdExpenseCategories(profile.householdCategoriesCsv)) {
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

// A household's own category ("Homeschool", "Horses") — appended to the
// built-in list everywhere. Capped so the list stays a list.
export async function addHouseholdCategory(formData: FormData) {
  const accountId = await requireAccountId();
  const raw = str(formData.get("name"));
  const name = raw?.replace(/,/g, " ").replace(/\s+/g, " ").trim() ?? null;
  if (!name || name.length < 2 || name.length > 30) {
    redirect("/household/budgets?error=name");
  }

  const profile = await getBusinessProfile(accountId);
  const existing = householdExpenseCategories(profile.householdCategoriesCsv);
  if (existing.some((c) => c.toLowerCase() === name.toLowerCase())) {
    redirect("/household/budgets?error=exists");
  }
  const customs = (profile.householdCategoriesCsv ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (customs.length >= 20) redirect("/household/budgets?error=full");

  await prisma.businessProfile.updateMany({
    where: { accountId },
    data: { householdCategoriesCsv: [...customs, name].join(",") },
  });
  redirect("/household/budgets?added=1");
}

// ————— Repeating items (rent, paycheck, subscriptions) —————

export async function addRecurringHousehold(formData: FormData) {
  const accountId = await requireAccountId();
  const description = str(formData.get("description"));
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const category = str(formData.get("category"));
  const dayRaw = str(formData.get("dayOfMonth"));
  const dayOfMonth = Math.min(28, Math.max(1, Number(dayRaw) || 1));

  if (!description) redirect("/household/recurring?error=description");
  if (amountCents == null || amountCents <= 0) redirect("/household/recurring?error=amount");
  const profile = await getBusinessProfile(accountId);
  const validExpense = householdExpenseCategories(profile.householdCategoriesCsv);
  const isIncome = category != null && isHouseholdIncomeCategory(category);
  if (!category || (!isIncome && !validExpense.includes(category))) {
    redirect("/household/recurring?error=category");
  }

  await prisma.recurringHousehold.create({
    data: {
      accountId,
      description,
      amountCents,
      kind: isIncome ? "INCOME" : "EXPENSE",
      category,
      dayOfMonth,
    },
  });
  redirect("/household/recurring?added=1");
}

// Deleting a repeating item stops FUTURE months; rows already posted stay
// (they were real money) but lose the link.
export async function deleteRecurringHousehold(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (id) {
    await prisma.householdExpense.updateMany({
      where: { recurringId: id, accountId },
      data: { recurringId: null },
    });
    await prisma.recurringHousehold.deleteMany({ where: { id, accountId } });
  }
  redirect("/household/recurring");
}
