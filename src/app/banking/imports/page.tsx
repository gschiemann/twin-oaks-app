// Import history — the undo button for a bad upload.
//
// If the columns were confirmed wrong (dates read day-first, money out read
// as money in), the recovery is to remove the whole import and do it again.
// Removing an import deletes the imported BANK LINES only. It never touches
// an Expense or an Income, and it never touches a receipt — see the note on
// the confirm card, which says exactly that to the operator too.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { EMPTY_MAPPING, mappingIsUsable, type ColumnMapping } from "@/lib/bank-import";
import {
  Card,
  Chip,
  EmptyState,
  FormError,
  PageHeader,
  SavedBanner,
  btnPrimaryCls,
  btnSecondaryCls,
} from "@/components/ui";
import { deleteImportBatch } from "../actions";
import { describeMapping } from "../bank-bits";

export const dynamic = "force-dynamic";

/** Same shape-check the import action uses, kept local because a "use server"
 *  module can only export async functions. */
function mappingFromJson(json: string): ColumnMapping | null {
  try {
    const raw = JSON.parse(json) as Partial<Record<keyof ColumnMapping, unknown>>;
    const index = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
    const mapping: ColumnMapping = {
      ...EMPTY_MAPPING,
      date: index(raw.date),
      description: index(raw.description),
      amount: index(raw.amount),
      debit: index(raw.debit),
      credit: index(raw.credit),
      balance: index(raw.balance),
      outSign: raw.outSign === "positive" ? "positive" : "negative",
    };
    return mappingIsUsable(mapping) ? mapping : null;
  } catch {
    return null;
  }
}

