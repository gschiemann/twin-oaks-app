// Bank matching — the landing page.
//
// What it is for: the owner exports a CSV from his bank, uploads it here, and
// this screen tells him which lines are NOT yet in the books. It is a review
// list, not a bookkeeping robot.
//
// THE PROMISE THIS PAGE MAKES, and must keep: importing a statement never
// creates, edits or deletes an Expense or an Income. "Yes, that's it" only
// writes a link onto the bank line. Adding a new expense hands him the normal
// expense form with the boxes filled in — he still saves it himself.
//
// Nothing here logs a description or an amount: this is bank data.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { BANK_TXN_STATUS_LABELS, type BankTxnStatus } from "@/lib/domain";
import {
  MATCH_WINDOW_DAYS,
  STRONG_MATCH_SCORE,
  rankCandidates,
  vendorGuessFromDescription,
} from "@/lib/bank-import";
import {
  Card,
  Chip,
  EmptyState,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
} from "@/components/ui";
import { markIgnored, markMatched, putBackOnList } from "./actions";
import { amountToneCls, amountWithSign, bankStatusTone, moneyDirectionLabel } from "./bank-bits";
import ImportPanel from "./ImportPanel";

export const dynamic = "force-dynamic";

/** Long enough that a month of statements fits, short enough that an iPhone
 *  renders it instantly. Anything beyond this says so, out loud. */
const LIST_LIMIT = 100;

