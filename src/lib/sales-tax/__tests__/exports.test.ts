// The exports: the two bookkeeping CSVs and the accountant's workbook.
//   pnpm test
//
// The workbook's Summary is formula-driven; these tests recompute every
// formula from the raw sheet data (xlsx-reader.ts) and require it to equal
// the engine's figures — i.e. what Excel will show after it recalculates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalesTax } from "../engine";
import {
  SALES_LINES_COLUMNS,
  TAX_COMPONENTS_COLUMNS,
  salesLinesCsv,
  taxComponentsCsv,
} from "../csv";
import { SHEET, salesTaxWorkbook, type WorkbookMeta } from "../workbook";
import type { EngineResult } from "../types";
import { assertWellFormed, readXlsx, recomputeAll, type XBook } from "./xlsx-reader";
import {
  CITY,
  CITY_3,
  CITY_LOCATION,
  COUNTY,
  EXAMPLE_LOCATION,
  STATE,
  STATE_4,
  acceptanceInvoice,
  baseInput,
  day,
  invoice,
  line,
  payment,
  rate,
} from "./fixtures";

const META: WorkbookMeta = { businessName: "Example Farm & Tech", appUrl: "https://example.test" };

// The document's "Suggested CSV columns", verbatim.
const SPEC_SALES_LINES =
  "report_period,line_id,invoice_id,sale_date,payment_date,division,description,product_type,delivery_city,delivery_county,delivery_state,pretax_amount,invoice_tax_collected,invoice_total,status,source_document_id";
const SPEC_TAX_COMPONENTS =
  "report_period,component_id,line_id,authority,jurisdiction_code,tax_type,rate_type,gross_amount,deduction_amount,taxable_amount,rate,expected_tax,collected_tax,exemption_reason,review_status";

/** Minimal RFC-4180 parser (quotes, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  assert.ok(text.startsWith("﻿"), "UTF-8 BOM so Excel reads it as UTF-8");
  const s = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && s[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  assert.equal(cell, "", "file ends with CRLF");
  assert.equal(row.length, 0);
  return rows;
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  for (const r of rows) assert.equal(r.length, header.length, "every row has every column");
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const cents = (s: string) => {
  assert.match(s, /^-?\d+\.\d{2}$/, `"${s}" is decimal dollars with two places`);
  const neg = s.startsWith("-");
  const [w, f] = s.replace("-", "").split(".");
  const v = Number(w) * 100 + Number(f);
  return neg ? -v : v;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** A month with a bit of everything: discount, linked return, unallocated tax, mid-month rate change. */
function busyMonth(): EngineResult {
  const august = invoice({
    number: "INV-A1",
    issueDate: day("2026-08-20"),
    salesTaxCents: 900,
    taxLocationId: CITY_LOCATION.id,
    lines: [line({ id: "aug-part", description: "Bracket", totalCents: 10_000 })],
    payments: [payment("2026-08-20", 10_900)],
  });
  const refund = invoice({
    number: "INV-R1",
    issueDate: day("2026-09-05"),
    salesTaxCents: -450,
    taxLocationId: CITY_LOCATION.id,
    lines: [
      line({
        id: "sep-refund",
        description: "Return of bracket",
        totalCents: -5_000,
        productType: "REFUND",
        originalLineId: "aug-part",
      }),
    ],
  });
  const discounted = invoice({
    number: "INV-D1",
    issueDate: day("2026-09-20"),
    salesTaxCents: 1_170, // (200 - 20) x (4% + 2.5%): the county rate changed on the 16th
    lines: [
      line({ id: "d-part", description: "Enclosure", totalCents: 20_000 }),
      line({
        id: "d-disc",
        description: "Loyalty discount",
        totalCents: -2_000,
        productType: "DISCOUNT",
      }),
    ],
    payments: [payment("2026-09-21", 19_170)],
  });
  const early = invoice({
    number: "INV-E1",
    issueDate: day("2026-09-10"),
    salesTaxCents: 60,
    lines: [line({ id: "e-part", description: "Knob", totalCents: 1_000 })],
  });
  const nowhere = invoice({
    number: "INV-N1",
    issueDate: day("2026-09-25"),
    salesTaxCents: 300,
    taxLocationId: null,
    lines: [line({ id: "n-part", description: "Hinge", totalCents: 5_000 })],
  });
  return computeSalesTax(
    baseInput({
      authorities: [STATE, COUNTY, CITY],
      rates: [
        STATE_4,
        CITY_3,
        rate({ authorityId: COUNTY.id, ratePpm: 20_000, effectiveTo: day("2026-09-15") }),
        rate({ authorityId: COUNTY.id, ratePpm: 25_000, effectiveFrom: day("2026-09-16") }),
      ],
      locations: [EXAMPLE_LOCATION, CITY_LOCATION],
      invoices: [august, refund, discounted, early, nowhere],
    }),
  );
}

