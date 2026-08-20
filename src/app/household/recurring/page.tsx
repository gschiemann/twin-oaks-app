// Repeating bills & income — rent, the phone bill, a paycheck. Each posts
// itself into the month automatically the first time the month is opened.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { formatCents } from "@/lib/money";
import { HOUSEHOLD_INCOME_CATEGORIES } from "@/lib/domain";
import { householdExpenseCategories } from "@/lib/household";
import { Card, EmptyState, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { addRecurringHousehold, deleteRecurringHousehold } from "../actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  description: "Give it a name (e.g. Rent).",
  amount: "Enter an amount.",
  category: "Pick a category.",
};

export default async function RecurringHouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error, added } = await searchParams;

  const [items, profile] = await Promise.all([
    prisma.recurringHousehold.findMany({
      where: { accountId },
      orderBy: [{ dayOfMonth: "asc" }, { createdAt: "asc" }],
    }),
    getBusinessProfile(accountId),
  ]);
  const categories = householdExpenseCategories(profile.householdCategoriesCsv);
  const monthlyOut = items.filter((i) => i.kind !== "INCOME").reduce((s, i) => s + i.amountCents, 0);
  const monthlyIn = items.filter((i) => i.kind === "INCOME").reduce((s, i) => s + i.amountCents, 0);

  return (
    <div>
      <PageHeader
        title="Repeating bills & income"
        sub="Each one posts itself when the month starts — rent never gets forgotten."
      />

      {added ? (
        <Card className="mb-4 border-oak-200 bg-oak-50 text-sm font-medium text-oak-900">
          ✅ Added — it posts into this month the next time you open Household.
        </Card>
      ) : null}
      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50 text-sm font-medium text-red-700">
          {ERRORS[error] ?? "Check the form and try again."}
        </Card>
      ) : null}

      {items.length > 0 ? (
        <Card className="mb-4 text-sm text-stone-700">
          Every month: <span className="font-semibold text-emerald-700">+{formatCents(monthlyIn)}</span> in ·{" "}
          <span className="font-semibold">{formatCents(monthlyOut)}</span> out
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No repeating items yet."
          hint="Add rent, utilities, subscriptions, or a paycheck below — they'll post themselves every month from now on."
        />
      ) : (
        <div className="mb-4 space-y-2">
          {items.map((i) => (
            <Card key={i.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-stone-900">{i.description}</div>
                <div className="text-sm text-stone-500">
                  {i.category} · day {i.dayOfMonth} of each month
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`font-semibold tabular-nums ${i.kind === "INCOME" ? "text-emerald-700" : "text-stone-900"}`}
                >
                  {i.kind === "INCOME" ? "+" : ""}
                  {formatCents(i.amountCents)}
                </span>
                <form action={deleteRecurringHousehold}>
                  <input type="hidden" name="id" value={i.id} />
                  <button type="submit" className="text-xs font-medium text-red-600">
                    Stop
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Add a repeating item</h2>
        <form action={addRecurringHousehold} className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="rec-desc">
              Name *
            </label>
            <input
              id="rec-desc"
              name="description"
              required
              placeholder="Rent"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="rec-amount">
                Amount *
              </label>
              <input
                id="rec-amount"
                name="amount"
                inputMode="decimal"
                placeholder="$0.00"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="rec-day">
                Day of month
              </label>
              <select id="rec-day" name="dayOfMonth" className={inputCls} defaultValue="1">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="rec-category">
              Category *
            </label>
            <select id="rec-category" name="category" required className={inputCls} defaultValue="">
              <option value="" disabled>
                Pick one…
              </option>
              <optgroup label="Spending">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </optgroup>
              <optgroup label="Money in">
                {HOUSEHOLD_INCOME_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Add repeating item
          </button>
        </form>
        <p className="mt-2 text-xs text-stone-500">
          Stopping one keeps the months already posted (that money was real) — it just stops posting
          new ones. Any single month&apos;s posted row can still be edited or deleted on its own.
        </p>
      </Card>

      <Link href="/household" className={btnSecondaryCls}>
        Back to Household
      </Link>
    </div>
  );
}
