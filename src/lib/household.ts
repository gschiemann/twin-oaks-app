// Household budgeting helpers — month math, category resolution, and the
// recurring-item materializer. Pure where possible; the materializer is the
// one function that writes.

import { prisma } from "@/lib/db";
import { HOUSEHOLD_CATEGORIES, HOUSEHOLD_INCOME_CATEGORIES } from "@/lib/domain";

export type Month = { start: Date; end: Date; key: string; label: string };

export function monthOf(param?: string): Month {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-based
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [py, pm] = param.split("-").map(Number);
    if (pm >= 1 && pm <= 12) {
      y = py;
      m = pm - 1;
    }
  }
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  const key = `${y}-${String(m + 1).padStart(2, "0")}`;
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, key, label };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// The account's expense categories: the built-in list plus whatever they
// added themselves (BusinessProfile.householdCategoriesCsv).
export function householdExpenseCategories(customCsv: string | null | undefined): string[] {
  const custom = (customCsv ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 30);
  const seen = new Set<string>(HOUSEHOLD_CATEGORIES);
  const extras = custom.filter((c) => !seen.has(c));
  return [...HOUSEHOLD_CATEGORIES, ...extras];
}

export function isHouseholdIncomeCategory(category: string): boolean {
  return (HOUSEHOLD_INCOME_CATEGORIES as readonly string[]).includes(category);
}

// Post this month's repeating items (rent, paycheck, subscriptions) exactly
// once each. Idempotent: a posted row carries recurringId, and the existence
// check runs per item per month. Only the CURRENT month materializes — past
// months are history and future months aren't here yet.
export async function materializeRecurring(accountId: string, month: Month): Promise<void> {
  const currentKey = monthOf().key;
  if (month.key !== currentKey) return;

  const items = await prisma.recurringHousehold.findMany({ where: { accountId } });
  if (items.length === 0) return;

  for (const item of items) {
    const exists = await prisma.householdExpense.findFirst({
      where: {
        accountId,
        recurringId: item.id,
        date: { gte: month.start, lt: month.end },
      },
      select: { id: true },
    });
    if (exists) continue;
    const day = Math.min(Math.max(1, item.dayOfMonth), 28);
    await prisma.householdExpense.create({
      data: {
        accountId,
        date: new Date(month.start.getFullYear(), month.start.getMonth(), day, 12, 0, 0),
        amountCents: item.amountCents,
        kind: item.kind,
        category: item.category,
        description: item.description,
        recurringId: item.id,
      },
    });
  }
}