// ——————————————————————————————— CSV ———————————————————————————————

test("csv: headers start with the document's suggested columns, verbatim and in order", () => {
  assert.equal(SALES_LINES_COLUMNS.slice(0, 16).join(","), SPEC_SALES_LINES);
  assert.equal(TAX_COMPONENTS_COLUMNS.slice(0, 15).join(","), SPEC_TAX_COMPONENTS);
  const r = computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] }));
  assert.ok(salesLinesCsv(r).startsWith(`﻿${SPEC_SALES_LINES},`));
  assert.ok(taxComponentsCsv(r).startsWith(`﻿${SPEC_TAX_COMPONENTS},`));
});

test("csv: acceptance example — real rows, ISO dates, month key, 2-dp dollars, 0.04 rates", () => {
  const r = computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] }));
  const lines = records(salesLinesCsv(r));
  const comps = records(taxComponentsCsv(r));
  assert.equal(lines.length, 3, "one row per actual line, not a placeholder header");
  assert.equal(comps.length, 6, "one row per line per authority");

  for (const l of lines) {
    assert.equal(l.report_period, "2026-09");
    assert.equal(l.sale_date, "2026-09-12");
    assert.equal(l.payment_date, "2026-09-12");
    assert.equal(l.invoice_id, "INV-EX1");
    assert.equal(l.delivery_state, "AL");
    assert.equal(cents(l.pretax_amount) + cents(l.invoice_tax_collected), cents(l.invoice_total));
  }
  assert.equal(sum(lines.map((l) => cents(l.pretax_amount))), 75_000, "$750 pretax, once");
  assert.equal(sum(lines.map((l) => cents(l.invoice_tax_collected))), 3_450);
  assert.equal(sum(lines.map((l) => cents(l.invoice_total))), 78_450, "customer total $784.50");
  const lamb = lines.find((l) => l.line_id === "ex-lamb-175")!;
  assert.equal(lamb.product_type, "LIVE_LIVESTOCK");
  assert.equal(lamb.tax_treatment, "EXEMPT");
  assert.equal(lamb.pretax_amount, "175.00");

  const state = comps.filter((c) => c.authority === "State of Alabama");
  const county = comps.filter((c) => c.authority === "Example County");
  assert.ok(
    state.every((c) => c.rate === "0.04" && c.tax_type === "SS" && c.rate_type === "OTHER"),
  );
  assert.ok(
    county.every((c) => c.rate === "0.02" && c.tax_type === "ST" && c.rate_type === "GENER"),
  );
  assert.ok(county.every((c) => c.jurisdiction_code === "9999"));
  for (const group of [state, county]) {
    assert.equal(sum(group.map((c) => cents(c.gross_amount))), 75_000);
    assert.equal(sum(group.map((c) => cents(c.deduction_amount))), 17_500);
    assert.equal(sum(group.map((c) => cents(c.taxable_amount))), 57_500);
    for (const c of group) {
      assert.equal(cents(c.taxable_amount), cents(c.gross_amount) - cents(c.deduction_amount));
      assert.equal(cents(c.difference), 0);
    }
  }
  assert.equal(sum(state.map((c) => cents(c.expected_tax))), 2_300);
  assert.equal(sum(county.map((c) => cents(c.expected_tax))), 1_150);
  assert.equal(sum(comps.map((c) => cents(c.collected_tax))), 3_450);
  const lambComps = comps.filter((c) => c.line_id === "ex-lamb-175");
  assert.equal(lambComps.length, 2);
  assert.ok(
    lambComps.every(
      (c) => c.deduction_amount === "175.00" && /livestock/i.test(c.exemption_reason),
    ),
  );
});

test("csv: rates are fractions, never percents; money is always two decimals", () => {
  const r = busyMonth();
  const comps = records(taxComponentsCsv(r));
  for (const c of comps) {
    if (c.rate === "") continue;
    assert.match(c.rate, /^0\.\d+$/, `rate "${c.rate}" is an unformatted fraction`);
    assert.ok(Number(c.rate) < 1);
  }
  assert.ok(
    comps.some((c) => c.rate === "0.025"),
    "the new county rate appears exactly",
  );
  assert.ok(comps.some((c) => c.rate === "0.03"));
  for (const c of comps) {
    for (const k of [
      "gross_amount",
      "deduction_amount",
      "taxable_amount",
      "expected_tax",
      "collected_tax",
      "difference",
    ]) {
      cents(c[k]);
    }
  }
  for (const l of records(salesLinesCsv(r))) {
    for (const k of ["pretax_amount", "invoice_tax_collected", "invoice_total"]) cents(l[k]);
  }
});

