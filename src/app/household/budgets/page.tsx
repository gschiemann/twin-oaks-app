// Monthly budgets — one number per category, applied to every month.
// Blank means "no budget for this one" (spending still tracks).

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { HOUSEHOLD_CATEGORIES } from "@/lib/domain";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls } from "@/components/ui";
import { saveHouseholdBudgets } from "../actions";

export const dynamic = "force-dynamic";

export default async function HouseholdBudgetsPage() {
  const accountId = await requireAccountId();
  const budgets = await prisma.householdBudget.findMany({ where: { accountId } });
  const byCategory = new Map(budgets.map((b) => [b.category, b.monthlyCents]));

  return (
    <div>
      <PageHeader
        title="Monthly budgets"
        sub="Set a target per category — the Household page shows how each month tracks against them."
      />
      <Card>
        <form action={saveHouseholdBudgets} className="space-y-3">
          {HOUSEHOLD_CATEGORIES.map((c) => {
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
      <Link href="/household" className={`${btnSecondaryCls} mt-4`}>
        Back to Household
      </Link>
    </div>
  );
}
