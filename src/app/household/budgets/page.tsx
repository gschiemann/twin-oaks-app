// Monthly budgets — one number per category, applied to every month.
// Blank means "no budget for this one" (spending still tracks).

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { householdExpenseCategories } from "@/lib/household";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { addHouseholdCategory, saveHouseholdBudgets } from "../actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  name: "Category names are 2–30 characters.",
  exists: "That category already exists.",
  full: "That's plenty of categories — remove the budget from unused ones instead.",
};

export default async function HouseholdBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error, added } = await searchParams;
  const [budgets, profile] = await Promise.all([
    prisma.householdBudget.findMany({ where: { accountId } }),
    getBusinessProfile(accountId),
  ]);
  const byCategory = new Map(budgets.map((b) => [b.category, b.monthlyCents]));
  const categories = householdExpenseCategories(profile.householdCategoriesCsv);

  return (
    <div>
      <PageHeader
        title="Monthly budgets"
        sub="Set a target per category — the Household page shows how each month tracks against them."
      />

      {added ? (
        <Card className="mb-4 border-oak-200 bg-oak-50 text-sm font-medium text-oak-900">
          ✅ Category added — set its budget below.
        </Card>
      ) : null}
      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50 text-sm font-medium text-red-700">
          {ERRORS[error] ?? "Check the form and try again."}
        </Card>
      ) : null}

      <Card>
        <form action={saveHouseholdBudgets} className="space-y-3">
          {categories.map((c) => {
            const cents = byCategory.get(c);
            return (
              <div key={c} className="flex items-center justify-between gap-3">
                <label htmlFor={`budget-${c}`} className="min-w-0 flex-1 text-sm font-medium text-stone-800">
                  {c}
                </label>
                <input
                  id={`budget-${c}`}
                  name={`budget-${c}`}
                  inputMode="decimal"
                  placeholder="—"
                  defaultValue={cents != null ? (cents / 100).toFixed(2) : ""}
                  className={`${inputCls} w-28 text-right`}
                />
              </div>
            );
          })}
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save budgets
          </button>
        </form>
      </Card>

      <Card className="mt-4">
        <form action={addHouseholdCategory} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className={labelCls} htmlFor="new-category">
              Add your own category
            </label>
            <input
              id="new-category"
              name="name"
              placeholder="Homeschool, Horses, Church…"
              className={inputCls}
            />
          </div>
          <button type="submit" className={btnSecondaryCls}>
            Add
          </button>
        </form>
      </Card>

      <Link href="/household" className={`${btnSecondaryCls} mt-4`}>
        Back to Household
      </Link>
    </div>
  );
}
