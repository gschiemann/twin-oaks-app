import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { fileSrc } from "@/lib/storage";
import {
  PRODUCT_TYPE_LABELS,
  SALES_TAX_BASIS_LABELS,
  SALES_TAX_TREATMENT_LABELS,
  TAX_AUTHORITY_LEVEL_LABELS,
  type ProductType,
  type SalesTaxTreatment,
  type TaxAuthorityLevel,
} from "@/lib/domain";
import {
  dayLabel,
  isValidPeriod,
  periodLabel,
  periodOf,
  ppmToPercentLabel,
  shiftPeriod,
} from "@/lib/sales-tax/format";
import { computeMonth, fingerprint } from "@/lib/sales-tax/load";
import type { EngineResult, Issue } from "@/lib/sales-tax/types";
import {
  Card,
  Chip,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { closeMonth, deleteFiling, recordFiling } from "./actions";
import { exportHref, fixHref } from "./bits";

export const dynamic = "force-dynamic";

const SAVED: Record<string, { title: string; hint?: string }> = {
  closed: {
    title: "Month closed.",
    hint: "Saved exactly as filed — downloads below regenerate it.",
  },
  correction: { title: "Correction saved.", hint: "The earlier close is kept." },
  unchanged: { title: "Nothing changed since the last close." },
  filed: { title: "Filing recorded." },
};

const ERRORS: Record<string, string> = {
  reviewer: "Add who reviewed it.",
  blocked: "Something still blocks filing — see the list.",
  "no-close": "Close the month before recording a filing.",
  filing: "Add the filing date and who filed.",
};

const treatmentTone: Record<string, string> = {
  TAXABLE: "blue",
  EXEMPT: "green",
  WHOLESALE: "indigo",
  NEEDS_REVIEW: "red",
};

/** Big runs of the same problem collapse to one row. */
function grouped(issues: Issue[]): { issue: Issue; more: number }[] {
  const byCode = new Map<string, Issue[]>();
  for (const i of issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  const out: { issue: Issue; more: number }[] = [];
  for (const list of byCode.values()) {
    if (list.length > 3) out.push({ issue: list[0], more: list.length - 1 });
    else for (const issue of list) out.push({ issue, more: 0 });
  }
  return out;
}

function IssueList({
  issues,
  r,
  tone,
}: {
  issues: Issue[];
  r: EngineResult;
  tone: "red" | "amber";
}) {
  const text = tone === "red" ? "text-red-950" : "text-amber-950";
  const link = tone === "red" ? "text-red-800" : "text-amber-800";
  return (
    <ul className={`mt-1 divide-y ${tone === "red" ? "divide-red-200" : "divide-amber-200"}`}>
      {grouped(issues).map(({ issue, more }, i) => (
        <li
          key={`${issue.code}-${i}`}
          className="flex items-start justify-between gap-3 py-2 text-sm"
        >
          <span className={text}>
            {issue.message}
            {more > 0 ? <span className="font-medium"> (+{more} more like it)</span> : null}
          </span>
          <Link
            href={
              more > 0 && issue.fix.kind === "LINE"
                ? `/tax/sales/review?month=${r.period}`
                : fixHref(issue, r)
            }
            className={`shrink-0 font-semibold underline ${link}`}
          >
            {tone === "red" ? "Fix" : "Open"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Money({
  label,
  cents,
  strong = false,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-stone-900" : "text-stone-700"}`}>
        {formatCents(cents)}
      </dd>
    </div>
  );
}

export default async function SalesTaxMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; saved?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { month, saved, error } = await searchParams;
  // Default: last month — the one that's due now.
  const period = isValidPeriod(month) ? month : shiftPeriod(periodOf(new Date()), -1);
  const label = periodLabel(period);

  const [r, snapshots, filings, account] = await Promise.all([
    computeMonth(accountId, period),
    prisma.salesTaxSnapshot.findMany({
      where: { accountId, period },
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesTaxFiling.findMany({ where: { accountId, period }, orderBy: { filedOn: "desc" } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
  ]);
  const latest = snapshots[0] ?? null;
  const changed = latest
    ? fingerprint(JSON.parse(latest.snapshotJson) as EngineResult) !== fingerprint(r)
    : false;
  const notSetUp = r.blockers.some((b) => b.code === "SETUP_NONE");

  const evidenceIds = [...new Set(r.salesLines.map((l) => l.evidenceDocumentId).filter(Boolean))];
  const evidence = evidenceIds.length
    ? await prisma.document.findMany({
        where: { accountId, id: { in: evidenceIds } },
        select: { id: true, title: true, filePath: true },
      })
    : [];
  const evidenceById = new Map(evidence.map((d) => [d.id, d]));
  const lineById = new Map(r.salesLines.map((l) => [l.lineId, l]));
  const reviewer = account?.name ?? "";
  const snapshotLabel = new Map(
    snapshots.map((s) => [
      s.id,
      `${s.kind === "CORRECTION" ? "Correction" : "Close"} ${formatDate(s.createdAt)}`,
    ]),
  );

  return (
    <div>
      <PageHeader
        title="Sales tax"
        sub="Alabama state + local, month by month"
        action={
          <Link href="/tax/sales/setup" className={`${btnSecondaryCls} px-3 py-2 text-sm`}>
            Setup
          </Link>
        }
      />

      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/tax/sales?month=${shiftPeriod(period, -1)}`}
          aria-label="Previous month"
          className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-semibold text-stone-600"
        >
          ‹
        </Link>
        <span className="text-base font-semibold text-stone-900">{label}</span>
        <Link
          href={`/tax/sales?month=${shiftPeriod(period, 1)}`}
          aria-label="Next month"
          className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-semibold text-stone-600"
        >
          ›
        </Link>
      </div>

      {saved && SAVED[saved] ? (
        <SavedBanner title={SAVED[saved].title} hint={SAVED[saved].hint} />
      ) : null}
      {error && ERRORS[error] ? <FormError>{ERRORS[error]}</FormError> : null}

      {notSetUp ? (
        <Card className="mb-4 text-center">
          <p className="font-medium text-stone-800">Set up sales tax first.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Your reporting basis, tax authorities, rates, locations and product rules.
          </p>
          <Link href="/tax/sales/setup" className={`${btnPrimaryCls} mt-3`}>
            Set up
          </Link>
        </Card>
      ) : null}

      {latest ? (
        <Card
          className={`mb-4 ${changed ? "border-amber-300 bg-amber-50" : "border-oak-300 bg-oak-50"}`}
        >
          <p className="font-semibold text-stone-900">
            {latest.kind === "CORRECTION" ? "Corrected" : "Closed"} {formatDate(latest.createdAt)} ·{" "}
            {latest.reviewerName}
          </p>
          {changed ? (
            <p className="mt-0.5 text-sm text-amber-900">
              Records changed since — save a correction below.
            </p>
          ) : null}
          <p className="mt-0.5 text-sm text-stone-600">
            {filings[0]
              ? `Filed ${formatDate(filings[0].filedOn)}${filings[0].confirmationNumber ? ` · #${filings[0].confirmationNumber}` : ""}`
              : "Not filed yet."}
          </p>
        </Card>
      ) : r.readyToFile ? (
        <Card className="mb-4 border-oak-300 bg-oak-50">
          <p className="font-semibold text-oak-900">Ready to file</p>
          <p className="mt-0.5 text-sm text-stone-600">Close the month to lock these figures.</p>
        </Card>
      ) : null}

      {r.blockers.length > 0 && !notSetUp ? (
        <Card className="mb-4 border-2 border-red-300 bg-red-50">
          <h2 className="font-semibold text-red-900">{r.blockers.length} to fix before filing</h2>
          <IssueList issues={r.blockers} r={r} tone="red" />
        </Card>
      ) : null}

      {r.warnings.length > 0 ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-amber-900">
              {r.warnings.length} to check
            </summary>
            <IssueList issues={r.warnings} r={r} tone="amber" />
          </details>
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Sales" value={formatCents(r.totals.grossSalesCents)} sub="counted once" />
        <StatCard label="Tax due" value={formatCents(r.totals.expectedTaxCents)} />
        <StatCard
          label="Collected"
          value={formatCents(r.totals.collectedTaxCents + r.totals.unallocatedCollectedCents)}
          tone={
            r.totals.differenceCents === 0 && r.totals.unallocatedCollectedCents === 0
              ? "stone"
              : "red"
          }
        />
      </div>

      <Card className="mb-4">
        <h2 className="font-semibold text-stone-900">Return figures</h2>
        <p className="mb-1 text-xs text-stone-500">
          {r.basis ? SALES_TAX_BASIS_LABELS[r.basis] : "No reporting basis yet"} · tap a row for its
          sales
        </p>
        {r.summary.length === 0 ? (
          <p className="py-2 text-sm text-stone-500">No tax authorities set up.</p>
        ) : (
          r.summary.map((s) => {
            const comps = r.components.filter(
              (c) => c.authorityId === s.authorityId && c.rateType === s.rateType,
            );
            return (
              <details
                key={`${s.authorityId}|${s.rateType}`}
                className="border-b border-stone-100 py-2.5 last:border-b-0"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-stone-900">{s.authority}</span>
                    <span className="font-semibold tabular-nums text-stone-900">
                      {formatCents(s.expectedTaxCents)}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500">
                    {TAX_AUTHORITY_LEVEL_LABELS[s.level as TaxAuthorityLevel] ?? s.level} ·{" "}
                    {s.taxType}
                    {s.rateType ? ` · ${s.rateType}` : ""}
                    {s.jurisdictionCode ? ` · code ${s.jurisdictionCode}` : ""}
                    {s.ratePpms.length ? ` · ${s.ratePpms.map(ppmToPercentLabel).join(" / ")}` : ""}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                    <Money label="Gross" cents={s.grossCents} />
                    <Money label="Deductions" cents={s.deductionCents} />
                    <Money label="Taxable" cents={s.taxableCents} strong />
                    <Money label="Tax due" cents={s.expectedTaxCents} strong />
                    <Money label="Collected" cents={s.collectedTaxCents} />
                    <Money label="Difference" cents={s.differenceCents} />
                  </dl>
                </summary>
                {comps.length === 0 ? (
                  <p className="mt-2 text-xs text-stone-500">
                    No sales this month — files as zero.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 rounded-xl bg-stone-50 p-2 text-xs">
                    {comps.map((c) => {
                      const l = lineById.get(c.lineId);
                      return (
                        <li key={c.componentId} className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-stone-700">
                            {c.invoiceNumber ? (
                              <Link
                                href={`/invoices/${c.transactionId}`}
                                className="font-medium text-oak-700 underline"
                              >
                                {c.invoiceNumber}
                              </Link>
                            ) : (
                              "Livestock"
                            )}{" "}
                            {l?.description}
                            {c.deductionCents !== 0
                              ? ` · deduction ${formatCents(c.deductionCents)}`
                              : ""}
                          </span>
                          <span className="shrink-0 tabular-nums text-stone-900">
                            {formatCents(c.taxableCents)} → {formatCents(c.expectedTaxCents)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </details>
            );
          })
        )}
        <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-stone-900">
          <span>Total tax, all authorities</span>
          <span className="tabular-nums">{formatCents(r.totals.expectedTaxCents)}</span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Every authority taxes the same sales — never add gross across rows.
        </p>
      </Card>

      <Card className="mb-4">
        <details open={r.salesLines.length > 0 && r.salesLines.length <= 8}>
          <summary className="cursor-pointer font-semibold text-stone-900">
            Sales lines ({r.salesLines.length})
          </summary>
          {r.salesLines.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No sales in {label}.</p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100">
              {r.salesLines.map((l) => {
                const doc = l.evidenceDocumentId
                  ? evidenceById.get(l.evidenceDocumentId)
                  : undefined;
                return (
                  <li key={l.lineId} className="py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-medium text-stone-900">{l.description}</span>
                      <span className="shrink-0 text-right tabular-nums text-stone-900">
                        {formatCents(l.pretaxCents)}
                        {l.taxCollectedCents !== 0 ? (
                          <span className="block text-xs text-stone-500">
                            + {formatCents(l.taxCollectedCents)} tax
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      {l.invoiceNumber ? (
                        <Link
                          href={`/invoices/${l.transactionId}`}
                          className="font-medium text-oak-700 underline"
                        >
                          {l.invoiceNumber}
                        </Link>
                      ) : (
                        <Link
                          href="/livestock/sales"
                          className="font-medium text-oak-700 underline"
                        >
                          Livestock sale
                        </Link>
                      )}
                      <span>{dayLabel(l.saleDate)}</span>
                      {l.paymentDate ? (
                        <span>· paid {dayLabel(l.paymentDate)}</span>
                      ) : (
                        <span>· unpaid</span>
                      )}
                      <span>
                        · {PRODUCT_TYPE_LABELS[l.productType as ProductType] ?? l.productType}
                      </span>
                      {l.status === "RETURN" ? <Chip tone="amber">Return</Chip> : null}
                      {l.status === "DISCOUNT" ? <Chip tone="amber">Discount</Chip> : null}
                      {l.treatment === "NEEDS_REVIEW" ? (
                        <Link href={`/tax/sales/review?month=${period}#line-${l.lineId}`}>
                          <Chip tone="red">Needs a decision</Chip>
                        </Link>
                      ) : (
                        <Chip tone={treatmentTone[l.treatment]}>
                          {SALES_TAX_TREATMENT_LABELS[l.treatment as SalesTaxTreatment]}
                        </Chip>
                      )}
                      {doc ? (
                        <a href={fileSrc(doc.filePath)} className="text-oak-700 underline">
                          {doc.title}
                        </a>
                      ) : null}
                    </div>
                    {l.exemptionReason ? (
                      <p className="mt-0.5 text-xs text-stone-500">{l.exemptionReason}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      </Card>

      {r.excluded.length > 0 ? (
        <Card className="mb-4">
          <details>
            <summary className="cursor-pointer font-semibold text-stone-900">
              Left out ({r.excluded.length})
            </summary>
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {r.excluded.map((x) => (
                <li key={x.transactionId} className="flex justify-between gap-3 py-2">
                  <Link
                    href={`/invoices/${x.transactionId}`}
                    className="font-medium text-oak-700 underline"
                  >
                    {x.label}
                  </Link>
                  <span className="text-stone-500">{x.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Downloads</h2>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <a href={exportHref(period, "xlsx")} className={`${btnSecondaryCls} px-2 text-sm`}>
            Workbook
          </a>
          <a href={exportHref(period, "lines")} className={`${btnSecondaryCls} px-2 text-sm`}>
            Lines CSV
          </a>
          <a href={exportHref(period, "components")} className={`${btnSecondaryCls} px-2 text-sm`}>
            Tax CSV
          </a>
        </div>
        <p className="mt-1.5 text-xs text-stone-500">
          For your accountant and books — not upload files for My Alabama Taxes.
          {r.readyToFile ? "" : " Marked DRAFT until nothing blocks filing."}
        </p>
      </Card>

      {!latest || changed ? (
        <Card className="mb-4">
          <h2 className="font-semibold text-stone-900">
            {latest ? "Save a correction" : `Close ${label}`}
          </h2>
          {r.readyToFile ? (
            <form action={closeMonth} className="mt-2 space-y-3">
              <input type="hidden" name="period" value={period} />
              <div>
                <label className={labelCls} htmlFor="reviewerName">
                  Reviewed by *
                </label>
                <input
                  id="reviewerName"
                  name="reviewerName"
                  required
                  defaultValue={reviewer}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="note">
                  Note
                </label>
                <input id="note" name="note" className={inputCls} />
              </div>
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                {latest ? "Save correction" : `Close ${label}`}
              </button>
            </form>
          ) : (
            <p className="mt-1 text-sm text-stone-500">Once nothing blocks filing.</p>
          )}
        </Card>
      ) : null}

      {snapshots.length > 0 ? (
        <Card className="mb-4">
          <h2 className="mb-1 font-semibold text-stone-900">Saved</h2>
          <ul className="divide-y divide-stone-100">
            {snapshots.map((s) => (
              <li key={s.id} className="py-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-stone-900">
                    {snapshotLabel.get(s.id)} · {s.reviewerName}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatCents(s.taxCents)}
                  </span>
                </div>
                {s.note ? <p className="text-xs text-stone-500">{s.note}</p> : null}
                <div className="mt-1 flex gap-4 text-xs font-medium">
                  <a href={exportHref(period, "xlsx", s.id)} className="text-oak-700 underline">
                    Workbook
                  </a>
                  <a href={exportHref(period, "lines", s.id)} className="text-oak-700 underline">
                    Lines CSV
                  </a>
                  <a
                    href={exportHref(period, "components", s.id)}
                    className="text-oak-700 underline"
                  >
                    Tax CSV
                  </a>
                </div>
              </li>
            ))}
          </ul>

          {filings.length > 0 ? (
            <>
              <h3 className="mt-3 text-sm font-semibold text-stone-900">Filed</h3>
              <ul className="divide-y divide-stone-100">
                {filings.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="text-stone-700">
                      {formatDate(f.filedOn)} · {f.filedBy}
                      {f.confirmationNumber ? ` · #${f.confirmationNumber}` : ""}
                      {f.amountPaidCents != null ? ` · ${formatCents(f.amountPaidCents)}` : ""}
                      {f.snapshotId && snapshotLabel.get(f.snapshotId) ? (
                        <span className="block text-xs text-stone-500">
                          from {snapshotLabel.get(f.snapshotId)}
                        </span>
                      ) : null}
                      {f.notes ? (
                        <span className="block text-xs text-stone-500">{f.notes}</span>
                      ) : null}
                    </span>
                    <form action={deleteFiling}>
                      <input type="hidden" name="period" value={period} />
                      <input type="hidden" name="id" value={f.id} />
                      <button type="submit" className="text-xs text-red-500">
                        remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <details className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Record filing
            </summary>
            <form action={recordFiling} className="mt-3 space-y-3">
              <input type="hidden" name="period" value={period} />
              <div>
                <label className={labelCls} htmlFor="snapshotId">
                  Filed from
                </label>
                <select
                  id="snapshotId"
                  name="snapshotId"
                  defaultValue={latest?.id}
                  className={inputCls}
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {snapshotLabel.get(s.id)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="filedOn">
                    Filed on *
                  </label>
                  <input
                    id="filedOn"
                    name="filedOn"
                    type="date"
                    required
                    defaultValue={toDateInputValue(new Date())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="amountPaid">
                    Paid
                  </label>
                  <input
                    id="amountPaid"
                    name="amountPaid"
                    inputMode="decimal"
                    placeholder="$0.00"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="confirmationNumber">
                    Confirmation #
                  </label>
                  <input id="confirmationNumber" name="confirmationNumber" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="filedBy">
                    Filed by *
                  </label>
                  <input
                    id="filedBy"
                    name="filedBy"
                    required
                    defaultValue={reviewer}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="filingNotes">
                  Notes
                </label>
                <input id="filingNotes" name="notes" className={inputCls} />
              </div>
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Save filing
              </button>
            </form>
          </details>
        </Card>
      ) : null}
    </div>
  );
}
