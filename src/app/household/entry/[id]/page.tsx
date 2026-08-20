// Edit (or delete) one household entry — including rows a repeating item
// posted, since real life deviates from the plan ("rent went up this month").

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { toDateInputValue } from "@/lib/dates";
import { HOUSEHOLD_INCOME_CATEGORIES, PAYMENT_METHODS } from "@/lib/domain";
import { householdExpenseCategories } from "@/lib/household";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { deleteHouseholdExpense, updateHouseholdExpense } from "../../actions";

export const dynamic = "force-dynamic";

export default async function HouseholdEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { m, error } = await searchParams;

  const [entry, profile] = await Promise.all([
    prisma.householdExpense.findFirst({ where: { id, accountId } }),
    getBusinessProfile(accountId),
  ]);
  if (!entry) notFound();

  const categories = householdExpenseCategories(profile.householdCategoriesCsv);
  const back = m && /^\d{4}-\d{2}$/.test(m) ? `/household?m=${m}` : "/household";

  return (
    <div>
      <PageHeader
        title={entry.kind === "INCOME" ? "Edit money in" : "Edit spending"}
        sub={entry.description ?? entry.category}
      />

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50 text-sm font-medium text-red-700">
          {error === "amount" ? "Enter an amount first." : "Pick a category first."}
        </Card>
      ) : null}
      {entry.recurringId ? (
        <Card className="mb-4 border-stone-200 bg-stone-50 text-xs text-stone-600">
          ↻ This row was posted by a repeating item. Editing changes THIS month only — manage the
          repeating item itself under{" "}
          <Link href="/household/recurring" className="font-medium text-oak-700">
            Repeating bills & income
          </Link>
          .
        </Card>
      ) : null}

      <Card>
        <form action={updateHouseholdExpense} className="space-y-3">
          <input type="hidden" name="id" value={entry.id} />
          {m ? <input type="hidden" name="m" value={m} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="amount">
                Amount *
              </label>
              <input
                id="amount"
                name="amount"
                inputMode="decimal"
                required
                defaultValue={(entry.amountCents / 100).toFixed(2)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="date">
                Date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={toDateInputValue(entry.date)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="category">
              Category *
            </label>
            <select id="category" name="category" required className={inputCls} defaultValue={entry.category}>
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
            <label className={labelCls} htmlFor="description">
              What was it?
            </label>
            <input
              id="description"
              name="description"
              defaultValue={entry.description ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="paymentMethod">
              Payment method
            </label>
            <select
              id="paymentMethod"
              name="paymentMethod"
              className={inputCls}
              defaultValue={entry.paymentMethod ?? ""}
            >
              <option value="">—</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save changes
          </button>
        </form>
      </Card>

      <form action={deleteHouseholdExpense} className="mt-4 text-center">
        <input type="hidden" name="id" value={entry.id} />
        {m ? <input type="hidden" name="m" value={m} /> : null}
        <button type="submit" className="text-sm font-medium text-red-600">
          Delete this entry
        </button>
      </form>

      <div className="mt-4 text-center">
        <Link href={back} className={btnSecondaryCls}>
          Back to Household
        </Link>
      </div>
    </div>
  );
}
