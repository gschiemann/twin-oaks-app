import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { getBusinessProfile } from "@/lib/business";
import { Card, FormError, PageHeader, inputCls, labelCls } from "@/components/ui";
import { ReceiptThumb } from "../../receipts/receipt-bits";
import { splitByCategory, uncategorized } from "../../receipts/receipt-lines";
import { formatCents } from "@/lib/money";
import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { suggestCategoriesFor, suggestionNote } from "@/lib/vendor-history";
import ExpenseForm from "../ExpenseForm";
import { createExpense, createSplitExpensesFromReceipt } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{
    fromReceipt?: string;
    assetId?: string;
    error?: string;
    d?: string;
    v?: string;
    a?: string;
    // Prefill carried over from a bank line at /banking.
    date?: string;
    fromBankTxn?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const { fromReceipt, assetId, error, d, v, a, date, fromBankTxn } = await searchParams;

  const [vendors, assets, receipt, profile] = await Promise.all([
    prisma.vendor.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.asset.findMany({
      where: { accountId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    fromReceipt
      ? prisma.receipt.findFirst({ where: { id: fromReceipt, accountId } })
      : Promise.resolve(null),
    getBusinessProfile(accountId),
  ]);

  // FR-006 — the receipt's own itemisation, when it has one.
  const lines = receipt
    ? await prisma.receiptLine.findMany({
        where: { receiptId: receipt.id, accountId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      })
    : [];
  const parts = splitByCategory(lines);
  const leftover = uncategorized(lines);
  const canSplit = Boolean(receipt) && parts.length > 1;

  // FR-006 — what this account usually files this vendor under.
  const suggestion = await suggestCategoriesFor(accountId, receipt?.vendorName);

  // A form coming BACK from a rejected save is carrying the operator's own
  // typing. Their category choice isn't in the URL, so the suggestion must not
  // step in and quietly pick one for them — it stays a note, nothing more.
  const isBounce = Boolean(error || d || v || a);
  const suggestedAccounting = !isBounce ? suggestion?.accounting.value : undefined;
  const suggestedManagement = !isBounce ? suggestion?.management?.value : undefined;

  const defaultDivision: Division = profile.divisions.includes("FARM")
    ? "FARM"
    : profile.divisions[0];

  return (
    <div>
      <PageHeader
        title={receipt ? "Categorize receipt" : "Add expense"}
        sub="Every dollar out gets a record, a category, and (ideally) a receipt."
      />

      {error === "split" ? (
        <FormError>
          That receipt couldn&apos;t be split. A split needs its lines to name at least two
          different categories — add categories to the lines on the receipt itself, or just fill
          in the form below to file it as one expense.
        </FormError>
      ) : error ? (
        <FormError>
          The Amount needs to be numbers only (like 42.75) and the Description can&apos;t be blank.
          What you typed is still here — fix those two and tap Save expense again.
        </FormError>
      ) : null}

      {receipt ? (
        <Card className="mb-4 flex items-center gap-3 border-oak-200 bg-oak-50">
          <ReceiptThumb filePath={receipt.filePath} mimeType={receipt.mimeType} />
          <div className="text-sm text-oak-900">
            <div className="font-semibold">Creating expense from receipt</div>
            <div>
              {receipt.vendorName ?? "Unknown vendor"} · {formatCents(receipt.totalCents)}
            </div>
          </div>
        </Card>
      ) : null}

      {receipt && canSplit ? (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <h2 className="text-base font-semibold text-amber-900">
            This receipt covers {parts.length} categories
          </h2>
          <p className="mt-0.5 text-sm text-amber-800">
            You can file it as one expense per category instead of one lump sum. Your choice —
            nothing happens until you tap.
          </p>
          <ul className="mt-2 space-y-1">
            {parts.map((p) => (
              <li
                key={p.accountingCategory}
                className="flex items-baseline justify-between gap-3 text-sm text-amber-900"
              >
                <span className="font-medium">{p.accountingCategory}</span>
                <span className="tabular-nums font-semibold">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
          {leftover.lineCount > 0 ? (
            <p className="mt-2 text-xs text-amber-800">
              {leftover.lineCount} line{leftover.lineCount === 1 ? "" : "s"} (
              {formatCents(leftover.amountCents)}) still have no category, so they wouldn&apos;t be
              included. Give them a category on the receipt first if you want them in.
            </p>
          ) : null}

          <form action={createSplitExpensesFromReceipt} className="mt-3 space-y-2">
            <input type="hidden" name="fromReceiptId" value={receipt.id} />
            {profile.divisions.length > 1 ? (
              <div>
                <label className={labelCls} htmlFor="split-division">
                  Which side of the business?
                </label>
                <select
                  id="split-division"
                  name="division"
                  defaultValue={defaultDivision}
                  className={inputCls}
                >
                  {profile.divisions.map((dv) => (
                    <option key={dv} value={dv}>
                      {DIVISION_LABELS[dv]}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="division" value={defaultDivision} />
            )}
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-100 px-4 py-2.5 text-base font-semibold text-amber-900 active:bg-amber-200"
            >
              Split it — create {parts.length} expenses, one per category
            </button>
          </form>
          <p className="mt-2 text-xs text-amber-700">
            Each one is linked to this same receipt and starts at &ldquo;requires accountant
            review&rdquo;, like every other expense. Or ignore this and use the form below.
          </p>
        </Card>
      ) : null}

      <Card>
        {canSplit ? (
          <p className="mb-3 text-sm font-medium text-stone-600">
            Or file the whole receipt as one expense:
          </p>
        ) : null}
        <ExpenseForm
          action={createExpense}
          submitLabel="Save expense"
          vendors={vendors.map((v) => v.name)}
          assets={assets}
          divisions={profile.divisions}
          fromReceiptId={receipt?.id}
          fromBankTxnId={fromBankTxn}
          categoryNote={suggestion ? suggestionNote(suggestion) : null}
          defaults={{
            vendorName: v ?? receipt?.vendorName,
            // The scan already worked out what was bought — don't make the
            // operator invent prose for a required field on the one screen
            // they reached by tapping "Categorize".
            description:
              d ??
              (receipt?.notes && receipt.notes.length <= 70
                ? receipt.notes
                : (receipt?.vendorName ?? undefined)),
            amountRaw: a,
            amountCents: receipt?.totalCents,
            salesTaxCents: receipt?.salesTaxCents,
            paymentMethod: receipt?.paymentMethod,
            date: parseDateInput(date ?? null) ?? receipt?.receiptDate ?? undefined,
            assetId: assetId ?? undefined,
            // Suggested from this account's own history — and only when the
            // operator hasn't already been through this form once.
            accountingCategory: suggestedAccounting,
            managementCategory: suggestedManagement,
          }}
        />
      </Card>
    </div>
  );
}
