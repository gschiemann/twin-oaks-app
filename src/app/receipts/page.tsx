import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { RECEIPT_STATUS_LABELS, type ReceiptStatus } from "@/lib/domain";
import { duplicateHeadline, findLikelyDuplicatesForMany } from "@/lib/receipt-dupes";
import { Card, Chip, EmptyState, PageHeader, SavedBanner, btnPrimaryCls } from "@/components/ui";
import { TrashIcon } from "@/components/Icons";
import { ReceiptThumb, receiptStatusTone } from "./receipt-bits";
import DuplicateWarning from "./DuplicateWarning";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "review", label: "Needs review" },
  { key: "all", label: "All" },
] as const;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    saved?: string;
    categorized?: string;
    updated?: string;
    archived?: string;
    deleted?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const { tab = "inbox", saved, categorized, updated, archived, deleted } = await searchParams;

  const where = {
    accountId,
    ...(tab === "inbox"
      ? { status: "INBOX" }
      : tab === "review"
        ? { status: { in: ["NEEDS_REVIEW", "TAX_UNCERTAIN", "SPLIT_PERSONAL"] } }
        : {}),
  };

  const [receipts, inboxCount] = await Promise.all([
    prisma.receipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.receipt.count({ where: { accountId, status: "INBOX" } }),
  ]);

  // SPEC §4 — the Inbox flags possible duplicates. One extra query for the
  // whole page (not one per row), and it can never throw: a warning that
  // can't be worked out just isn't shown. An archived receipt was already
  // dealt with, so it is never warned about again.
  const duplicates = await findLikelyDuplicatesForMany(
    accountId,
    receipts.filter((r) => r.status !== "ARCHIVED"),
  );

  return (
    <div>
      <PageHeader
        title="Receipts"
        sub="Snap now, categorize later — originals are stored permanently."
        action={
          <Link href="/receipts/new" className={btnPrimaryCls}>
            Add receipt
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Receipt saved."
          hint="It's in your Inbox below — no rush, you can categorize it any time."
          actionHref="/receipts/new"
          actionLabel="Add another receipt"
        />
      ) : null}

      {updated ? (
        <SavedBanner
          title="Receipt updated."
          hint="Your changes are saved. It's in the list below."
        />
      ) : null}

      {categorized ? (
        <SavedBanner
          title="Receipt filed."
          hint="It's recorded under Expenses. Tap the next receipt below to file that one too."
        />
      ) : null}

      {deleted ? (
        <SavedBanner title="Receipt deleted." />
      ) : null}

      {archived ? (
        <SavedBanner title="Receipt archived." hint="Find it under the All tab." />
      ) : null}

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/receipts?tab=${t.key}`}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              tab === t.key
                ? "bg-oak-700 text-white"
                : "border border-stone-300 bg-white text-stone-600"
            }`}
          >
            {t.label}
            {t.key === "inbox" && inboxCount > 0 ? ` (${inboxCount})` : ""}
          </Link>
        ))}
      </div>

      {receipts.length === 0 ? (
        <EmptyState
          title={tab === "inbox" ? "Inbox zero — nothing waiting." : "No receipts here yet."}
          hint="Use Add receipt (or the + button) to snap a photo the moment you get a receipt."
          actionHref="/receipts/new"
          actionLabel="Add receipt"
        />
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => {
            const dupe = duplicates.get(r.id)?.[0];
            return (
              <div key={r.id}>
                {/* The row's tap target and the bin are SIBLINGS inside the
                    card, never nested — a link inside a link is broken on a
                    phone (same reason the duplicate warning sits outside). */}
                <Card className="flex items-center gap-2">
                  <Link
                    href={`/receipts/${r.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60"
                  >
                    <ReceiptThumb filePath={r.filePath} mimeType={r.mimeType} source={r.source} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-stone-900">
                        {r.vendorName ?? "Unknown vendor"}
                      </div>
                      <div className="truncate text-sm text-stone-500">
                        {r.source === "EMAIL" && r.emailSubject
                          ? r.emailSubject
                          : `${formatDate(r.receiptDate)} · added ${formatDate(r.createdAt)}`}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Chip tone={receiptStatusTone(r.status)}>
                          {RECEIPT_STATUS_LABELS[r.status as ReceiptStatus] ?? r.status}
                        </Chip>
                        {r.source === "EMAIL" ? <Chip tone="blue">✉️ Emailed in</Chip> : null}
                        {dupe ? <Chip tone="amber">Possible duplicate</Chip> : null}
                      </div>
                    </div>
                    <div className="text-right font-bold tabular-nums text-stone-900">
                      {formatCents(r.totalCents)}
                    </div>
                  </Link>
                  {/* Goes to the same question the receipt page asks — a
                      stray thumb while scrolling must never destroy an
                      original. 44px tap target, Apple's minimum. */}
                  <Link
                    href={`/receipts/${r.id}?confirm=delete&from=list`}
                    aria-label={`Delete the ${r.vendorName ?? "unknown vendor"} receipt`}
                    className="-mr-1.5 shrink-0 rounded-xl p-3 text-stone-400 active:bg-red-50 active:text-red-600"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </Link>
                </Card>

                {/* Outside the row's link on purpose: this card has its own
                    link and buttons, and a link inside a link is broken on a
                    phone. It warns; it never blocks anything. */}
                {dupe ? (
                  <div className="mt-2">
                    <DuplicateWarning
                      receiptId={r.id}
                      headline={duplicateHeadline(dupe)}
                      why={dupe.why}
                      otherReceiptId={dupe.id}
                      otherLabel={[formatDate(dupe.receiptDate), formatCents(dupe.totalCents)]
                        .filter((s) => s !== "—")
                        .join(" · ")}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