test("csv: quotes, commas and non-ASCII text survive a round trip; returns keep their original", () => {
  const lines = records(salesLinesCsv(busyMonth()));
  const refund = lines.find((l) => l.line_id === "sep-refund")!;
  assert.equal(refund.status, "RETURN");
  assert.equal(refund.original_line_id, "aug-part");
  assert.equal(refund.pretax_amount, "-50.00");
  assert.equal(refund.sale_date, "2026-09-05");
  assert.equal(refund.tax_location, "Example City delivery");

  const tricky = 'Bracket 2" wide, black — “matte”';
  const r = computeSalesTax(
    baseInput({
      invoices: [
        invoice({
          number: "INV-Q1",
          salesTaxCents: 60,
          customerName: "Smith, Jones & Co.",
          lines: [line({ id: "q-part", description: tricky, totalCents: 1_000 })],
        }),
      ],
    }),
  );
  const [row] = records(salesLinesCsv(r));
  assert.equal(row.description, tricky);
  assert.equal(row.customer, "Smith, Jones & Co.");
  assert.ok(salesLinesCsv(r).includes('"Bracket 2"" wide, black — “matte”"'), "RFC-4180 quoting");
});

// ——————————————————————————————— XLSX ———————————————————————————————

function book(r: EngineResult, meta: WorkbookMeta = META): XBook {
  return readXlsx(salesTaxWorkbook(r, meta));
}

function rowWith(b: XBook, sheet: string, col: string, text: string): number {
  for (const [ref, c] of b.sheets.get(sheet)!) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    if (m[1] === col && c.v === text) return Number(m[2]);
  }
  throw new Error(`No "${text}" in ${sheet} column ${col}`);
}

const val = (b: XBook, sheet: string, ref: string) => b.sheets.get(sheet)!.get(ref)?.v ?? null;

/** Every formula recomputes (from raw data) to exactly its cached value. */
function assertFormulasHold(b: XBook) {
  const all = recomputeAll(b);
  assert.ok(all.length > 0);
  for (const x of all) {
    if (typeof x.cached === "number") {
      assert.equal(typeof x.computed, "number", `${x.ref} ${x.formula}`);
      assert.ok(
        Math.abs((x.computed as number) - x.cached) < 1e-9,
        `${x.ref}: ${x.formula} = ${x.computed}, cached ${x.cached}`,
      );
    } else {
      assert.equal(x.computed, x.cached, `${x.ref}: ${x.formula}`);
    }
  }
}

test("xlsx: a complete, well-formed package with the five sheets", () => {
  const b = book(computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] })));
  assert.deepEqual(b.names, [
    SHEET.summary,
    SHEET.lines,
    SHEET.components,
    SHEET.review,
    SHEET.readme,
  ]);
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet5.xml",
  ]) {
    assert.ok(b.parts[part], `missing ${part}`);
  }
  for (const [name, xml] of Object.entries(b.parts)) assertWellFormed(xml, name);
  // Filters + frozen headers on the detail sheets.
  assert.match(b.parts["xl/worksheets/sheet2.xml"], /<autoFilter ref="A1:V4"\/>/);
  assert.match(b.parts["xl/worksheets/sheet3.xml"], /<autoFilter ref="A1:W7"\/>/);
  assert.match(b.parts["xl/worksheets/sheet3.xml"], /state="frozen"/);
  assert.match(b.parts["xl/workbook.xml"], /_xlnm\._FilterDatabase/);
});

test("xlsx: acceptance figures on the Summary, and every formula re-proves them", () => {
  const r = computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] }));
  const b = book(r);
  assertFormulasHold(b);
  const S = SHEET.summary;
  const state = rowWith(b, S, "B", "State of Alabama");
  const county = rowWith(b, S, "B", "Example County");
  assert.deepEqual(
    ["E", "F", "H", "I", "J", "K", "L", "M", "N", "O", "P"].map((c) => val(b, S, `${c}${state}`)),
    ["SS", "OTHER", 750, 175, 575, 23, 23, 0, 0, 23, 3],
  );
  assert.deepEqual(
    ["D", "E", "F", "H", "I", "J", "K", "L", "M", "N", "O", "P"].map((c) =>
      val(b, S, `${c}${county}`),
    ),
    ["9999", "ST", "GENER", 750, 175, 575, 11.5, 11.5, 0, 0, 11.5, 3],
  );
  assert.equal(val(b, S, `G${state}`), 0.04);
  assert.equal(val(b, S, `G${county}`), 0.02);
  const total = rowWith(b, S, "B", "Total tax, all authorities");
  assert.equal(val(b, S, `K${total}`), 34.5);
  assert.equal(val(b, S, `L${total}`), 34.5);
  assert.equal(val(b, S, `M${total}`), 0);
  assert.equal(val(b, S, `H${total}`), null, "gross is never totalled across authorities");
  assert.equal(val(b, S, `H${rowWith(b, S, "B", "Pretax sales (counted once)")}`), 750);
  assert.equal(val(b, S, `H${rowWith(b, S, "B", "Customer total (sales + tax)")}`), 784.5);
  assert.equal(val(b, S, `H${rowWith(b, S, "B", "Difference (collected − due)")}`), 0);
  assert.match(String(val(b, S, "A3")), /^Ready to file/);
});

