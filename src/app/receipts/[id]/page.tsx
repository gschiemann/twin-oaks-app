import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  PAYMENT_METHODS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  type ReceiptStatus,
} from "@/lib/domain";
import { duplicateHeadline, findLikelyDuplicates } from "@/lib/receipt-dupes";
import {
  Card,
  FormError,
  PageHeader,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { fileSrc } from "@/lib/storage";
import SolidFileInput from "@/components/SolidFileInput";
import {
  archiveReceipt,
  attachReceiptFile,
  deleteReceipt,
  unarchiveReceipt,
  updateReceipt,
} from "../actions";
import DuplicateWarning from "../DuplicateWarning";
import ReceiptLines from "../ReceiptLines";
import { splitByCategory } from "../receipt-lines";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    attach?: string;
    error?: string;
    ld?: string;
    lq?: string;
    la?: string;
    lc?: string;
    // Set by the first press of Delete — the page then asks before doing it.
    confirm?: string;
    // "list" when the bin on the receipts list started this, so "No, keep it"
    // goes back where they were instead of stranding them here.
    from?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { attach, error, ld, lq, la, lc, confirm, from } = await searchParams;
  const receipt = await prisma.receipt.findFirst({
    where: { id, accountId },
    include: { expense: true },
  });
  if (!receipt) notFound();

  const [lines, duplicates] = await Promise.all([
    prisma.receiptLine.findMany({
      where: { receiptId: receipt.id, accountId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    // SPEC §4 — a warning, never a gate. A receipt that has already been
    // archived was dealt with, so it gets no warning at all.
    receipt.status === "ARCHIVED" ? Promise.resolve([]) : findLikelyDuplicates(accountId, receipt),
  ]);

  // When this receipt was split by category it produced several expenses, but
  // the schema can only point a receipt at one of them. The rest are found by
  // the exact shape the split created them with — same vendor, same day, one
  // of this receipt's own line categories. Display only, never a write.
  const splitCategories = splitByCategory(lines).map((c) => c.accountingCategory);
  const splitSiblings =
    receipt.expenseId && splitCategories.length > 1 && receipt.receiptDate && receipt.vendorName
      ? await prisma.expense.findMany({
          where: {
            accountId,
            id: { not: receipt.expenseId },
            vendorName: receipt.vendorName,
            date: receipt.receiptDate,
            accountingCategory: { in: splitCategories },
          },
          orderBy: { amountCents: "desc" },
          take: 10,
          select: { id: true, description: true, amountCents: true },
        })
      : [];

  const isImage = receipt.mimeType?.startsWith("image/");

  return (
    <div>
      <PageHeader
        title={receipt.vendorName ?? "Receipt"}
        sub={`Status: ${RECEIPT_STATUS_LABELS[receipt.status as ReceiptStatus] ?? receipt.status}`}
      />

      {confirm === "delete" ? (
        <Card className="mb-4 border-2 border-red-300 bg-red-50">
          <p className="text-base font-semibold text-red-900">Delete this receipt?</p>
          <div className="mt-3 flex gap-2">
            <form action={deleteReceipt} className="flex-1">
              <input type="hidden" name="id" value={receipt.id} />
              <button
                type="submit"
                className={`${btnPrimaryCls} w-full bg-red-700 active:bg-red-800`}
              >
                Delete
              </button>
            </form>
            <Link
              href={from === "list" ? "/receipts" : `/receipts/${receipt.id}`}
              className={`${btnSecondaryCls} flex-1`}
            >
              Cancel
            </Link>
          </div>
        </Card>
      ) : null}

      {error ? (
        <FormError>
          A line needs both a description and an amount (like 12.99) before it can be saved —
          everything else on it is optional. Nothing on this receipt was changed. Fill in those two
          in the itemised list below and tap the button again.
        </FormError>
      ) : null}

      {duplicates.map((d) => (
        <DuplicateWarning
          key={d.id}
          receiptId={receipt.id}
          headline={duplicateHeadline(d)}
          why={d.why}
          otherReceiptId={d.id}
          otherLabel={[formatDate(d.receiptDate), formatCents(d.totalCents)]
            .filter((s) => s !== "—")
            .join(" · ")}
        />
      ))}

      {receipt.source === "EMAIL" ? (
        <Card className="mb-4 border-sky-200 bg-sky-50">
          <p className="text-sm font-medium text-sky-900">✉️ Forwarded by email</p>
          {receipt.emailFrom ? (
            <p className="text-xs text-sky-800">From {receipt.emailFrom}</p>
          ) : null}
          {receipt.emailSubject ? (
            <p className="truncate text-xs text-sky-800">“{receipt.emailSubject}”</p>
          ) : null}
          <p className="mt-1 text-xs text-sky-700">
            Details below were read automatically — check them before categorizing.
          </p>
        </Card>
      ) : null}

      {receipt.filePath ? (
        <a
          href={fileSrc(receipt.filePath)}
          target="_blank"
          rel="noreferrer"
          className="mb-4 block"
        >
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileSrc(receipt.filePath)}
              alt="Receipt original"
              className="max-h-96 w-full rounded-2xl border border-stone-200 bg-white object-contain"
            />
          ) : (
            <Card className="text-center text-sm font-medium text-stone-600">
              {receipt.source === "EMAIL"
                ? "✉️ Open the forwarded email"
                : `📄 ${receipt.fileName ?? "Document"} — tap to open`}
            </Card>
          )}
        </a>
      ) : (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-stone-700">
            No file attached yet — add the photo or emailed PDF:
          </p>
          {attach === "empty" ? (
            <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              That file arrived empty (0 bytes) — nothing was attached. Open it once in the Files
              app so it downloads from iCloud, then pick it again.
            </p>
          ) : null}
          <form action={attachReceiptFile} className="flex items-start gap-2">
            <input type="hidden" name="id" value={receipt.id} />
            {/* No `capture` here on purpose: on iOS it hides Photo Library
                and Files, which is exactly where an emailed PDF lives. */}
            <div className="min-w-0 flex-1">
              <SolidFileInput
                name="file"
                accept="image/*,application/pdf,.pdf,.heic,.heif"
                className="w-full text-sm text-stone-600 file:mr-2 file:rounded-lg file:border-0 file:bg-oak-700 file:px-3 file:py-1.5 file:font-semibold file:text-white"
              />
            </div>
            <button type="submit" className={btnSecondaryCls}>
              Attach
            </button>
          </form>
        </Card>
      )}

      {receipt.expense ? (
        <Card className="mb-4 border-oak-200 bg-oak-50">
          <p className="text-sm text-oak-800">
            Categorized as expense:{" "}
            <Link href={`/expenses/${receipt.expense.id}`} className="font-semibold underline">
              {receipt.expense.description} · {formatCents(receipt.expense.amountCents)}
            </Link>
          </p>
          {splitSiblings.length > 0 ? (
            <div className="mt-2 border-t border-oak-200 pt-2">
              <p className="text-sm font-medium text-oak-900">
                Split by category — also filed from this receipt:
              </p>
              <ul className="mt-1 space-y-1">
                {splitSiblings.map((e) => (
                  <li key={e.id} className="text-sm text-oak-800">
                    <Link href={`/expenses/${e.id}`} className="font-semibold underline">
                      {e.description} · {formatCents(e.amountCents)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : (
        <Link
          href={`/expenses/new?fromReceipt=${receipt.id}`}
          className={`${btnPrimaryCls} mb-4 w-full`}
        >
          File this receipt into Expenses
        </Link>
      )}

      <ReceiptLines
        receiptId={receipt.id}
        lines={lines}
        totalCents={receipt.totalCents}
        salesTaxCents={receipt.salesTaxCents}
        canCategorize={!receipt.expenseId}
        typed={{ description: ld, quantity: lq, amount: la, category: lc }}
      />

      <Card>
        <h2 className="mb-3 font-semibold text-stone-900">Receipt details</h2>
        <form action={updateReceipt} className="space-y-3">
          <input type="hidden" name="id" value={receipt.id} />
          <div>
            <label className={labelCls} htmlFor="vendorName">
              Vendor
            </label>
            <input
              id="vendorName"
              name="vendorName"
              defaultValue={receipt.vendorName ?? ""}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="receiptDate">
                Date
              </label>
              <input
                id="receiptDate"
                name="receiptDate"
                type="date"
                defaultValue={receipt.receiptDate ? toDateInputValue(receipt.receiptDate) : ""}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="total">
                Total
              </label>
              <input
                id="total"
                name="total"
                inputMode="decimal"
                defaultValue={receipt.totalCents != null ? (receipt.totalCents / 100).toFixed(2) : ""}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="salesTax">
                Sales tax
              </label>
              <input
                id="salesTax"
                name="salesTax"
                inputMode="decimal"
                defaultValue={
                  receipt.salesTaxCents != null ? (receipt.salesTaxCents / 100).toFixed(2) : ""
                }
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
                defaultValue={receipt.paymentMethod ?? ""}
                className={inputCls}
              >
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="receiptNumber">
              Receipt #
            </label>
            <input
              id="receiptNumber"
              name="receiptNumber"
              defaultValue={receipt.receiptNumber ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={receipt.status} className={inputCls}>
              {RECEIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RECEIPT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={receipt.notes ?? ""}
              className={inputCls}
            />
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save details
          </button>
        </form>
      </Card>

      {/* Getting rid of a receipt. Archiving is offered first and framed as
          the normal choice, because this app's whole promise is that the
          original is kept forever — deleting is the exception, so it asks
          before it does anything. */}
      {confirm === "delete" ? null : (
        <Card className="mt-4">
          <div className="flex gap-2">
            <form action={receipt.status === "ARCHIVED" ? unarchiveReceipt : archiveReceipt} className="flex-1">
              <input type="hidden" name="id" value={receipt.id} />
              <button type="submit" className={`${btnSecondaryCls} w-full`}>
                {receipt.status === "ARCHIVED" ? "Unarchive" : "Archive"}
              </button>
            </form>
            <Link
              href={`/receipts/${receipt.id}?confirm=delete`}
              className={`${btnSecondaryCls} flex-1 text-red-600`}
            >
              Delete
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
