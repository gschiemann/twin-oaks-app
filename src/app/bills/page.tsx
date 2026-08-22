// Regular bills — the money going OUT on a schedule.
//
// This screen reminds; it never pays and it never posts. See the constraint
// comment at the top of src/lib/bills.ts before adding anything that writes
// an Expense from here.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { startOfMonth } from "@/lib/dates";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import {
  billLikelyPaid,
  billsMonthlyTotal,
  dueInWords,
  formatApproxDollars,
  ordinalDay,
  outstandingInvoiceTotals,
  upcomingBills,
} from "@/lib/bills";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  divisionTone,
} from "@/components/ui";
import { setBillActive } from "./actions";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const accountId = await requireAccountId();
  const { saved } = await searchParams;

  const monthStart = startOfMonth();
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const [bills, upcoming, monthlyTotal, owed, monthExpenses] = await Promise.all([
    prisma.recurringBill.findMany({
      where: { accountId },
      orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }, { description: "asc" }],
    }),
    upcomingBills(accountId, WINDOW_DAYS),
    billsMonthlyTotal(accountId),
    outstandingInvoiceTotals(accountId),
    // Only this month's expenses can be this month's payment, so that's all
    // the "looks paid" check needs to look at.
    prisma.expense.findMany({
      where: { accountId, date: { gte: monthStart, lt: monthEnd } },
      select: { id: true, date: true, amountCents: true, description: true, vendorName: true },
    }),
  ]);

  const activeBills = bills.filter((b) => b.active);
  const pausedBills = bills.filter((b) => !b.active);
  const upcomingTotal = upcoming.reduce((sum, b) => sum + b.amountCents, 0);

  // The guess only applies to a bill whose turn comes up inside THIS month.
  // Once this month's date has passed, the row on screen is next month's
  // occurrence — and a payment made three weeks ago says nothing about it.
  const rows = upcoming.map((bill) => ({
    bill,
    guess:
      bill.dueDate < monthEnd
        ? billLikelyPaid(bill, monthExpenses, monthStart)
        : { likelyPaid: false, expenseId: null },
  }));
  const looksPaidCount = rows.filter((r) => r.guess.likelyPaid).length;

  return (
    <div>
      <PageHeader
        title="Regular bills"
        sub="What you pay every month, and when. A reminder list — nothing is paid or posted for you."
        action={
          <Link href="/bills/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Bill saved."
          hint="You'll see it under What's coming up as its day gets close."
          actionHref="/bills/new"
          actionLabel="Add another bill"
        />
      ) : null}

      {bills.length === 0 ? (
        <EmptyState
          title="No regular bills yet."
          hint="Add the ones that come every month — insurance, the feed account, internet, an equipment payment — and this page will tell you what's due before it catches you out."
          actionHref="/bills/new"
          actionLabel="Add a bill"
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <StatCard
              label="Every month"
              value={formatCents(monthlyTotal)}
              sub={`${activeBills.length} regular bill${activeBills.length === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Next 30 days"
              value={formatCents(upcomingTotal)}
              sub={`${upcoming.length} coming due`}
            />
          </div>

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            What&apos;s coming up
          </h2>

          <Card className="mb-2 text-base text-stone-700">
            {upcoming.length === 0 ? (
              <>Nothing due in the next 30 days.</>
            ) : upcoming.length === 1 ? (
              <>
                One regular bill — about{" "}
                <span className="font-semibold text-stone-900">
                  {formatApproxDollars(upcomingTotal)}
                </span>{" "}
                — is due in the next 30 days.
              </>
            ) : (
              <>
                About{" "}
                <span className="font-semibold text-stone-900">
                  {formatApproxDollars(upcomingTotal)}
                </span>{" "}
                of regular bills are due in the next 30 days.
              </>
            )}
            {looksPaidCount > 0 ? (
              <span className="mt-1 block text-sm text-stone-500">
                {looksPaidCount === 1 ? "One of them looks" : `${looksPaidCount} of them look`} like
                you already paid this month — they stay on the list so a wrong guess can&apos;t make
                a real bill disappear.
              </span>
            ) : null}
          </Card>

          {rows.length > 0 ? (
            <div className="mb-4 space-y-2">
              {rows.map(({ bill, guess }) => {
                const soon = bill.daysAway <= 3;
                // One tap to the expense form with the amount and vendor
                // already filled in — the operator still confirms and saves,
                // which is the whole point.
                const recordHref = `/expenses/new?a=${encodeURIComponent(
                  (bill.amountCents / 100).toFixed(2),
                )}&d=${encodeURIComponent(bill.description)}${
                  bill.vendorName ? `&v=${encodeURIComponent(bill.vendorName)}` : ""
                }`;
                return (
                  <Card key={bill.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-stone-900">
                          {bill.description}
                        </div>
                        <div
                          className={`text-sm ${soon ? "font-semibold text-amber-700" : "text-stone-500"}`}
                        >
                          {dueInWords(bill.dayOfMonth, bill.daysAway)}
                        </div>
                        {bill.vendorName ? (
                          <div className="truncate text-sm text-stone-500">{bill.vendorName}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right font-bold tabular-nums text-stone-900">
                        {formatCents(bill.amountCents)}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {guess.likelyPaid && guess.expenseId ? (
                        <Link href={`/expenses/${guess.expenseId}`}>
                          <Chip tone="stone">looks paid — tap to check</Chip>
                        </Link>
                      ) : null}
                      <Link href={recordHref} className="text-sm font-semibold text-oak-700">
                        Record this payment
                      </Link>
                      <Link href={`/bills/${bill.id}/edit`} className="text-sm text-stone-500">
                        Edit
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : null}

          {owed.count > 0 ? (
            <Link href="/invoices" className="mb-4 block">
              <Card className="flex items-center justify-between gap-3 active:bg-stone-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-700">Money owed to you</p>
                  <p className="text-xs text-stone-500">
                    {owed.count} unpaid invoice{owed.count === 1 ? "" : "s"}
                    {owed.overdueCents > 0
                      ? ` · ${formatCents(owed.overdueCents)} of it past due`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xl font-bold tabular-nums text-oak-700">
                  {formatCents(owed.totalCents)}
                </span>
              </Card>
            </Link>
          ) : null}

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            All regular bills
          </h2>
          <div className="space-y-2">
            {activeBills.map((bill) => (
              <BillRow key={bill.id} bill={bill} />
            ))}
          </div>

          {pausedBills.length > 0 ? (
            <>
              <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Paused
              </h2>
              <div className="space-y-2">
                {pausedBills.map((bill) => (
                  <BillRow key={bill.id} bill={bill} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <Card className="mt-4 text-sm text-stone-600">
        <p className="font-semibold text-stone-900">These are reminders, not payments.</p>
        <p className="mt-1">
          A business bill listed here never adds itself to your books. When you pay one, tap{" "}
          <span className="font-medium">Record this payment</span> and save it as an expense — that
          way your books always show the real amount you actually paid, on the day you paid it.
        </p>
      </Card>
    </div>
  );
}

function BillRow({
  bill,
}: {
  bill: {
    id: string;
    description: string;
    amountCents: number;
    division: string;
    accountingCategory: string;
    vendorName: string | null;
    dayOfMonth: number;
    active: boolean;
  };
}) {
  return (
    <Card className={bill.active ? "" : "bg-stone-50"}>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/bills/${bill.id}/edit`} className="min-w-0 flex-1">
          <div className="truncate font-semibold text-stone-900">{bill.description}</div>
          <div className="truncate text-sm text-stone-500">
            {bill.active ? `Due the ${ordinalDay(bill.dayOfMonth)} of each month` : "Paused"}
            {bill.vendorName ? ` · ${bill.vendorName}` : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone={divisionTone(bill.division)}>
              {DIVISION_LABELS[bill.division as Division] ?? bill.division}
            </Chip>
            <Chip tone="stone">{bill.accountingCategory}</Chip>
          </div>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="font-bold tabular-nums text-stone-900">
            {formatCents(bill.amountCents)}
          </span>
          <form action={setBillActive}>
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="active" value={bill.active ? "0" : "1"} />
            <button type="submit" className="text-sm font-medium text-stone-500 underline">
              {bill.active ? "Pause" : "Resume"}
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}
