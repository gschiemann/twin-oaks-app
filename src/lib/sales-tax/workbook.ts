// The accountant's monthly workbook (.xlsx). A WORKPAPER — not a return and
// not a My Alabama Taxes upload file — and it says so on its face.
//
//   Summary         one row per taxing authority + rate type. The money
//                   columns are formulas over "Tax components" (with the
//                   engine's exact figures cached), so anyone can see — and
//                   Excel re-proves — where each number comes from. Gross
//                   repeats per authority and is never totalled across
//                   authorities; tax is.
//   Sales lines     every reported line, counted once.
//   Tax components  one row per line per authority; "Filing row" ties each
//                   one to its Summary row.
//   Review          what blocks filing, what's worth a look, what was left out.
//   Read me         how to read it.

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
  buildXlsx,
  colName,
  day,
  formulaString,
  fx,
  money,
  num,
  sheetRef,
  txt,
  type Cell,
  type CellStyle,
  type SheetSpec,
} from "@/lib/xlsx";
import { dayLabel, periodLabel, ppmToPercentLabel } from "./format";
import type { EngineResult, Issue, IssueFix, SalesLine, SummaryRow, TaxComponent } from "./types";

export const SHEET = {
  summary: "Summary",
  lines: "Sales lines",
  components: "Tax components",
  review: "Review",
  readme: "Read me",
} as const;

export type WorkbookMeta = {
  businessName: string;
  /** App origin (https://…) for invoice links; omit for plain invoice numbers. */
  appUrl?: string | null;
  /** Set when the workbook is regenerated from a saved close or correction. */
  snapshot?: { id: string; kind: string; reviewerName: string; createdAt: string } | null;
};

const STATUS_LABEL: Record<SalesLine["status"], string> = {
  POSTED: "Sale",
  DISCOUNT: "Discount",
  RETURN: "Return",
};

const REVIEW_LABEL: Record<SalesLine["reviewStatus"], string> = {
  OK: "OK",
  NEEDS_REVIEW: "Needs review",
};

/** A text cell, or a truly blank cell for "". */
function t(v: string | null | undefined, s?: CellStyle): Cell {
  return v ? txt(v, s) : null;
}

function typeLabel(v: string): string {
  return PRODUCT_TYPE_LABELS[v as ProductType] ?? v;
}

function treatmentLabel(v: string): string {
  return SALES_TAX_TREATMENT_LABELS[v as SalesTaxTreatment] ?? v;
}

function levelLabel(v: string): string {
  return TAX_AUTHORITY_LEVEL_LABELS[v as TaxAuthorityLevel] ?? v;
}

/** "2026-09-26T15:00:00.000Z" -> "2026-09-26 15:00 UTC" (no locale, no clock). */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

type Col<T> = { header: string; width: number; cell: (row: T) => Cell };

function letter<T>(cols: Col<T>[], header: string): string {
  const i = cols.findIndex((c) => c.header === header);
  if (i < 0) throw new Error(`No column "${header}"`);
  return colName(i + 1);
}

function table<T>(cols: Col<T>[], rows: T[]): Cell[][] {
  return [cols.map((c) => txt(c.header, "header")), ...rows.map((r) => cols.map((c) => c.cell(r)))];
}

