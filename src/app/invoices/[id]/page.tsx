import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  DIVISION_LABELS,
  PAYMENT_METHODS,
  PRODUCT_TYPE_LABELS,
  type Division,
  type ProductType,
} from "@/lib/domain";
import { periodOf } from "@/lib/sales-tax/format";
import { allocatePaymentTax } from "@/lib/sales-tax/split";
import {
  Card,
  Chip,
  PageHeader,
  SavedBanner,
  btnPrimaryCls,
  btnSecondaryCls,
  divisionTone,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  INVOICE_STATUS_LABELS,
  deriveInvoiceStatus,
  invoiceStatusTone,
  paidCentsOf,
} from "../invoice-bits";
import { formatRate } from "@/lib/tax";
import {
  convertQuote,
  deleteInvoice,
  deletePayment,
  recordPayment,
  removeTaxFromIncome,
  setInvoiceStatus,
} from "../actions";
import DocumentsCard from "@/components/DocumentsCard";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  "not-draft": "Only draft invoices can be edited — once sent, an invoice is a financial record.",
  cancelled: "Payments can't be recorded on a cancelled invoice.",
  amount: "That payment needs a valid amount — nothing was recorded.",
  quote: "Quotes don't take payments — convert it to an invoice first.",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; fix?: string; saved?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error, fix, saved } = await searchParams;
  const invoice = await prisma.invoice.findFirst({
    where: { id, accountId },
    include: {
      customer: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { date: "desc" } },
    },
  });
  if (!invoice) notFound();

  const paidCents = paidCentsOf(invoice.payments);
  const status = deriveInvoiceStatus(invoice, paidCents);
  const balanceCents = invoice.totalCents - paidCents;
  const isQuote = invoice.kind === "QUOTE";
  const taxableCents = invoice.lines.reduce((s, l) => s + (l.taxable ? l.totalCents : 0), 0);
  const [taxLocation, salesTaxOn] = await Promise.all([
    invoice.taxLocationId
      ? prisma.taxLocation.findFirst({
          where: { id: invoice.taxLocationId, accountId },
          select: { name: true },
        })
      : null,
    prisma.taxAuthority.count({ where: { accountId } }).then((n) => n > 0),
  ]);
  const salesTaxReview =
    salesTaxOn &&
    !isQuote &&
    invoice.status !== "CANCELLED" &&
    (!taxLocation || invoice.lines.some((l) => l.productType === "UNCLASSIFIED"));
  // Each payment's sales tax share (recording order), and whether its income
  // row still holds that tax — payments booked before the split do.
  const recorded = [...invoice.payments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const shares = allocatePaymentTax(
    invoice.totalCents,
    invoice.salesTaxCents,
    recorded.map((p) => p.amountCents),
  );
  const taxShareOf = new Map(recorded.map((p, i) => [p.id, shares[i]]));
  const incomeIds = invoice.payments.map((p) => p.incomeId).filter((v): v is string => !!v);
  const incomes = incomeIds.length
    ? await prisma.income.findMany({
        where: { accountId, id: { in: incomeIds } },
        select: { id: true, amountCents: true },
      })
    : [];
  const incomeById = new Map(incomes.map((i) => [i.id, i]));
  const taxInIncome = (p: (typeof invoice.payments)[number]): number => {
    const inc = p.incomeId ? incomeById.get(p.incomeId) : undefined;
    const share = taxShareOf.get(p.id) ?? 0;
    return inc && share > 0 && inc.amountCents >= p.amountCents ? share : 0;
  };
  const fixing = fix ? invoice.payments.find((p) => p.id === fix && taxInIncome(p) > 0) : undefined;
  const fixingIncome = fixing?.incomeId ? incomeById.get(fixing.incomeId) : undefined;
  const acceptedInvoice = invoice.convertedToInvoiceId
    ? await prisma.invoice.findFirst({
        where: { id: invoice.convertedToInvoiceId, accountId },
        select: { id: true, number: true },
      })
    : null;

  return (
    <div>
      <PageHeader
        title={invoice.number}
        sub={`${invoice.customer.name} · ${formatDate(invoice.issueDate)}`}
        action={
          <Link href={`/invoices/${invoice.id}/print`} className={btnSecondaryCls}>
            Print / PDF
          </Link>
        }
      />

      {!isQuote ? (
        <Link href={`/invoices/${invoice.id}/packing`} className={`${btnSecondaryCls} mb-4 w-full`}>
          📦 Packing list
        </Link>
      ) : null}

      {saved === "income-tax" ? <SavedBanner title="Sales tax taken out of income." /> : null}

      {fixing && fixingIncome ? (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <p className="text-base font-semibold text-amber-900">
            Take {formatCents(taxInIncome(fixing))} sales tax out of this income?
          </p>
          <p className="mt-1 text-sm tabular-nums text-amber-900">
            {formatCents(fixingIncome.amountCents)} →{" "}
            {formatCents(fixingIncome.amountCents - taxInIncome(fixing))}
          </p>
          <div className="mt-3 flex gap-2">
            <form action={removeTaxFromIncome} className="flex-1">
              <input type="hidden" name="paymentId" value={fixing.id} />
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Take it out
              </button>
            </form>
            <Link href={`/invoices/${invoice.id}#payments`} className={`${btnSecondaryCls} flex-1`}>
              Cancel
            </Link>
          </div>
        </Card>
      ) : null}

      {error && ERROR_MESSAGES[error] ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          {ERROR_MESSAGES[error]}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={invoiceStatusTone(status)}>{INVOICE_STATUS_LABELS[status]}</Chip>
        <Chip tone={divisionTone(invoice.division)}>
          {DIVISION_LABELS[invoice.division as Division] ?? invoice.division}
        </Chip>
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Details</h2>
        <Row
          label="Customer"
          value={
            <Link href={`/customers/${invoice.customerId}`} className="text-oak-700 underline">
              {invoice.customer.name}
              {invoice.customer.company ? ` — ${invoice.customer.company}` : ""}
            </Link>
          }
        />
        <Row label="Due date" value={invoice.dueDate ? formatDate(invoice.dueDate) : null} />
        <Row label="Taxed at" value={taxLocation?.name} />
        <Row label="Terms" value={invoice.terms} />
        <Row label="Notes" value={invoice.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Lines</h2>
        <div className="divide-y divide-stone-100">
          {invoice.lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-stone-900">{line.description}</div>
                <div className="text-sm text-stone-500">
                  {line.quantity} × {formatCents(line.unitPriceCents)}
                  {line.taxable ? "" : " · not taxed"}
                  {line.productType !== "UNCLASSIFIED"
                    ? ` · ${PRODUCT_TYPE_LABELS[line.productType as ProductType] ?? line.productType}`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 text-right font-semibold tabular-nums text-stone-900">
                {formatCents(line.totalCents)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1 border-t border-stone-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Subtotal</span>
            <span className="font-medium tabular-nums text-stone-900">
              {formatCents(invoice.subtotalCents)}
            </span>
          </div>
          {taxableCents !== invoice.subtotalCents ? (
            <div className="flex justify-between">
              <span className="text-stone-500">Taxable amount</span>
              <span className="font-medium tabular-nums text-stone-900">
                {formatCents(taxableCents)}
              </span>
            </div>
          ) : null}
          {invoice.salesTaxCents > 0 ? (
            <div className="flex justify-between">
              <span className="text-stone-500">
                Sales tax
                {invoice.taxManualOverride
                  ? " (manual)"
                  : invoice.taxRatePercent
                    ? ` @ ${formatRate(invoice.taxRatePercent)}`
                    : ""}
              </span>
              <span className="font-medium tabular-nums text-stone-900">
                {formatCents(invoice.salesTaxCents)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-stone-900">
            <span>Total</span>
            <span className="tabular-nums">{formatCents(invoice.totalCents)}</span>
          </div>
          {!isQuote ? (
            <>
              <div className="flex justify-between">
                <span className="text-stone-500">Paid</span>
                <span className="font-medium tabular-nums text-oak-700">{formatCents(paidCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Balance due</span>
                <span
                  className={`font-semibold tabular-nums ${
                    balanceCents > 0 ? "text-red-700" : "text-stone-900"
                  }`}
                >
                  {formatCents(balanceCents)}
                </span>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {salesTaxReview ? (
        <Link
          href={
            invoice.status === "DRAFT"
              ? `/invoices/${invoice.id}/edit`
              : `/tax/sales/review?month=${periodOf(invoice.issueDate)}&invoice=${invoice.id}#inv-${invoice.id}`
          }
          className="mb-4 block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          Sales tax: {!taxLocation ? "where it's taxed" : "kind of sale"} not set — review →
        </Link>
      ) : null}

      {isQuote && acceptedInvoice ? (
        <Card className="mb-4 border-oak-200 bg-oak-50">
          <p className="text-sm text-oak-900">
            ✅ Accepted — invoiced as{" "}
            <Link href={`/invoices/${acceptedInvoice.id}`} className="font-semibold underline">
              {acceptedInvoice.number}
            </Link>
          </p>
        </Card>
      ) : null}

      {isQuote && !acceptedInvoice && invoice.status !== "CANCELLED" ? (
        <form action={convertQuote} className="mb-4">
          <input type="hidden" name="id" value={invoice.id} />
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Customer said yes → convert to invoice
          </button>
        </form>
      ) : null}

      {!isQuote ? (
      <Card className="mb-4">
        <div id="payments" className="scroll-mt-20" />
        <h2 className="mb-2 font-semibold text-stone-900">
          Payments {invoice.payments.length > 0 ? `(${invoice.payments.length})` : ""}
        </h2>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-stone-500">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium tabular-nums text-stone-900">
                    {formatCents(p.amountCents)}
                  </div>
                  <div className="text-sm text-stone-500">
                    {formatDate(p.date)}
                    {p.method ? ` · ${p.method}` : ""}
                    {p.checkNumber ? ` · check #${p.checkNumber}` : ""}
                    {(taxShareOf.get(p.id) ?? 0) > 0
                      ? ` · incl. ${formatCents(taxShareOf.get(p.id) ?? 0)} sales tax`
                      : ""}
                  </div>
                  {taxInIncome(p) > 0 ? (
                    <Link
                      href={`/invoices/${invoice.id}?fix=${p.id}`}
                      className="mt-0.5 block text-sm font-medium text-amber-800"
                    >
                      Income includes {formatCents(taxInIncome(p))} tax ·{" "}
                      <span className="underline">Fix</span>
                    </Link>
                  ) : null}
                </div>
                <form action={deletePayment} className="shrink-0">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <button type="submit" className="text-xs text-red-500">
                    remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {invoice.status !== "CANCELLED" ? (
          <details className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Record payment
            </summary>
            <form action={recordPayment} className="mt-3 space-y-3">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="p-date">
                    Date *
                  </label>
                  <input
                    id="p-date"
                    name="date"
                    type="date"
                    required
                    defaultValue={toDateInputValue(new Date())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="p-amount">
                    Amount *
                  </label>
                  <input
                    id="p-amount"
                    name="amount"
                    inputMode="decimal"
                    required
                    placeholder="$0.00"
                    defaultValue={balanceCents > 0 ? (balanceCents / 100).toFixed(2) : ""}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="p-method">
                    Method
                  </label>
                  <select id="p-method" name="method" defaultValue="" className={inputCls}>
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="p-check">
                    Check #
                  </label>
                  <input id="p-check" name="checkNumber" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="p-notes">
                  Notes
                </label>
                <input id="p-notes" name="notes" className={inputCls} />
              </div>
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Record payment
              </button>
              <p className="text-xs text-stone-500">
                Posts to Income, less any sales tax.
              </p>
            </form>
          </details>
        ) : null}
      </Card>
      ) : null}

      {invoice.status === "DRAFT" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Link href={`/invoices/${invoice.id}/edit`} className={btnSecondaryCls}>
              Edit draft
            </Link>
            <form action={setInvoiceStatus}>
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="to" value="SENT" />
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Mark as sent
              </button>
            </form>
          </div>
          {invoice.payments.length === 0 ? (
            <form action={deleteInvoice} className="text-center">
              <input type="hidden" name="id" value={invoice.id} />
              <button
                type="submit"
                className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
              >
                Delete draft
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {invoice.status === "SENT" && invoice.payments.length === 0 ? (
        <div className="flex items-center justify-center gap-6">
          <form action={setInvoiceStatus}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="to" value="DRAFT" />
            <button
              type="submit"
              className="text-sm font-medium text-stone-600 underline-offset-2 active:underline"
            >
              Back to draft
            </button>
          </form>
          <form action={setInvoiceStatus}>
            <input type="hidden" name="id" value={invoice.id} />
            <input type="hidden" name="to" value="CANCELLED" />
            <button
              type="submit"
              className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
            >
              {isQuote ? "Cancel quote" : "Cancel invoice"}
            </button>
          </form>
        </div>
      ) : null}

      <DocumentsCard ownerType="INVOICE" ownerId={invoice.id} title="Attached paperwork" />
    </div>
  );
}
