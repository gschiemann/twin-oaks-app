import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  SALES_TAX_TREATMENT_LABELS,
  TAX_TREATMENTS_SALES,
  type ProductType,
  type SalesTaxTreatment,
} from "@/lib/domain";
import { isValidPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/sales-tax/format";
import { computeMonth } from "@/lib/sales-tax/load";
import type { Issue } from "@/lib/sales-tax/types";
import {
  Card,
  Chip,
  PageHeader,
  SavedBanner,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  classifyInvoiceLines,
  classifyLine,
  classifyLivestockSale,
  setInvoiceLocation,
} from "./actions";

export const dynamic = "force-dynamic";

const SAVED: Record<string, string> = {
  line: "Line saved.",
  lines: "Lines classified.",
  location: "Location saved.",
  sale: "Sale saved.",
  missing: "That record is gone.",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Problems({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-red-800">
      {issues.map((i, k) => (
        <li key={k}>• {i.message}</li>
      ))}
    </ul>
  );
}

export default async function SalesTaxReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; saved?: string; all?: string; invoice?: string }>;
}) {
  const accountId = await requireAccountId();
  const { month, saved, all, invoice: onlyInvoice } = await searchParams;
  const period = isValidPeriod(month) ? month : shiftPeriod(periodOf(new Date()), -1);
  const showAll = all === "1";

  const [r, locations, rules] = await Promise.all([
    computeMonth(accountId, period),
    prisma.taxLocation.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.salesTaxRule.findMany({ where: { accountId } }),
  ]);
  const ruleByType = new Map(rules.map((x) => [x.productType, x]));

  // Everything that needs a person, keyed by record.
  const issuesFor = (kind: string, id: string) =>
    [...r.blockers, ...r.warnings].filter(
      (i) => i.fix.kind === kind && "id" in i.fix && i.fix.id === id,
    );
  const lineIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const saleIds = new Set<string>();
  for (const i of r.blockers) {
    if (i.fix.kind === "LINE") lineIds.add(i.fix.id);
    if (i.fix.kind === "INVOICE" && (i.code === "NO_LOCATION" || i.code === "LOCATION_GONE"))
      invoiceIds.add(i.fix.id);
    if (i.fix.kind === "LIVESTOCK") saleIds.add(i.fix.id);
  }
  for (const l of r.salesLines) {
    const isSale = l.sourceDocumentId === l.lineId;
    if (showAll) {
      if (isSale) saleIds.add(l.lineId);
      else {
        lineIds.add(l.lineId);
        invoiceIds.add(l.transactionId);
      }
    } else if (l.reviewStatus === "NEEDS_REVIEW") {
      if (isSale) saleIds.add(l.lineId);
      else lineIds.add(l.lineId);
    }
  }

  // Deep link from an invoice: show it whatever month it reports in.
  if (onlyInvoice) {
    const own = await prisma.invoiceLine.findMany({
      where: { invoiceId: onlyInvoice, invoice: { accountId } },
      select: { id: true },
    });
    for (const l of own) lineIds.add(l.id);
    invoiceIds.add(onlyInvoice);
  }

  const lines = await prisma.invoiceLine.findMany({
    where: { id: { in: [...lineIds] }, invoice: { accountId } },
    include: {
      invoice: {
        select: {
          id: true,
          number: true,
          issueDate: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: [{ invoice: { issueDate: "asc" } }, { sortOrder: "asc" }],
  });
  for (const l of lines) invoiceIds.add(l.invoice.id);

  const [invoices, sales, docs, refundCandidates] = await Promise.all([
    prisma.invoice.findMany({
      where: { accountId, id: { in: [...invoiceIds] } },
      select: {
        id: true,
        number: true,
        issueDate: true,
        taxLocationId: true,
        shipToAddress: true,
        customerId: true,
        customer: { select: { name: true, address: true } },
        lines: { select: { productType: true } },
      },
      orderBy: { issueDate: "asc" },
    }),
    prisma.livestockSale.findMany({
      where: { accountId, id: { in: [...saleIds] } },
      orderBy: { date: "asc" },
    }),
    prisma.document.findMany({
      where: {
        accountId,
        OR: [
          { ownerType: "INVOICE", ownerId: { in: [...invoiceIds] } },
          { ownerType: "CUSTOMER", ownerId: { in: lines.map((l) => l.invoice.customerId) } },
        ],
      },
      select: { id: true, title: true, ownerType: true, ownerId: true },
      orderBy: { createdAt: "asc" },
    }),
    // What a refund can point at: the same customer's earlier sale lines.
    prisma.invoiceLine.findMany({
      where: {
        productType: { notIn: ["REFUND", "DISCOUNT"] },
        totalCents: { gt: 0 },
        invoice: {
          accountId,
          kind: "INVOICE",
          status: "SENT",
          customerId: {
            in: lines
              .filter((l) => l.totalCents < 0 || l.productType === "REFUND")
              .map((l) => l.invoice.customerId),
          },
        },
      },
      select: {
        id: true,
        description: true,
        totalCents: true,
        invoice: { select: { number: true, customerId: true, issueDate: true } },
      },
      orderBy: { invoice: { issueDate: "desc" } },
      take: 200,
    }),
  ]);

  const hidden = (
    <>
      <input type="hidden" name="period" value={period} />
      {showAll ? <input type="hidden" name="all" value="1" /> : null}
      {onlyInvoice ? <input type="hidden" name="invoice" value={onlyInvoice} /> : null}
    </>
  );
  const nothing = lines.length === 0 && invoices.length === 0 && sales.length === 0;

  return (
    <div>
      <div id="top" />
      <PageHeader
        title="Tax review"
        sub={periodLabel(period)}
        action={
          <Link
            href={`/tax/sales?month=${period}`}
            className={`${btnSecondaryCls} px-3 py-2 text-sm`}
          >
            Month
          </Link>
        }
      />

      {saved && SAVED[saved] ? <SavedBanner title={SAVED[saved]} /> : null}

      <div className="mb-4 flex gap-2 text-sm">
        <Link
          href={`/tax/sales/review?month=${period}`}
          className={`rounded-full px-4 py-1.5 font-semibold ${!showAll ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"}`}
        >
          Needs a decision
        </Link>
        <Link
          href={`/tax/sales/review?month=${period}&all=1`}
          className={`rounded-full px-4 py-1.5 font-semibold ${showAll ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"}`}
        >
          All sales
        </Link>
      </div>

      {nothing ? (
        <Card className="py-8 text-center">
          <p className="font-medium text-stone-700">Nothing to review for {periodLabel(period)}.</p>
          <Link href={`/tax/sales?month=${period}`} className={`${btnPrimaryCls} mt-4`}>
            Back to the month
          </Link>
        </Card>
      ) : null}

      {invoices.map((inv) => {
        const invLines = lines.filter((l) => l.invoice.id === inv.id);
        const unclassified = inv.lines.filter((l) => l.productType === "UNCLASSIFIED").length;
        const locIssues = issuesFor("INVOICE", inv.id).filter(
          (i) => i.code === "NO_LOCATION" || i.code === "LOCATION_GONE",
        );
        return (
          <Card key={inv.id} className="mb-4">
            <div id={`inv-${inv.id}`} className="scroll-mt-20" />
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/invoices/${inv.id}`} className="font-semibold text-oak-700 underline">
                {inv.number}
              </Link>
              <span className="text-sm text-stone-500">
                {inv.customer.name} · {formatDate(inv.issueDate)}
              </span>
            </div>

            <form action={setInvoiceLocation} className="mt-2 flex items-end gap-2">
              {hidden}
              <input type="hidden" name="invoiceId" value={inv.id} />
              <div className="min-w-0 flex-1">
                <Field label="Taxed at">
                  <select
                    name="taxLocationId"
                    defaultValue={inv.taxLocationId ?? ""}
                    className={inputCls}
                  >
                    <option value="">Not set</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button type="submit" className={`${btnSecondaryCls} px-3`}>
                Save
              </button>
            </form>
            {inv.shipToAddress || inv.customer.address ? (
              <p className="mt-1 text-xs text-stone-500">
                {inv.shipToAddress
                  ? `Ships to ${inv.shipToAddress}`
                  : `Customer: ${inv.customer.address}`}
              </p>
            ) : null}
            {locations.length === 0 ? (
              <p className="mt-1 text-xs text-stone-500">
                <Link href="/tax/sales/setup#locations" className="text-oak-700 underline">
                  Add a location
                </Link>{" "}
                first.
              </p>
            ) : null}
            <Problems issues={locIssues} />

            {unclassified > 1 ? (
              <form
                action={classifyInvoiceLines}
                className="mt-3 flex items-end gap-2 rounded-xl bg-stone-50 p-2"
              >
                {hidden}
                <input type="hidden" name="invoiceId" value={inv.id} />
                <div className="min-w-0 flex-1">
                  <Field label={`All ${unclassified} unclassified lines are`}>
                    <select name="productType" required defaultValue="" className={inputCls}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {PRODUCT_TYPES.filter((t) => t !== "UNCLASSIFIED").map((t) => (
                        <option key={t} value={t}>
                          {PRODUCT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button type="submit" className={`${btnSecondaryCls} px-3`}>
                  Apply
                </button>
              </form>
            ) : null}

            {invLines.map((line) => {
              const rule = ruleByType.get(line.productType);
              const lineDocs = docs.filter(
                (d) =>
                  (d.ownerType === "INVOICE" && d.ownerId === inv.id) ||
                  (d.ownerType === "CUSTOMER" && d.ownerId === inv.customerId),
              );
              const mayRefund = line.totalCents < 0 || line.productType === "REFUND";
              const originals = refundCandidates.filter(
                (c) => c.invoice.customerId === inv.customerId && c.id !== line.id,
              );
              return (
                <div key={line.id} className="mt-3 border-t border-stone-100 pt-3">
                  <div id={`line-${line.id}`} className="scroll-mt-20" />
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium text-stone-900">{line.description}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                      {formatCents(line.totalCents)}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500">
                    {PRODUCT_TYPE_LABELS[line.productType as ProductType] ?? line.productType}
                    {line.taxTreatmentOverride
                      ? ` · decided: ${SALES_TAX_TREATMENT_LABELS[line.taxTreatmentOverride as SalesTaxTreatment]}`
                      : rule
                        ? ` · rule: ${SALES_TAX_TREATMENT_LABELS[rule.treatment as SalesTaxTreatment]}`
                        : line.productType === "UNCLASSIFIED"
                          ? ""
                          : " · no rule yet"}
                    {line.taxable ? " · tax was charged" : " · no tax charged"}
                  </p>
                  <Problems issues={issuesFor("LINE", line.id)} />
                  <form action={classifyLine} className="mt-2 space-y-2">
                    {hidden}
                    <input type="hidden" name="lineId" value={line.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Kind">
                        <select
                          name="productType"
                          defaultValue={line.productType}
                          className={inputCls}
                        >
                          {PRODUCT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {PRODUCT_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Treatment">
                        <select
                          name="taxTreatmentOverride"
                          defaultValue={line.taxTreatmentOverride ?? ""}
                          className={inputCls}
                        >
                          <option value="">Follow the rule</option>
                          {TAX_TREATMENTS_SALES.map((t) => (
                            <option key={t} value={t}>
                              {SALES_TAX_TREATMENT_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Reason (if exempt / wholesale)">
                      <input
                        name="exemptionReason"
                        defaultValue={line.exemptionReason ?? ""}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Supporting document">
                      <select
                        name="evidenceDocumentId"
                        defaultValue={line.evidenceDocumentId ?? ""}
                        className={inputCls}
                      >
                        <option value="">None</option>
                        {lineDocs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                            {d.ownerType === "CUSTOMER" ? " (customer)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {lineDocs.length === 0 ? (
                      <p className="text-xs text-stone-500">
                        Attach certificates on the{" "}
                        <Link href={`/invoices/${inv.id}`} className="text-oak-700 underline">
                          invoice
                        </Link>{" "}
                        or{" "}
                        <Link
                          href={`/customers/${inv.customerId}`}
                          className="text-oak-700 underline"
                        >
                          customer
                        </Link>
                        .
                      </p>
                    ) : null}
                    {mayRefund ? (
                      <Field label="Returns which sale (refunds)">
                        <select
                          name="originalLineId"
                          defaultValue={line.originalLineId ?? ""}
                          className={inputCls}
                        >
                          <option value="">Not set</option>
                          {originals.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.invoice.number} · {o.description} · {formatCents(o.totalCents)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    <button type="submit" className={`${btnPrimaryCls} w-full`}>
                      Save line
                    </button>
                  </form>
                </div>
              );
            })}
          </Card>
        );
      })}

      {sales.map((s) => (
        <Card key={s.id} className="mb-4">
          <div id={`ls-${s.id}`} className="scroll-mt-20" />
          <div className="flex items-baseline justify-between gap-3">
            <Link href="/livestock/sales" className="font-semibold text-oak-700 underline">
              Livestock sale
            </Link>
            <span className="text-sm text-stone-500">
              {formatDate(s.date)} · {formatCents(s.salePriceCents)}
            </span>
          </div>
          <p className="text-xs text-stone-500">
            {ruleByType.get("LIVE_LIVESTOCK")
              ? `Rule: ${SALES_TAX_TREATMENT_LABELS[ruleByType.get("LIVE_LIVESTOCK")!.treatment as SalesTaxTreatment]}`
              : "No livestock rule yet"}
          </p>
          <Problems issues={issuesFor("LIVESTOCK", s.id)} />
          <form action={classifyLivestockSale} className="mt-2 space-y-2">
            {hidden}
            <input type="hidden" name="saleId" value={s.id} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Taxed at">
                <select
                  name="taxLocationId"
                  defaultValue={s.taxLocationId ?? ""}
                  className={inputCls}
                >
                  <option value="">Not set</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Treatment">
                <select
                  name="taxTreatmentOverride"
                  defaultValue={s.taxTreatmentOverride ?? ""}
                  className={inputCls}
                >
                  <option value="">Follow the rule</option>
                  {TAX_TREATMENTS_SALES.map((t) => (
                    <option key={t} value={t}>
                      {SALES_TAX_TREATMENT_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Reason (if exempt)">
              <input
                name="exemptionReason"
                defaultValue={s.exemptionReason ?? ""}
                className={inputCls}
              />
            </Field>
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Save sale
            </button>
          </form>
        </Card>
      ))}

      {!nothing ? (
        <p className="text-center text-xs text-stone-400">
          <Link href={`/tax/sales?month=${period}`} className="underline">
            Back to {periodLabel(period)}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