export function salesTaxWorkbook(r: EngineResult, meta: WorkbookMeta): Uint8Array {
  const appUrl = meta.appUrl ? meta.appUrl.replace(/\/+$/, "") : "";
  const invoiceCell = (number: string, transactionId: string): Cell => {
    if (!number) return null;
    if (!appUrl) return txt(number);
    const url = `${appUrl}/invoices/${encodeURIComponent(transactionId)}`;
    return fx(`HYPERLINK(${formulaString(url)},${formulaString(number)})`, number);
  };

  // Which Summary row each component rolls into (the engine's own grouping).
  const rowKey = (authorityId: string, rateType: string) => `${authorityId}|${rateType}`;
  const filingRow = new Map<string, number>();
  r.summary.forEach((s, i) => filingRow.set(rowKey(s.authorityId, s.rateType), i + 1));

  // ————————————————————— Sales lines —————————————————————
  const lineCols: Col<SalesLine>[] = [
    { header: "Line ID", width: 26, cell: (l) => t(l.lineId, "code") },
    { header: "Invoice", width: 12, cell: (l) => invoiceCell(l.invoiceNumber, l.transactionId) },
    { header: "Sale date", width: 11, cell: (l) => day(l.saleDate) },
    { header: "Paid", width: 11, cell: (l) => day(l.paymentDate) },
    { header: "Division", width: 9, cell: (l) => t(l.division) },
    { header: "Customer", width: 24, cell: (l) => t(l.customerName) },
    { header: "Description", width: 36, cell: (l) => t(l.description) },
    { header: "Product type", width: 26, cell: (l) => t(typeLabel(l.productType)) },
    { header: "Taxed at", width: 22, cell: (l) => t(l.locationName) },
    { header: "City", width: 14, cell: (l) => t(l.deliveryCity) },
    { header: "County", width: 14, cell: (l) => t(l.deliveryCounty) },
    { header: "State", width: 6, cell: (l) => t(l.deliveryState) },
    { header: "Pretax", width: 12, cell: (l) => money(l.pretaxCents) },
    { header: "Tax collected", width: 12, cell: (l) => money(l.taxCollectedCents) },
    { header: "Total", width: 12, cell: (l) => money(l.totalCents) },
    { header: "Status", width: 10, cell: (l) => t(STATUS_LABEL[l.status]) },
    { header: "Treatment", width: 17, cell: (l) => t(treatmentLabel(l.treatment)) },
    { header: "Exemption reason", width: 34, cell: (l) => t(l.exemptionReason) },
    { header: "Evidence document", width: 26, cell: (l) => t(l.evidenceDocumentId, "code") },
    { header: "Approved by", width: 16, cell: (l) => t(l.approvedBy) },
    { header: "Review", width: 13, cell: (l) => t(REVIEW_LABEL[l.reviewStatus]) },
    { header: "Original line", width: 26, cell: (l) => t(l.originalLineId, "code") },
  ];
  const lineLast = Math.max(2, r.salesLines.length + 1);
  const L = (header: string) =>
    `${sheetRef(SHEET.lines)}!$${letter(lineCols, header)}$2:$${letter(lineCols, header)}$${lineLast}`;

  // ————————————————————— Tax components —————————————————————
  const compCols: Col<TaxComponent>[] = [
    {
      header: "Filing row",
      width: 8,
      cell: (c) => num(filingRow.get(rowKey(c.authorityId, c.rateType)) ?? 0, "int"),
    },
    { header: "Component ID", width: 34, cell: (c) => t(c.componentId, "code") },
    { header: "Line ID", width: 26, cell: (c) => t(c.lineId, "code") },
    { header: "Invoice", width: 12, cell: (c) => invoiceCell(c.invoiceNumber, c.transactionId) },
    { header: "Authority", width: 24, cell: (c) => t(c.authority) },
    { header: "Level", width: 12, cell: (c) => t(levelLabel(c.level)) },
    { header: "Jurisdiction code", width: 11, cell: (c) => t(c.jurisdictionCode, "code") },
    { header: "Tax type", width: 8, cell: (c) => t(c.taxType, "code") },
    { header: "Rate type", width: 11, cell: (c) => t(c.rateType, "code") },
    { header: "Gross", width: 12, cell: (c) => money(c.grossCents) },
    { header: "Deduction", width: 12, cell: (c) => money(c.deductionCents) },
    { header: "Taxable", width: 12, cell: (c) => money(c.taxableCents) },
    {
      header: "Rate",
      width: 9,
      cell: (c) => (c.ratePpm === null ? null : num(c.ratePpm / 1_000_000, "rate")),
    },
    { header: "Tax due", width: 11, cell: (c) => money(c.expectedTaxCents) },
    { header: "Tax collected", width: 12, cell: (c) => money(c.collectedTaxCents) },
    { header: "Difference", width: 11, cell: (c) => money(c.differenceCents) },
    { header: "Treatment", width: 17, cell: (c) => t(treatmentLabel(c.taxTreatment)) },
    { header: "Exemption reason", width: 34, cell: (c) => t(c.exemptionReason) },
    { header: "Evidence document", width: 26, cell: (c) => t(c.evidenceDocumentId, "code") },
    { header: "Review", width: 13, cell: (c) => t(REVIEW_LABEL[c.reviewStatus]) },
    { header: "Rate effective", width: 12, cell: (c) => day(c.rateEffectiveDate) },
    { header: "Rate source", width: 34, cell: (c) => t(c.rateSource) },
  ];
  const compLast = Math.max(2, r.components.length + 1);
  const C = (header: string) =>
    `${sheetRef(SHEET.components)}!$${letter(compCols, header)}$2:$${letter(compCols, header)}$${compLast}`;

  // ————————————————————— Summary —————————————————————
  const status = statusLine(r);
  const basisText = r.basis
    ? `Reporting basis: ${SALES_TAX_BASIS_LABELS[r.basis]}${r.basisApprovedBy ? ` — approved by ${r.basisApprovedBy}` : ""}`
    : "Reporting basis: not chosen yet";
  const snap = meta.snapshot;
  const provenance = snap
    ? `Generated ${stamp(r.generatedAt)} · ${snap.kind === "CORRECTION" ? "Correction" : "Month closed"} by ${snap.reviewerName} (snapshot ${snap.id})`
    : `Generated ${stamp(r.generatedAt)} · live preview, not a saved close`;

  const HEADER_ROW = 8;
  const first = HEADER_ROW + 1;
  const summaryHeaders = [
    "Filing row",
    "Authority",
    "Level",
    "Jurisdiction code",
    "Tax type",
    "Rate type",
    "Rate",
    "Gross sales",
    "Deductions",
    "Taxable",
    "Tax due",
    "Tax collected",
    "Difference",
    "Sale lines",
  ];
  const S = (header: string) => colName(summaryHeaders.indexOf(header) + 1);
  const rows: Cell[][] = [
    [txt(`Sales tax workpaper — ${periodLabel(r.period)}`, "title")],
    [t(meta.businessName, "subtitle")],
    [txt(status.text, status.ok ? "good" : "bad")],
    [txt(basisText)],
    [txt(provenance, "note")],
    [
      txt(
        "A workpaper, not a return or an upload file. Enter these figures on the returns in My Alabama Taxes.",
        "note",
      ),
    ],
    [],
    summaryHeaders.map((h) => txt(h, "header")),
  ];
  r.summary.forEach((s: SummaryRow, i) => {
    const R = first + i;
    const key = `$${S("Filing row")}${R}`;
    rows.push([
      num(i + 1, "int"),
      t(s.authority),
      t(levelLabel(s.level)),
      t(s.jurisdictionCode, "code"),
      t(s.taxType, "code"),
      t(s.rateType, "code"),
      s.ratePpms.length === 1
        ? num(s.ratePpms[0] / 1_000_000, "rate")
        : s.ratePpms.length > 1
          ? txt(s.ratePpms.map(ppmToPercentLabel).join(" / "))
          : null,
      fx(`SUMIFS(${C("Gross")},${C("Filing row")},${key})`, s.grossCents / 100, "money"),
      fx(`SUMIFS(${C("Deduction")},${C("Filing row")},${key})`, s.deductionCents / 100, "money"),
      fx(`${S("Gross sales")}${R}-${S("Deductions")}${R}`, s.taxableCents / 100, "money"),
      fx(`SUMIFS(${C("Tax due")},${C("Filing row")},${key})`, s.expectedTaxCents / 100, "money"),
      fx(
        `SUMIFS(${C("Tax collected")},${C("Filing row")},${key})`,
        s.collectedTaxCents / 100,
        "money",
      ),
      fx(`${S("Tax collected")}${R}-${S("Tax due")}${R}`, s.differenceCents / 100, "money"),
      fx(`COUNTIFS(${C("Filing row")},${key})`, s.componentCount, "int"),
    ]);
  });
  if (r.summary.length === 0) {
    rows.push([null, txt("No filing rows — set up sales tax first.", "note")]);
  }
  const totalRow = rows.length + 1;
  const lastData = totalRow - 1;
  const sumCol = (col: string, cents: number): Cell =>
    r.summary.length
      ? fx(`SUM(${col}${first}:${col}${lastData})`, cents / 100, "moneyTotal")
      : money(cents, "moneyTotal");
  const totalCells: Cell[] = summaryHeaders.map(() => null);
  totalCells[1] = txt("Total tax, all authorities", "total");
  totalCells[summaryHeaders.indexOf("Tax due")] = sumCol(S("Tax due"), r.totals.expectedTaxCents);
  totalCells[summaryHeaders.indexOf("Tax collected")] = sumCol(
    S("Tax collected"),
    r.totals.collectedTaxCents,
  );
  totalCells[summaryHeaders.indexOf("Difference")] = r.summary.length
    ? fx(
        `${S("Tax collected")}${totalRow}-${S("Tax due")}${totalRow}`,
        r.totals.differenceCents / 100,
        "moneyTotal",
      )
    : money(r.totals.differenceCents, "moneyTotal");
  rows.push(totalCells);
  rows.push([
    null,
    txt(
      "Gross, deductions and taxable repeat for each authority — never add them across rows. Tax adds across authorities.",
      "note",
    ),
  ]);
  rows.push([]);

  // Checks: the sales total once, tax summed across authorities, and the
  // tie-out to what customers were charged.
  const amountCol = S("Gross sales");
  const check = (label: string, value: Cell) => {
    const row: Cell[] = summaryHeaders.map(() => null);
    row[1] = txt(label);
    row[summaryHeaders.indexOf("Gross sales")] = value;
    rows.push(row);
    return rows.length; // its 1-based row number
  };
  rows.push([null, txt("Checks", "bold")]);
  check(
    "Pretax sales (counted once)",
    fx(`SUMIFS(${L("Pretax")},${L("Status")},"<>Return")`, r.totals.grossSalesCents / 100, "money"),
  );
  check(
    "Returns and refunds",
    fx(`-SUMIFS(${L("Pretax")},${L("Status")},"Return")`, r.totals.returnsCents / 100, "money"),
  );
  const dueRow = check(
    "Tax due, all authorities",
    fx(`${S("Tax due")}${totalRow}`, r.totals.expectedTaxCents / 100, "money"),
  );
  const collectedRow = check(
    "Tax collected, all authorities",
    fx(`${S("Tax collected")}${totalRow}`, r.totals.collectedTaxCents / 100, "money"),
  );
  check(
    "Difference (collected − due)",
    fx(
      `${amountCol}${collectedRow}-${amountCol}${dueRow}`,
      r.totals.differenceCents / 100,
      "money",
    ),
  );
  let unallocatedRef = "";
  if (r.totals.unallocatedCollectedCents !== 0) {
    const u = check(
      "Tax collected with no location (in no row)",
      money(r.totals.unallocatedCollectedCents),
    );
    unallocatedRef = `+${amountCol}${u}`;
  }
  check(
    "Customer total (sales + tax)",
    fx(`SUM(${L("Total")})${unallocatedRef}`, r.totals.customerTotalCents / 100, "money"),
  );
  check("Sale lines", num(r.totals.lineCount, "int"));
  check("Invoices and sales", num(r.totals.transactionCount, "int"));

  const summarySheet: SheetSpec = {
    name: SHEET.summary,
    rows,
    widths: [8, 28, 12, 11, 8, 11, 9, 13, 13, 13, 12, 13, 12, 9],
  };

  // ————————————————————— Review —————————————————————
  const numberOf = new Map<string, string>();
  for (const l of r.salesLines) if (l.invoiceNumber) numberOf.set(l.transactionId, l.invoiceNumber);
  for (const x of r.excluded) numberOf.set(x.transactionId, x.label);
  const authorityName = new Map<string, string>();
  for (const s of r.summary) authorityName.set(s.authorityId, s.authority);
  for (const c of r.components) authorityName.set(c.authorityId, c.authority);
  const where = (fix: IssueFix): string => {
    switch (fix.kind) {
      case "SETUP":
        return "Sales tax setup";
      case "INVOICE":
        return fix.number ?? numberOf.get(fix.id) ?? "Invoice";
      case "LINE":
        return `Line on ${fix.invoiceNumber ?? numberOf.get(fix.invoiceId) ?? "invoice"}`;
      case "LIVESTOCK":
        return "Livestock sale";
      case "LOCATION":
        return "Tax locations";
      case "RATE":
        return `Rates — ${authorityName.get(fix.authorityId) ?? "authority"}`;
      case "RULE":
        return `Product rules — ${typeLabel(fix.productType)}`;
      case "INCOME":
        return "Income entry";
    }
  };
  const reviewRows: Cell[][] = [
    [txt(`Review — ${periodLabel(r.period)}`, "title")],
    [txt(status.text, status.ok ? "good" : "bad")],
    [],
    ["Type", "Item", "Where", "Code"].map((h) => txt(h, "header")),
  ];
  const issueRow = (type: string, i: Issue): Cell[] => [
    txt(type),
    txt(i.message, "wrap"),
    t(where(i.fix)),
    t(i.code, "code"),
  ];
  for (const b of r.blockers) reviewRows.push(issueRow("Must fix", b));
  for (const w of r.warnings) reviewRows.push(issueRow("Check", w));
  for (const x of r.excluded)
    reviewRows.push([txt("Left out"), txt(x.reason, "wrap"), t(x.label), null]);
  if (reviewRows.length === 4) reviewRows.push([null, txt("Nothing to review.")]);
  const reviewSheet: SheetSpec = {
    name: SHEET.review,
    rows: reviewRows,
    widths: [11, 80, 26, 22],
    filterHeaderRow: 4,
  };

  // ————————————————————— Read me —————————————————————
  const readme = [
    `Sales tax workpaper for ${periodLabel(r.period)}${meta.businessName ? ` — ${meta.businessName}` : ""}.`,
    "It is not a return and not a My Alabama Taxes upload file. Enter the Summary figures on each return yourself and check them against the fields the return shows.",
    "Summary: one row per taxing authority and rate type. Every authority taxes the same sales, so gross, deductions and taxable repeat on each row — never add them across rows. Tax is the only figure that adds across authorities.",
    "Sales lines: every sale line in the month, counted once. Tax collected is each line's share of the tax on its invoice.",
    'Tax components: one row per sale line per authority. Filter "Filing row" to see exactly what makes up a Summary row.',
    "Review: what blocks filing, what's worth a look, and what was left out of the month.",
    "Dates are the local calendar day (YYYY-MM-DD). Amounts are dollars. Rates are fractions formatted as percents (0.04 = 4%).",
    basisText + ".",
    snap
      ? `${snap.kind === "CORRECTION" ? "Correction" : "Close"} snapshot ${snap.id}, saved by ${snap.reviewerName} on ${dayLabel(snap.createdAt.slice(0, 10))}. Regenerating it gives this same file.`
      : "Live preview — figures can still change until the month is closed.",
    `Generated ${stamp(r.generatedAt)} by Twin Oaks OS (engine v${r.engineVersion}). Companion files sales_lines.csv and tax_components.csv carry the same rows for bookkeeping software.`,
  ];
  const readmeSheet: SheetSpec = {
    name: SHEET.readme,
    rows: [[txt("Read me", "title")], [], ...readme.map((p) => [txt(p, "wrap")])],
    widths: [110],
  };

  const sheets: SheetSpec[] = [
    summarySheet,
    {
      name: SHEET.lines,
      rows: table(lineCols, r.salesLines),
      widths: lineCols.map((c) => c.width),
      freezeRows: 1,
      filterHeaderRow: 1,
      printTitleRows: 1,
    },
    {
      name: SHEET.components,
      rows: table(compCols, r.components),
      widths: compCols.map((c) => c.width),
      freezeRows: 1,
      filterHeaderRow: 1,
      printTitleRows: 1,
    },
    reviewSheet,
    readmeSheet,
  ];

  return buildXlsx(sheets, {
    title: `Sales tax workpaper — ${periodLabel(r.period)}`,
    modified: new Date(r.generatedAt),
  });
}

function statusLine(r: EngineResult): { ok: boolean; text: string } {
  if (r.readyToFile) return { ok: true, text: "Ready to file — nothing blocking" };
  const n = r.blockers.length;
  return {
    ok: false,
    text: `DRAFT — not ready to file: ${n} ${n === 1 ? "item" : "items"} to fix (see Review)`,
  };
}