export default async function BankImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; removed?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { confirm, removed, error } = await searchParams;

  const [batches, statusRows, profiles, looseCount] = await Promise.all([
    prisma.bankTransaction.groupBy({
      by: ["importBatchId", "bankName"],
      where: { accountId, importBatchId: { not: null } },
      _count: { _all: true },
      _min: { date: true, createdAt: true },
      _max: { date: true },
    }),
    prisma.bankTransaction.groupBy({
      by: ["importBatchId", "status"],
      where: { accountId, importBatchId: { not: null } },
      _count: { _all: true },
    }),
    prisma.bankImportProfile.findMany({
      where: { accountId },
      orderBy: { bankName: "asc" },
      select: { id: true, bankName: true, mappingJson: true, updatedAt: true },
    }),
    prisma.bankTransaction.count({ where: { accountId, importBatchId: null } }),
  ]);

  const byBatchStatus = new Map<string, Map<string, number>>();
  for (const r of statusRows) {
    if (!r.importBatchId) continue;
    const inner = byBatchStatus.get(r.importBatchId) ?? new Map<string, number>();
    inner.set(r.status, r._count._all);
    byBatchStatus.set(r.importBatchId, inner);
  }

  // Newest import first — the one most likely to be the mistake. The batch
  // being confirmed jumps to the top, because the action redirects back here
  // and the question must not land below the fold on a phone.
  const sorted = batches
    .filter((b): b is typeof b & { importBatchId: string } => !!b.importBatchId)
    .sort((a, b) => {
      if (a.importBatchId === confirm) return -1;
      if (b.importBatchId === confirm) return 1;
      return (b._min.createdAt?.getTime() ?? 0) - (a._min.createdAt?.getTime() ?? 0);
    });

  const removedCount = removed != null && /^\d+$/.test(removed) ? Number(removed) : null;

  return (
    <div>
      <PageHeader
        title="Imports"
        sub="Every bank file you've uploaded — and how to take one back."
        action={
          <Link href="/banking" className={btnSecondaryCls}>
            Back
          </Link>
        }
      />

      {removedCount != null ? (
        <SavedBanner
          title={
            removedCount > 0
              ? `Removed ${removedCount} imported ${removedCount === 1 ? "line" : "lines"}.`
              : "That import was already gone."
          }
          hint="Only the bank lines were removed. Every expense, income and receipt in your books is untouched. You can upload that statement again any time."
          actionHref="/banking"
          actionLabel="Back to bank matching"
        />
      ) : null}

      {error ? (
        <FormError>
          That import couldn&apos;t be removed — it may already be gone. The list below is up to
          date.
        </FormError>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          title="Nothing imported yet."
          hint="Upload a CSV from your bank and it will show up here, so you can always undo one."
          actionHref="/banking"
          actionLabel="Upload a bank file"
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((b) => {
            const counts = byBatchStatus.get(b.importBatchId) ?? new Map<string, number>();
            const needs = counts.get("UNMATCHED") ?? 0;
            const matched = counts.get("MATCHED") ?? 0;
            const ignored = counts.get("IGNORED") ?? 0;
            const confirming = confirm === b.importBatchId;
            return (
              <Card key={b.importBatchId} className={confirming ? "border-2 border-red-300" : ""}>
                <div className="font-semibold text-stone-900">{b.bankName ?? "Bank file"}</div>
                <div className="text-sm text-stone-500">
                  Uploaded {formatDate(b._min.createdAt)} · {b._count._all}{" "}
                  {b._count._all === 1 ? "line" : "lines"}
                </div>
                <div className="text-sm text-stone-500">
                  Covering {formatDate(b._min.date)} to {formatDate(b._max.date)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {needs > 0 ? <Chip tone="amber">{needs} still to review</Chip> : null}
                  {matched > 0 ? <Chip tone="green">{matched} matched</Chip> : null}
                  {ignored > 0 ? <Chip tone="stone">{ignored} ignored</Chip> : null}
                </div>

                {confirming ? (
                  <div className="mt-3 rounded-xl border-2 border-red-300 bg-red-50 p-3">
                    <p className="text-base font-semibold text-red-900">
                      Remove all {b._count._all} {b._count._all === 1 ? "line" : "lines"} from this
                      import?
                    </p>
                    <p className="mt-1 text-sm text-red-800">
                      This takes the bank lines off the review list, including any you already
                      matched or ignored. <strong>Your books are not touched</strong> — no expense,
                      income or receipt is deleted. You can upload the same file again afterwards.
                    </p>
                    <form action={deleteImportBatch} className="mt-3">
                      <input type="hidden" name="batchId" value={b.importBatchId} />
                      <input type="hidden" name="confirm" value="yes" />
                      <button
                        type="submit"
                        className={`${btnPrimaryCls} w-full bg-red-700 active:bg-red-800`}
                      >
                        Yes, remove this import
                      </button>
                    </form>
                    <Link href="/banking/imports" className={`${btnSecondaryCls} mt-2 w-full`}>
                      Keep it
                    </Link>
                  </div>
                ) : (
                  <form action={deleteImportBatch} className="mt-3">
                    <input type="hidden" name="batchId" value={b.importBatchId} />
                    <button type="submit" className={`${btnSecondaryCls} w-full`}>
                      Remove this import
                    </button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {looseCount > 0 ? (
        <p className="mt-3 text-center text-xs text-stone-500">
          {looseCount} older {looseCount === 1 ? "line was" : "lines were"} added before imports were
          grouped, so {looseCount === 1 ? "it isn't" : "they aren't"} listed above. They still show
          up on the review list.
        </p>
      ) : null}

      {profiles.length > 0 ? (
        <Card className="mt-4">
          <h2 className="font-semibold text-stone-900">Columns we remember</h2>
          <p className="mt-0.5 text-sm text-stone-600">
            Next time you upload from one of these, the columns are already set the way you
            confirmed. You can still change them before importing.
          </p>
          <div className="mt-2 space-y-2">
            {profiles.map((p) => {
              const mapping = mappingFromJson(p.mappingJson);
              return (
                <div key={p.id} className="rounded-xl bg-stone-50 p-2.5">
                  <div className="font-medium text-stone-800">{p.bankName}</div>
                  <div className="text-xs text-stone-500">
                    {mapping
                      ? describeMapping(mapping, null)
                      : "Saved settings couldn't be read — you'll be asked about the columns again."}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="mt-4 text-center">
        <Link href="/banking" className="text-sm font-medium text-oak-700">
          Back to bank matching
        </Link>
      </div>
    </div>
  );
}
