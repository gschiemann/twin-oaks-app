// Household money — the personal side (separate tables, never the business
// books, never the Tax Center). One screen: this month's spending against
// the budgets, a ten-second add form, and the month's entries.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { HOUSEHOLD_CATEGORIES, PAYMENT_METHODS } from "@/lib/domain";
import { Card, EmptyState, PageHeader, StatCard, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { addHouseholdExpense, deleteHouseholdExpense } from "./actions";

export const dynamic = "force-dynamic";

function monthOf(param: string | undefined): { start: Date; end: Date; key: string; label: string } {
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

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; error?: string; saved?: string }>;
}) {
  const accountId = await requireAccountId();
  const { m, error, saved } = await searchParams;
  const month = monthOf(m);
  const isCurrentMonth = month.key === monthOf(undefined).key;

  const [expenses, byCategory, budgets] = await Promise.all([
    prisma.householdExpense.findMany({
      where: { accountId, date: { gte: month.start, lt: month.end } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.householdExpense.groupBy({
      by: ["category"],
      where: { accountId, date: { gte: month.start, lt: month.end } },
      _sum: { amountCents: true },
    }),
    prisma.householdBudget.findMany({ where: { accountId } }),
  ]);

  const spentByCategory = new Map(byCategory.map((c) => [c.category, c._sum.amountCents ?? 0]));
  const budgetByCategory = new Map(budgets.map((b) => [b.category, b.monthlyCents]));
  const totalSpent = expenses.reduce((s, e) => s + e.amountCents, 0);
  const totalBudget = budgets.reduce((s, b) => s + b.monthlyCents, 0);

  // Rows worth showing: anything budgeted OR spent this month, budget order first.
  const rows = HOUSEHOLD_CATEGORIES.filter(
    (c) => budgetByCategory.has(c) || (spentByCategory.get(c) ?? 0) > 0,
  );

  return (
    <div>
      <PageHeader
        title="Household"
        sub="Personal spending & budgets — kept fully separate from the business books."
        action={
          <Link href="/household/budgets" className={btnSecondaryCls}>
            Budgets
          </Link>
        }
      />

      {saved ? (
        <Card className="mb-4 border-oak-200 bg-oak-50 text-sm font-medium text-oak-900">
          ✅ Budgets saved.
        </Card>
      ) : null}
      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50 text-sm font-medium text-red-700">
          {error === "amount" ? "Enter an amount first." : "Pick a category first."}
        </Card>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <Link
          href={`/household?m=${shiftMonth(month.key, -1)}`}
          className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600"
        >
          ← Prev
        </Link>
        <span className="font-semibold text-stone-900">{month.label}</span>
        {isCurrentMonth ? (
          <span className="px-3 py-1.5 text-sm text-stone-400">Next →</span>
        ) : (
          <Link
            href={`/household?m=${shiftMonth(month.key, 1)}`}
            className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600"
          >
            Next →
          </Link>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Spent" value={formatCents(totalSpent)} />
        <StatCard label="Budget" value={totalBudget > 0 ? formatCents(totalBudget) : "—"} />
        <StatCard
          label={totalBudget > 0 && totalSpent > totalBudget ? "Over by" : "Left"}
          value={totalBudget > 0 ? formatCents(Math.abs(totalBudget - totalSpent)) : "—"}
          tone={totalBudget > 0 ? (totalSpent > totalBudget ? "red" : "green") : undefined}
        />
      </div>

      {rows.length > 0 ? (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold text-stone-900">By category</h2>
          <div className="space-y-2.5">
            {rows.map((c) => {
              const spent = spentByCategory.get(c) ?? 0;
              const budget = budgetByCategory.get(c) ?? 0;
              const over = budget > 0 && spent > budget;
              const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
              return (
                <div key={c}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-stone-800">{c}</span>
                    <span className={`tabular-nums ${over ? "font-semibold text-red-700" : "text-stone-600"}`}>
                      {formatCents(spent)}
                      {budget > 0 ? ` / ${formatCents(budget)}` : ""}
                      {over ? " — over" : ""}
                    </span>
                  </div>
                  {budget > 0 ? (
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full rounded-full ${over ? "bg-red-500" : "bg-oak-600"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Add spending</h2>
        <form action={addHouseholdExpense} className="space-y-3">
          <input type="hidden" name="m" value={month.key} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="hh-amount">
                Amount *
              </label>
              <input
                id="hh-amount"
                name="amount"
                inputMode="decimal"
                placeholder="$0.00"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="hh-date">
                Date
              </label>
              <input
                id="hh-date"
                name="date"
                type="date"
                defaultValue={toDateInputValue(new Date())}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="hh-category">
              Category *
            </label>
            <select id="hh-category" name="category" required className={inputCls} defaultValue="">
              <option value="" disabled>
                Pick one…
              </option>
              {HOUSEHOLD_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="hh-desc">
              What was it?
            </label>
            <input id="hh-desc" name="description" placeholder="Optional" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="hh-method">
              Payment method
            </label>
            <select id="hh-method" name="paymentMethod" className={inputCls} defaultValue="">
              <option value="">—</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Add
          </button>
        </form>
      </Card>

      {expenses.length === 0 ? (
        <EmptyState
          title={`Nothing recorded for ${month.label}.`}
          hint="Add spending above — set budgets once and this page shows how the month is tracking."
          actionHref="/household/budgets"
          actionLabel="Set budgets"
        />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <Card key={e.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-stone-900">
                  {e.description ?? e.category}
                </div>
                <div className="text-sm text-stone-500">
                  {e.category} · {formatDate(e.date)}
                  {e.paymentMethod ? ` · ${e.paymentMethod}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold tabular-nums text-stone-900">
                  {formatCents(e.amountCents)}
                </span>
                <form action={deleteHouseholdExpense}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="m" value={month.key} />
                  <button
                    type="submit"
                    aria-label={`Delete ${e.description ?? e.category}`}
                    className="text-xs font-medium text-red-600"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