const TABS = [
  { key: "needs", status: "UNMATCHED", label: "Needs review" },
  { key: "matched", status: "MATCHED", label: "Matched" },
  { key: "ignored", status: "IGNORED", label: "Ignored" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const ERRORS: Record<string, string> = {
  nofile:
    "The file didn't come through with that import, so nothing was read. Upload it again — if it lives in iCloud, open it once in the Files app first so it downloads to this phone.",
  mapping:
    "It still needs to know which column holds the date, and which one holds the amount. Set those two and tap Import again.",
  norows:
    "Not one row could be read with those columns. The date column has to hold real dates and the amount column real numbers — check the sample rows and try different columns.",
  match:
    "That line couldn't be updated — it may already have been dealt with on another tap. The list below is up to date.",
};

/** Money out becomes an expense, money in becomes income. The form opens
 *  pre-filled and he still saves it himself — this only skips the typing. */
function newRecordHref(txn: { id: string; date: Date; description: string; amountCents: number }): string {
  const guess = vendorGuessFromDescription(txn.description);
  const params = new URLSearchParams({
    date: toDateInputValue(txn.date),
    a: (Math.abs(txn.amountCents) / 100).toFixed(2),
    d: guess,
    v: guess,
    fromBankTxn: txn.id,
  });
  return `${txn.amountCents < 0 ? "/expenses/new" : "/income/new"}?${params.toString()}`;
}

type Candidate = {
  id: string;
  kind: "expense" | "income";
  date: Date;
  description: string;
  amountCents: number;
  party?: string | null;
};

export default async function BankingPage({
  searchParams,
}: {
  searchParams: Promise<{
    show?: string;
    imported?: string;
    already?: string;
    unreadable?: string;
    batch?: string;
    matched?: string;
    ignored?: string;
    undone?: string;
    error?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.show) ? (sp.show as TabKey) : "needs";
  const status = TABS.find((t) => t.key === tab)!.status;

  const [counts, rows, lastProfile] = await Promise.all([
    prisma.bankTransaction.groupBy({
      by: ["status"],
      where: { accountId },
      _count: { _all: true },
    }),
    prisma.bankTransaction.findMany({
      where: { accountId, status },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: LIST_LIMIT,
    }),
    prisma.bankImportProfile.findFirst({
      where: { accountId },
      orderBy: { updatedAt: "desc" },
      select: { bankName: true },
    }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const needsCount = countOf("UNMATCHED");
  const matchedCount = countOf("MATCHED");
  const ignoredCount = countOf("IGNORED");
  const totalCount = counts.reduce((sum, c) => sum + c._count._all, 0);
  const tabCount = countOf(status);

  // ——— Suggestions, for the review tab only ———
  const suggestions = new Map<string, { candidate: Candidate; score: number }>();
  if (tab === "needs" && rows.length > 0) {
    const absAmounts = Array.from(new Set(rows.map((r) => Math.abs(r.amountCents))));
    const times = rows.map((r) => r.date.getTime());
    const windowMs = MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const from = new Date(Math.min(...times) - windowMs);
    const to = new Date(Math.max(...times) + windowMs);

    const [expenses, incomes, alreadyLinked] = await Promise.all([
      prisma.expense.findMany({
        where: { accountId, date: { gte: from, lte: to }, amountCents: { in: absAmounts } },
        select: { id: true, date: true, description: true, amountCents: true, vendorName: true },
      }),
      prisma.income.findMany({
        where: { accountId, date: { gte: from, lte: to }, amountCents: { in: absAmounts } },
        select: { id: true, date: true, description: true, amountCents: true, source: true },
      }),
      // An expense already tied to another bank line must not be offered
      // again — that is how one purchase ends up matched twice.
      prisma.bankTransaction.findMany({
        where: { accountId, status: "MATCHED" },
        select: { matchedExpenseId: true, matchedIncomeId: true },
      }),
    ]);

    const usedExpenses = new Set(alreadyLinked.map((l) => l.matchedExpenseId).filter(Boolean));
    const usedIncomes = new Set(alreadyLinked.map((l) => l.matchedIncomeId).filter(Boolean));

    const expenseCandidates: Candidate[] = expenses
      .filter((e) => !usedExpenses.has(e.id))
      .map((e) => ({ ...e, kind: "expense" as const, party: e.vendorName }));
    const incomeCandidates: Candidate[] = incomes
      .filter((i) => !usedIncomes.has(i.id))
      .map((i) => ({ ...i, kind: "income" as const, party: i.source }));

    for (const row of rows) {
      // Money out is matched against expenses, money in against income —
      // suggesting the wrong direction just invites a wrong tap.
      const pool = row.amountCents < 0 ? expenseCandidates : incomeCandidates;
      const best = rankCandidates(
        { date: row.date, description: row.description, amountCents: row.amountCents },
        pool,
        1,
      )[0];
      if (best) suggestions.set(row.id, best);
    }
  }

  // ——— What the matched rows point at ———
  const linkedExpenses = new Map<string, { id: string; description: string; amountCents: number }>();
  const linkedIncomes = new Map<string, { id: string; description: string; amountCents: number }>();
  if (tab === "matched" && rows.length > 0) {
    const expenseIds = rows.map((r) => r.matchedExpenseId).filter((v): v is string => !!v);
    const incomeIds = rows.map((r) => r.matchedIncomeId).filter((v): v is string => !!v);
    const [expenses, incomes] = await Promise.all([
      expenseIds.length
        ? prisma.expense.findMany({
            where: { accountId, id: { in: expenseIds } },
            select: { id: true, description: true, amountCents: true },
          })
        : Promise.resolve([]),
      incomeIds.length
        ? prisma.income.findMany({
            where: { accountId, id: { in: incomeIds } },
            select: { id: true, description: true, amountCents: true },
          })
        : Promise.resolve([]),
    ]);
    for (const e of expenses) linkedExpenses.set(e.id, e);
    for (const i of incomes) linkedIncomes.set(i.id, i);
  }

  // ——— The result of the last import, told straight ———
  const importedCount = sp.imported != null && /^\d+$/.test(sp.imported) ? Number(sp.imported) : null;
  const alreadyCount = sp.already != null && /^\d+$/.test(sp.already) ? Number(sp.already) : 0;
  const unreadableCount =
    sp.unreadable != null && /^\d+$/.test(sp.unreadable) ? Number(sp.unreadable) : 0;
  const skippedNote = [
    alreadyCount > 0
      ? `${alreadyCount} ${alreadyCount === 1 ? "line was" : "lines were"} already imported before, so ${alreadyCount === 1 ? "it was" : "they were"} skipped.`
      : null,
    unreadableCount > 0
      ? `${unreadableCount} ${unreadableCount === 1 ? "line" : "lines"} had no readable date or amount and ${unreadableCount === 1 ? "was" : "were"} left out.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <PageHeader
        title="Bank matching"
        sub="Upload your bank's file and see what isn't in the books yet."
        action={
          totalCount > 0 ? (
            <Link href="/banking/imports" className={btnSecondaryCls}>
              Imports
            </Link>
          ) : undefined
        }
      />

      {importedCount != null ? (
        importedCount > 0 ? (
          <SavedBanner
            title={`${importedCount} new ${importedCount === 1 ? "transaction" : "transactions"} added to the review list.`}
            hint={`${skippedNote ? skippedNote + " " : ""}Nothing has gone into your books yet — go down the list below and decide each one.`}
            actionHref={
              sp.batch
                ? `/banking/imports?confirm=${encodeURIComponent(sp.batch)}`
                : "/banking/imports"
            }
            actionLabel="Undo this import"
          />
        ) : (
          <SavedBanner
            title="Nothing new — that statement was already in."
            hint={`${
              alreadyCount > 0
                ? `All ${alreadyCount} ${alreadyCount === 1 ? "transaction" : "transactions"} in that file had been imported before, so nothing was added again. `
                : ""
            }That is the importer working, not failing: uploading the same file twice can never make duplicates.${unreadableCount > 0 ? ` ${unreadableCount} ${unreadableCount === 1 ? "line" : "lines"} had no readable date or amount and ${unreadableCount === 1 ? "was" : "were"} left out.` : ""}`}
          />
        )
      ) : null}

      {sp.matched ? (
        <SavedBanner
          title="Marked as matched."
          hint="It's off the review list. Nothing in your books changed — this only recorded that the two are the same thing. Tap Matched below to undo it."
        />
      ) : null}
      {sp.ignored ? (
        <SavedBanner
          title="Set aside as personal."
          hint="It won't ask again. It's still on file under Ignored if you change your mind."
        />
      ) : null}
      {sp.undone ? (
        <SavedBanner title="Back on the review list." hint="It's waiting for you under Needs review." />
      ) : null}
      {sp.error ? <FormError>{ERRORS[sp.error] ?? ERRORS.match}</FormError> : null}

      {totalCount === 0 ? (
        <Card className="mb-4 border-oak-200 bg-oak-50">
          <h2 className="font-semibold text-oak-900">How this works</h2>
          <ol className="mt-2 space-y-1.5 text-sm text-oak-900">
            <li>1. Sign in to your bank and download your transactions as a CSV file.</li>
            <li>2. Upload it here. You&apos;ll see which columns it read before anything is saved.</li>
            <li>
              3. The app lists every line and shows the ones that look like something you already
              recorded.
            </li>
            <li>
              4. You decide each one: yes that&apos;s it, add it as a new record, or set it aside as
              personal.
            </li>
          </ol>
          <p className="mt-3 text-sm font-semibold text-oak-900">
            Nothing in your books changes without your say-so. Uploading a file never creates an
            expense or income by itself.
          </p>
        </Card>
      ) : null}

      {totalCount > 0 ? (
        <p className="mb-3 text-sm text-stone-600">
          Nothing on this page changes your books on its own. Every line waits here until you say
          what it is.
        </p>
      ) : null}

      <ImportPanel hasTransactions={totalCount > 0} defaultBankName={lastProfile?.bankName ?? ""} />

      {totalCount === 0 ? (
        <EmptyState
          title="No bank transactions yet."
          hint="Once you upload a CSV from your bank, every line lands here so you can see what's missing from the books. Nothing gets recorded until you say so."
        />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <StatCard label="Needs review" value={String(needsCount)} tone={needsCount > 0 ? "red" : "green"} />
            <StatCard label="Matched" value={String(matchedCount)} tone="green" />
            <StatCard label="Ignored" value={String(ignoredCount)} />
          </div>

          <div className="mb-3 flex gap-2">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.key === "needs" ? "/banking" : `/banking?show=${t.key}`}
                className={`flex-1 rounded-xl border px-2 py-2 text-center text-sm font-medium ${
                  t.key === tab
                    ? "border-oak-600 bg-oak-700 text-white"
                    : "border-stone-300 bg-white text-stone-700"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={
                tab === "needs"
                  ? "Nothing left to review."
                  : tab === "matched"
                    ? "Nothing matched yet."
                    : "Nothing set aside."
              }
              hint={
                tab === "needs"
                  ? "Every line from your bank has been dealt with. Upload your next statement whenever you like."
                  : tab === "matched"
                    ? "When you tap “Yes, that's it” on a line, it moves here — and you can always put it back."
                    : "Lines you mark as personal end up here, out of the way but never deleted."
              }
            />
          ) : (
            <div className="space-y-2">
              {tabCount > rows.length ? (
                <p className="text-center text-xs text-stone-500">
                  Showing the newest {rows.length} of {tabCount}. Work through these and the rest
                  move up.
                </p>
              ) : null}

              {rows.map((t) => {
                const best = suggestions.get(t.id);
                const linked =
                  (t.matchedExpenseId ? linkedExpenses.get(t.matchedExpenseId) : null) ??
                  (t.matchedIncomeId ? linkedIncomes.get(t.matchedIncomeId) : null);
                return (
                  <Card key={t.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-stone-500">
                          {formatDate(t.date)} · {moneyDirectionLabel(t.amountCents)}
                          {t.bankName ? ` · ${t.bankName}` : ""}
                        </div>
                        <div className="mt-0.5 font-medium break-words text-stone-900">
                          {t.description}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-right font-semibold tabular-nums ${amountToneCls(t.amountCents)}`}
                      >
                        {amountWithSign(t.amountCents, formatCents(t.amountCents))}
                      </div>
                    </div>

                    {tab === "needs" ? (
                      <div className="mt-3 space-y-2">
                        {best ? (
                          <div className="rounded-xl border border-oak-200 bg-oak-50 p-3">
                            <p className="text-sm font-semibold text-oak-900">
                              {best.score >= STRONG_MATCH_SCORE
                                ? "This is almost certainly already recorded:"
                                : "This might already be recorded:"}
                            </p>
                            <p className="mt-0.5 text-sm text-oak-900">
                              {best.candidate.description}
                              {best.candidate.party ? ` — ${best.candidate.party}` : ""}
                            </p>
                            <p className="text-xs text-oak-800">
                              {best.candidate.kind === "expense" ? "Expense" : "Income"} ·{" "}
                              {formatDate(best.candidate.date)} ·{" "}
                              {formatCents(best.candidate.amountCents)}
                            </p>
                            <form action={markMatched} className="mt-2">
                              <input type="hidden" name="txnId" value={t.id} />
                              <input type="hidden" name="show" value={tab} />
                              <input
                                type="hidden"
                                name={best.candidate.kind === "expense" ? "expenseId" : "incomeId"}
                                value={best.candidate.id}
                              />
                              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                                Yes, that&apos;s it
                              </button>
                            </form>
                          </div>
                        ) : null}

                        <Link href={newRecordHref(t)} className={`${btnSecondaryCls} w-full`}>
                          {t.amountCents < 0 ? "Add it as a new expense" : "Add it as new income"}
                        </Link>

                        <form action={markIgnored}>
                          <input type="hidden" name="txnId" value={t.id} />
                          <input type="hidden" name="show" value={tab} />
                          <button type="submit" className={`${btnSecondaryCls} w-full`}>
                            Ignore / personal
                          </button>
                        </form>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {tab === "matched" ? (
                          <p className="text-sm text-stone-600">
                            {linked ? (
                              <>
                                Recorded as <span className="font-medium">{linked.description}</span>{" "}
                                ({formatCents(linked.amountCents)}).
                              </>
                            ) : (
                              <>
                                Marked as matched. The record it pointed at is no longer here — put
                                it back on the list if it needs another look.
                              </>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm text-stone-600">
                            Set aside as personal — not part of the business books.
                          </p>
                        )}
                        <form action={putBackOnList}>
                          <input type="hidden" name="txnId" value={t.id} />
                          <input type="hidden" name="show" value={tab} />
                          <button type="submit" className={`${btnSecondaryCls} w-full`}>
                            Put back on the review list
                          </button>
                        </form>
                      </div>
                    )}

                    {tab !== "needs" ? (
                      <div className="mt-2">
                        <Chip tone={bankStatusTone(t.status)}>
                          {BANK_TXN_STATUS_LABELS[t.status as BankTxnStatus] ?? t.status}
                        </Chip>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-center">
            <Link href="/banking/imports" className="text-sm font-medium text-oak-700">
              See every import — and undo one
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
