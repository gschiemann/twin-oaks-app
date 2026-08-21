// Household money — the personal side (separate tables, never the business
// books, never the Tax Center). One screen: the month's income and spending
// against the budgets, repeating bills posted automatically, a ten-second
// add form, trends, and the month's entries.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { formatCents } from "@/lib/money";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { HOUSEHOLD_INCOME_CATEGORIES, PAYMENT_METHODS } from "@/lib/domain";
import {
  householdExpenseCategories,
  materializeRecurring,
  monthOf,
  shiftMonth,
} from "@/lib/household";
import {
  Card,
  EmptyState,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { addHouseholdExpense } from "./actions";

export const dynamic = "force-dynamic";

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; error?: string; saved?: string; added?: string }>;
}) {
  const accountId = await requireAccountId();
  const { m, error, saved, added } = await searchParams;
  const month = monthOf(m);
  const isCurrentMonth = month.key === monthOf().key;

  // Rent, paycheck, subscriptions post themselves the first time the current
  // month is opened.
  await materializeRecurring(accountId, month);

  const trendStart = new Date(month.start.getFullYear(), month.start.getMonth() - 5, 1);
  const [entries, budgets, profile, trendRows] = await Promise.all([
    prisma.householdExpense.findMany({
      where: { accountId, date: { gte: month.start, lt: month.end } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.householdBudget.findMany({ where: { accountId } }),
    getBusinessProfile(accountId),
    prisma.householdExpense.findMany({
      where: { accountId, date: { gte: trendStart, lt: month.end } },
      select: { date: true, amountCents: true, kind: true },
    }),
  ]);

  const spendEntries = entries.filter((e) => e.kind !== "INCOME");
  const incomeEntries = entries.filter((e) => e.kind === "INCOME");
  const totalSpent = spendEntries.reduce((s, e) => s + e.amountCents, 0);
  const totalIncome = incomeEntries.reduce((s, e) => s + e.amountCents, 0);
  const totalBudget = budgets.reduce((s, b) => s + b.monthlyCents, 0);

  const spentByCategory = new Map<string, number>();
  for (const e of spendEntries) {
    spentByCategory.set(e.category, (spentByCategory.get(e.category) ?? 0) + e.amountCents);
  }
  const budgetByCategory = new Map(budgets.map((b) => [b.category, b.monthlyCents]));
  const categories = householdExpenseCategories(profile.householdCategoriesCsv);
  const rows = categories.filter(
    (c) => budgetByCategory.has(c) || (spentByCategory.get(c) ?? 0) > 0,
  );

  // Pacing: how far through the month vs how far through the budget.
  const now = new Date();
  const daysInMonth = new Date(month.start.getFullYear(), month.start.getMonth() + 1, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // Trends: the viewed month and the five before it.
  const trend: { key: string; label: string; spent: number; income: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(month.start.getFullYear(), month.start.getMonth() - i, 1);
    trend.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      spent: 0,
      income: 0,
    });
  }
  const trendByKey = new Map(trend.map((t) => [t.key, t]));
  for (const r of trendRows) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = trendByKey.get(key);
    if (!bucket) continue;
    if (r.kind === "INCOME") bucket.income += r.amountCents;
    else bucket.spent += r.amountCents;
  }
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.spent, t.income)));
  const hasTrend = trend.some((t) => t.spent > 0 || t.income > 0);

  return (
    <div>
      <PageHeader
        title="Household"
        sub="Personal money — kept fully separate from the business books."
        action={
          <Link href="/household/budgets" className={btnSecondaryCls}>
            Budgets
          </Link>
        }
      />

      {saved ? <SavedBanner title="Budgets saved." /> : null}
      {added ? (
        <SavedBanner
          title="Added to Household."
          hint="It's in this month's list below and counted in the totals above."
        />
      ) : null}
      {error ? (
        <FormError>
          {error === "amount" ? "Enter an amount first." : "Pick a category first."}
        </FormError>
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

      <div className="mb-2 grid grid-cols-3 gap-2">
        <StatCard
          label="Income"
          value={totalIncome > 0 ? formatCents(totalIncome) : "—"}
          tone={totalIncome > 0 ? "green" : undefined}
        />
        <StatCard label="Spent" value={formatCents(totalSpent)} />
        <StatCard
          label={totalBudget > 0 && totalSpent > totalBudget ? "Over budget" : "Budget left"}
          value={totalBudget > 0 ? formatCents(Math.abs(totalBudget - totalSpent)) : "—"}
          tone={totalBudget > 0 ? (totalSpent > totalBudget ? "red" : "green") : undefined}
        />
      </div>

      {isCurrentMonth && totalBudget > 0 ? (
        <p
          className={`mb-4 text-center text-xs ${budgetPct > monthPct + 10 ? "font-medium text-amber-700" : "text-stone-500"}`}
        >
          Day {dayOfMonth} of {daysInMonth} — {monthPct}% of the month gone, {budgetPct}% of the
          budget used{budgetPct > monthPct + 10 ? " — running hot" : ""}.
        </p>
      ) : (
        <div className="mb-2" />
      )}

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
                    <span
                      className={`tabular-nums ${over ? "font-semibold text-red-700" : "text-stone-600"}`}
                    >
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
        <h2 className="mb-2 font-semibold text-stone-900">Add money in or out</h2>
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

      {hasTrend ? (
        <Card className="mb-4">
          <h2 className="mb-3 font-semibold text-stone-900">Last 6 months</h2>
          <div className="flex items-end justify-between gap-2" style={{ height: 96 }}>
            {trend.map((t) => (
              <div key={t.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div className="flex h-full w-full items-end justify-center gap-1">
                  <div
                    title={`Income ${formatCents(t.income)}`}
                    className="w-3 rounded-t bg-emerald-500/80"
                    style={{ height: `${Math.round((t.income / trendMax) * 100)}%` }}
                  />
                  <div
                    title={`Spent ${formatCents(t.spent)}`}
                    className="w-3 rounded-t bg-oak-600"
                    style={{ height: `${Math.round((t.spent / trendMax) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-stone-500">{t.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-stone-400">
            <span className="text-emerald-600">■</span> income &nbsp;
            <span className="text-oak-700">■</span> spending
          </p>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
        <Link href="/household/recurring" className="font-medium text-oak-700">
          ↻ Repeating bills & income
        </Link>
        <Link href="/household/budgets" className="font-medium text-oak-700">
          Budgets
        </Link>
        <a
          href={`/api/export/csv/household?year=${month.start.getFullYear()}`}
          className="font-medium text-oak-700"
        >
          Download {month.start.getFullYear()} CSV
        </a>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title={`Nothing recorded for ${month.label}.`}
          hint="Add money in or out above — set budgets once and this page shows how the month is tracking."
          actionHref="/household/budgets"
          actionLabel="Set budgets"
        />
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const income = e.kind === "INCOME";
            return (
              <Card key={e.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-stone-900">
                    {e.description ?? e.category}
                    {e.recurringId ? <span className="ml-1 text-stone-400" title="Posted automatically">↻</span> : null}
                  </div>
                  <div className="text-sm text-stone-500">
                    {e.category} · {formatDate(e.date)}
                    {e.paymentMethod ? ` · ${e.paymentMethod}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`font-semibold tabular-nums ${income ? "text-emerald-700" : "text-stone-900"}`}
                  >
                    {income ? "+" : ""}
                    {formatCents(e.amountCents)}
                  </span>
                  <Link
                    href={`/household/entry/${e.id}?m=${month.key}`}
                    className="text-xs font-medium text-oak-700"
                  >
                    Edit
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
