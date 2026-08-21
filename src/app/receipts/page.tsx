import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { RECEIPT_STATUS_LABELS, type ReceiptStatus } from "@/lib/domain";
import { Card, Chip, EmptyState, PageHeader, SavedBanner, btnPrimaryCls } from "@/components/ui";
import { ReceiptThumb, receiptStatusTone } from "./receipt-bits";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "review", label: "Needs review" },
  { key: "all", label: "All" },
] as const;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; categorized?: string; updated?: string }>;
}) {
  const accountId = await requireAccountId();
  const { tab = "inbox", saved, categorized, updated } = await searchParams;

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
          {receipts.map((r) => (
            <Link key={r.id} href={`/receipts/${r.id}`} className="block">
              <Card className="flex items-center gap-3 active:bg-stone-50">
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
                  </div>
                </div>
                <div className="text-right font-bold tabular-nums text-stone-900">
                  {formatCents(r.totalCents)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