test("xlsx: codes stay text, dates are real dates, invoices link back to the app", () => {
  const b = book(computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] })));
  const comps = b.sheets.get(SHEET.components)!;
  const code = [...comps.entries()].find(([, c]) => c.v === "9999");
  assert.ok(code, "jurisdiction code present");
  assert.equal(code![1].t, "inlineStr", "codes are stored as text, not numbers");
  const lines = b.sheets.get(SHEET.lines)!;
  assert.equal(lines.get("C2")?.v, 46277, "2026-09-12 as an Excel date serial");
  assert.equal(lines.get("B2")?.v, "INV-EX1");
  assert.match(
    lines.get("B2")?.f ?? "",
    /^HYPERLINK\("https:\/\/example\.test\/invoices\/inv-\d+","INV-EX1"\)$/,
  );
  const plain = readXlsx(
    salesTaxWorkbook(computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] })), {
      businessName: "X",
    }),
  );
  assert.equal(
    plain.sheets.get(SHEET.lines)!.get("B2")?.f,
    undefined,
    "no link without an app URL",
  );
});

test("xlsx: a busy month — return, discount, unallocated tax, two rates — still re-proves", () => {
  const r = busyMonth();
  const b = book(r);
  assertFormulasHold(b);
  const S = SHEET.summary;
  assert.equal(
    val(b, S, `H${rowWith(b, S, "B", "Pretax sales (counted once)")}`),
    r.totals.grossSalesCents / 100,
  );
  assert.equal(
    val(b, S, `H${rowWith(b, S, "B", "Returns and refunds")}`),
    r.totals.returnsCents / 100,
  );
  assert.equal(r.totals.returnsCents, 5_000);
  assert.equal(
    val(b, S, `H${rowWith(b, S, "B", "Tax collected with no location (in no row)")}`),
    3,
  );
  assert.equal(
    val(b, S, `H${rowWith(b, S, "B", "Customer total (sales + tax)")}`),
    r.totals.customerTotalCents / 100,
  );
  const county = rowWith(b, S, "B", "Example County");
  assert.equal(val(b, S, `G${county}`), "2% / 2.5%", "a mid-month rate change shows both rates");
  assert.match(String(val(b, S, "A3")), /^DRAFT — not ready to file/);
  // The Review sheet lists what blocks filing.
  const review = [...b.sheets.get(SHEET.review)!.values()].map((c) => c.v);
  assert.ok(review.includes("Must fix"));
  assert.ok(review.some((v) => typeof v === "string" && v.includes("INV-N1")));
});

test("xlsx: a zero-sales month is a zero workpaper, not an empty file", () => {
  const r = computeSalesTax(baseInput({ period: "2026-10" }));
  const b = book(r);
  assertFormulasHold(b);
  const S = SHEET.summary;
  const state = rowWith(b, S, "B", "State of Alabama");
  assert.deepEqual(
    ["H", "I", "J", "K", "L", "M", "N"].map((c) => val(b, S, `${c}${state}`)),
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(val(b, S, `H${rowWith(b, S, "B", "Customer total (sales + tax)")}`), 0);
  assert.match(String(val(b, S, "A1")), /October 2026/);
});

test("xlsx + csv: a saved snapshot regenerates byte-for-byte", () => {
  const r = busyMonth();
  const meta: WorkbookMeta = {
    ...META,
    snapshot: {
      id: "snap-1",
      kind: "CLOSE",
      reviewerName: "Test reviewer",
      createdAt: "2026-10-02T14:00:00.000Z",
    },
  };
  const restored = JSON.parse(JSON.stringify(r)) as EngineResult; // what the database holds
  assert.deepEqual(salesTaxWorkbook(restored, meta), salesTaxWorkbook(r, meta));
  assert.equal(salesLinesCsv(restored), salesLinesCsv(r));
  assert.equal(taxComponentsCsv(restored), taxComponentsCsv(r));
  // …and a different generation time really is a different file.
  const later = { ...restored, generatedAt: "2026-10-03T09:00:00.000Z" };
  assert.notDeepEqual(salesTaxWorkbook(later, meta), salesTaxWorkbook(r, meta));
  const b = readXlsx(salesTaxWorkbook(restored, meta));
  assert.match(
    String(val(b, SHEET.summary, "A5")),
    /Month closed by Test reviewer \(snapshot snap-1\)/,
  );
});
