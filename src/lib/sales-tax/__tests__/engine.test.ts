// The design document's acceptance example and every edge case it lists
// ("Before enabling real filing, test…"), run against the pure engine.
//   pnpm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalesTax, distribute } from "../engine";
import type { EngineResult } from "../types";
import {
  CITY,
  CITY_3,
  CITY_LOCATION,
  COUNTY,
  COUNTY_2,
  RULES,
  STATE,
  STATE_4,
  acceptanceInvoice,
  baseInput,
  day,
  invoice,
  line,
  livestockSale,
  payment,
  rate,
  rule,
} from "./fixtures";

/** Invariants every result must satisfy, whatever the scenario. */
function assertInvariants(r: EngineResult) {
  const ids = r.salesLines.map((l) => l.lineId);
  assert.equal(new Set(ids).size, ids.length, "a line is reported twice");
  for (const c of r.components) {
    assert.ok(ids.includes(c.lineId), `component ${c.componentId} has no sales line`);
    assert.equal(c.taxableCents, c.grossCents - c.deductionCents, "taxable = gross - deduction");
    assert.equal(c.differenceCents, c.collectedTaxCents - c.expectedTaxCents);
  }
  const compIds = r.components.map((c) => c.componentId);
  assert.equal(new Set(compIds).size, compIds.length, "a component appears twice");
  for (const row of r.summary) {
    assert.equal(row.taxableCents, row.grossCents - row.deductionCents);
  }
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  assert.equal(sum(r.summary.map((s) => s.expectedTaxCents)), r.totals.expectedTaxCents);
  assert.equal(sum(r.summary.map((s) => s.collectedTaxCents)), r.totals.collectedTaxCents);
  assert.equal(sum(r.salesLines.map((l) => l.taxCollectedCents)), r.totals.collectedTaxCents);
  assert.equal(
    sum(r.salesLines.map((l) => l.totalCents)) + r.totals.unallocatedCollectedCents,
    r.totals.customerTotalCents,
  );
  // Gross is per authority — each authority's gross equals the once-counted
  // sales it covers, never a sum across authorities.
  for (const v of [
    ...r.components.flatMap((c) => [
      c.grossCents,
      c.deductionCents,
      c.taxableCents,
      c.expectedTaxCents,
      c.collectedTaxCents,
      c.differenceCents,
    ]),
    ...Object.values(r.totals),
  ]) {
    assert.ok(!Object.is(v, -0), "no negative zero in money data");
  }
  assert.equal(r.readyToFile, r.blockers.length === 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)), "result must be plain JSON");
}

const find = (r: EngineResult, authority: string, rateType?: string) =>
  r.summary.find(
    (s) => s.authority === authority && (rateType === undefined || s.rateType === rateType),
  );

// —————————————————————————— the acceptance example ——————————————————————————

test("acceptance: $750 once, State OTHER + County GENER, $34.50 tax, $784.50 customer total", () => {
  const r = computeSalesTax(baseInput({ invoices: [acceptanceInvoice()] }));
  assertInvariants(r);

  assert.deepEqual(
    r.blockers,
    [],
    `unexpected blockers: ${r.blockers.map((b) => b.message).join(" | ")}`,
  );
  assert.equal(r.readyToFile, true);
  assert.equal(r.totals.grossSalesCents, 75_000, "pretax sales output ONCE");
  assert.equal(r.salesLines.length, 3);
  assert.equal(r.components.length, 6, "3 lines x 2 authorities");
  assert.equal(r.summary.length, 2, "two filing rows");

  const state = find(r, "State of Alabama", "OTHER")!;
  assert.equal(state.grossCents, 75_000);
  assert.equal(state.deductionCents, 17_500);
  assert.equal(state.taxableCents, 57_500);
  assert.equal(state.expectedTaxCents, 2_300);
  assert.equal(state.collectedTaxCents, 2_300);
  assert.equal(state.differenceCents, 0);
  assert.equal(state.taxType, "SS");

  const county = find(r, "Example County", "GENER")!;
  assert.equal(county.grossCents, 75_000);
  assert.equal(county.deductionCents, 17_500);
  assert.equal(county.taxableCents, 57_500);
  assert.equal(county.expectedTaxCents, 1_150);
  assert.equal(county.collectedTaxCents, 1_150);
  assert.equal(county.differenceCents, 0);
  assert.equal(county.taxType, "ST");
  assert.equal(county.jurisdictionCode, "9999");

  assert.equal(r.totals.expectedTaxCents, 3_450);
  assert.equal(r.totals.collectedTaxCents, 3_450);
  assert.equal(r.totals.differenceCents, 0);
  assert.equal(r.totals.customerTotalCents, 78_450);
  assert.equal(r.totals.stateTaxableCents, 57_500);

  // The exempt lamb is a deduction for EACH authority, with its reason.
  const lamb = r.components.filter((c) => c.lineId === "ex-lamb-175");
  assert.equal(lamb.length, 2);
  for (const c of lamb) {
    assert.equal(c.deductionCents, 17_500);
    assert.equal(c.taxableCents, 0);
    assert.equal(c.taxTreatment, "EXEMPT");
    assert.match(c.exemptionReason, /livestock/i);
  }
});

test("acceptance: changing the period moves everything; nothing is counted twice", () => {
  const inv = acceptanceInvoice();
  const sept = computeSalesTax(baseInput({ invoices: [inv] }));
  const oct = computeSalesTax(baseInput({ period: "2026-10", invoices: [inv] }));
  assertInvariants(oct);
  assert.equal(oct.salesLines.length, 0);
  assert.equal(oct.totals.grossSalesCents, 0);
  assert.equal(oct.totals.expectedTaxCents, 0);
  // Across the two months the sale appears exactly once.
  assert.equal(sept.salesLines.length + oct.salesLines.length, 3);
});

test("acceptance: excluding a line changes every matching report consistently", () => {
  const inv = acceptanceInvoice();
  inv.lines = inv.lines.filter((l) => l.id !== "ex-part-350");
  inv.subtotalCents = 40_000;
  inv.salesTaxCents = 1_350; // 225 x 6%
  inv.totalCents = 41_350;
  inv.payments = [payment("2026-09-12", 41_350)];
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.totals.grossSalesCents, 40_000);
  assert.equal(find(r, "State of Alabama")!.taxableCents, 22_500);
  assert.equal(find(r, "State of Alabama")!.expectedTaxCents, 900);
  assert.equal(find(r, "Example County")!.expectedTaxCents, 450);
  assert.equal(r.totals.expectedTaxCents, 1_350);
});

// —————————————————————————— edge cases from the spec ——————————————————————————

test("a sale across two local jurisdictions: state + county + city rows, tax summed, gross not", () => {
  const inv = invoice({
    number: "INV-2J",
    taxLocationId: CITY_LOCATION.id,
    salesTaxCents: 900, // 100.00 x 9%
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(
    baseInput({
      authorities: [STATE, COUNTY, CITY],
      rates: [STATE_4, COUNTY_2, CITY_3],
      locations: [CITY_LOCATION],
      invoices: [inv],
    }),
  );
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.summary.length, 3);
  assert.deepEqual(
    r.summary.map((s) => s.level),
    ["STATE", "COUNTY", "CITY"],
  );
  for (const s of r.summary)
    assert.equal(s.grossCents, 10_000, "each authority sees the same sale");
  assert.equal(find(r, "Example City")!.expectedTaxCents, 300);
  assert.equal(r.totals.grossSalesCents, 10_000, "NOT 30,000");
  assert.equal(r.totals.expectedTaxCents, 900);
});

test("credit sale: reported at the sale date under SALE_DATE, not until paid under PAYMENT_DATE", () => {
  const inv = invoice({
    number: "INV-CR",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const accrual = computeSalesTax(baseInput({ invoices: [inv] }));
  assertInvariants(accrual);
  assert.equal(accrual.salesLines.length, 1);
  assert.equal(accrual.salesLines[0].paymentDate, "", "unpaid");

  const cash = computeSalesTax(baseInput({ basis: "PAYMENT_DATE", invoices: [inv] }));
  assertInvariants(cash);
  assert.equal(cash.salesLines.length, 0);
  assert.ok(cash.excluded.some((e) => e.label === "INV-CR" && /unpaid/i.test(e.reason)));

  // Paid in October → reported in October under the payment-date basis.
  inv.payments = [payment("2026-10-03", 10_600)];
  const octCash = computeSalesTax(
    baseInput({ basis: "PAYMENT_DATE", period: "2026-10", invoices: [inv] }),
  );
  assertInvariants(octCash);
  assert.equal(octCash.salesLines.length, 1);
  assert.equal(octCash.salesLines[0].paymentDate, "2026-10-03");
  assert.equal(octCash.salesLines[0].saleDate, "2026-09-12", "the sale date is preserved");
  assert.ok(octCash.warnings.some((w) => w.code === "CROSS_MONTH"));
  const sepCash = computeSalesTax(
    baseInput({ basis: "PAYMENT_DATE", period: "2026-09", invoices: [inv] }),
  );
  assert.equal(sepCash.salesLines.length, 0, "not double counted in September");
});

test("partial payment under PAYMENT_DATE is routed to review, not guessed", () => {
  const inv = invoice({
    number: "INV-PP",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
    payments: [payment("2026-09-20", 5_000)],
  });
  const r = computeSalesTax(baseInput({ basis: "PAYMENT_DATE", invoices: [inv] }));
  assertInvariants(r);
  assert.ok(r.blockers.some((b) => b.code === "PARTIAL_PAYMENT"));
  assert.equal(r.salesLines.length, 0);
  assert.equal(r.readyToFile, false);
});

test("payments spread across months under PAYMENT_DATE are reported once, flagged for review", () => {
  const inv = invoice({
    number: "INV-IN",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
    payments: [payment("2026-09-05", 5_000), payment("2026-10-05", 5_600)],
  });
  const sep = computeSalesTax(
    baseInput({ basis: "PAYMENT_DATE", period: "2026-09", invoices: [inv] }),
  );
  const oct = computeSalesTax(
    baseInput({ basis: "PAYMENT_DATE", period: "2026-10", invoices: [inv] }),
  );
  assertInvariants(sep);
  assertInvariants(oct);
  assert.equal(sep.salesLines.length + oct.salesLines.length, 1);
  assert.ok(oct.blockers.some((b) => b.code === "INSTALLMENTS"));
});

test("linked return: reported as a deduction in its own month at the original sale's rate", () => {
  const sale = invoice({
    number: "INV-S1",
    issueDate: day("2026-09-10"),
    salesTaxCents: 1_200,
    lines: [line({ id: "sold-200", totalCents: 20_000 })],
  });
  const ret = invoice({
    number: "INV-R1",
    issueDate: day("2026-10-04"),
    salesTaxCents: -300, // $50 x 6% refunded
    lines: [
      line({ id: "ret-50", productType: "REFUND", totalCents: -5_000, originalLineId: "sold-200" }),
    ],
  });
  const oct = computeSalesTax(baseInput({ period: "2026-10", invoices: [sale, ret] }));
  assertInvariants(oct);
  assert.deepEqual(oct.blockers, []);
  const st = find(oct, "State of Alabama")!;
  assert.equal(st.grossCents, 0, "a return is not negative gross");
  assert.equal(st.deductionCents, 5_000);
  assert.equal(st.taxableCents, -5_000);
  assert.equal(st.expectedTaxCents, -200);
  assert.equal(find(oct, "Example County")!.expectedTaxCents, -100);
  assert.equal(oct.totals.returnsCents, 5_000);
  assert.equal(oct.totals.grossSalesCents, 0);
  assert.equal(oct.salesLines[0].status, "RETURN");
  assert.equal(oct.salesLines[0].originalLineId, "sold-200");
  // September is untouched by the October return.
  const sep = computeSalesTax(baseInput({ period: "2026-09", invoices: [sale, ret] }));
  assert.equal(find(sep, "State of Alabama")!.taxableCents, 20_000);
});

test("a return that doesn't name its original sale blocks filing", () => {
  const ret = invoice({
    number: "INV-R2",
    salesTaxCents: -300,
    lines: [line({ productType: "REFUND", totalCents: -5_000 })],
  });
  const r = computeSalesTax(baseInput({ invoices: [ret] }));
  assert.ok(r.blockers.some((b) => b.code === "REFUND_NO_ORIGINAL"));
});

test("zero-sales month produces a zero workpaper row for every authority filed for", () => {
  const r = computeSalesTax(baseInput({ period: "2026-11" }));
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.readyToFile, true, "a zero return can be filed");
  assert.equal(r.summary.length, 2);
  for (const s of r.summary) {
    assert.equal(s.grossCents, 0);
    assert.equal(s.expectedTaxCents, 0);
  }
  assert.equal(find(r, "State of Alabama")!.rateType, "OTHER");
  assert.deepEqual(find(r, "Example County")!.ratePpms, [20_000]);
});

test("a rate change on an effective date: each sale uses the rate in force that day", () => {
  const oldCounty = rate({
    authorityId: COUNTY.id,
    ratePpm: 20_000,
    effectiveTo: day("2026-09-15"),
  });
  const newCounty = rate({
    authorityId: COUNTY.id,
    ratePpm: 25_000,
    effectiveFrom: day("2026-09-16"),
  });
  const before = invoice({
    number: "INV-B",
    issueDate: day("2026-09-15"),
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const after = invoice({
    number: "INV-A",
    issueDate: day("2026-09-16"),
    salesTaxCents: 650,
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(
    baseInput({ rates: [STATE_4, oldCounty, newCounty], invoices: [before, after] }),
  );
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  const beforeCounty = r.components.find(
    (c) => c.invoiceNumber === "INV-B" && c.level === "COUNTY",
  )!;
  const afterCounty = r.components.find(
    (c) => c.invoiceNumber === "INV-A" && c.level === "COUNTY",
  )!;
  assert.equal(beforeCounty.ratePpm, 20_000);
  assert.equal(beforeCounty.expectedTaxCents, 200);
  assert.equal(afterCounty.ratePpm, 25_000);
  assert.equal(afterCounty.expectedTaxCents, 250);
  assert.equal(afterCounty.rateEffectiveDate, "2026-09-16");
  assert.deepEqual(find(r, "Example County")!.ratePpms, [20_000, 25_000]);
  assert.ok(r.warnings.some((w) => w.code === "MIXED_RATES"));
});

test("no rate for the sale date blocks filing", () => {
  const expired = rate({ authorityId: COUNTY.id, ratePpm: 20_000, effectiveTo: day("2026-08-31") });
  const inv = invoice({
    number: "INV-NR",
    salesTaxCents: 400,
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(baseInput({ rates: [STATE_4, expired], invoices: [inv] }));
  assert.ok(r.blockers.some((b) => b.code === "NO_RATE" && /Example County/.test(b.message)));
});

test("a missing delivery location blocks automatic tax calculation", () => {
  const inv = invoice({
    number: "INV-NL",
    taxLocationId: null,
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assertInvariants(r);
  assert.ok(r.blockers.some((b) => b.code === "NO_LOCATION"));
  assert.equal(r.components.length, 0, "never guessed");
  assert.equal(r.totals.unallocatedCollectedCents, 600);
  assert.equal(r.totals.customerTotalCents, 10_600);
});

// —————————————————————————— ready-to-file blockers ——————————————————————————

test("quotes, drafts and cancelled invoices never create taxable sales", () => {
  const quote = invoice({
    number: "Q-001",
    kind: "QUOTE",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const draft = invoice({
    number: "INV-D",
    status: "DRAFT",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const cancelled = invoice({
    number: "INV-X",
    status: "CANCELLED",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(baseInput({ invoices: [quote, draft, cancelled] }));
  assertInvariants(r);
  assert.equal(r.salesLines.length, 0);
  assert.ok(r.excluded.some((e) => e.label === "INV-D"));
  assert.ok(r.excluded.some((e) => e.label === "INV-X"));
  assert.ok(!r.excluded.some((e) => e.label === "Q-001"));
});

test("tax collected differing from the authority components beyond rounding blocks filing", () => {
  const inv = invoice({
    number: "INV-OV",
    salesTaxCents: 950,
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assertInvariants(r);
  assert.ok(r.blockers.some((b) => b.code === "TAX_MISMATCH"));
  // The over-collection is visible, not hidden.
  assert.equal(r.totals.collectedTaxCents, 950);
  assert.equal(r.totals.expectedTaxCents, 600);
  assert.equal(r.totals.differenceCents, 350);
});

test("a 1¢ rounding difference is a documented adjustment, not a blocker", () => {
  // Two $83.25 lines. Per line per authority: 3.33 + 1.665→1.67 = 5.00 each,
  // $10.00 total. The invoice editor rounds once on $166.50 x 6% = $9.99.
  const lines = () => [line({ totalCents: 8_325 }), line({ totalCents: 8_325 })];
  const exact = computeSalesTax(
    baseInput({ invoices: [invoice({ number: "INV-RD0", salesTaxCents: 1_000, lines: lines() })] }),
  );
  assertInvariants(exact);
  assert.equal(exact.totals.expectedTaxCents, 1_000);
  assert.deepEqual(exact.blockers, []);
  assert.ok(!exact.warnings.some((w) => w.code === "TAX_ROUNDING"));

  const editor = computeSalesTax(
    baseInput({ invoices: [invoice({ number: "INV-RD1", salesTaxCents: 999, lines: lines() })] }),
  );
  assertInvariants(editor);
  assert.deepEqual(editor.blockers, [], "1¢ is within the rounding tolerance");
  assert.ok(editor.warnings.some((w) => w.code === "TAX_ROUNDING" && /1¢/.test(w.message)));
  assert.equal(editor.totals.collectedTaxCents, 999, "what was actually collected is reported");
});

test("invoice arithmetic must reconcile", () => {
  const inv = invoice({
    number: "INV-AR",
    salesTaxCents: 600,
    lines: [line({ totalCents: 10_000 })],
  });
  inv.totalCents = 10_700;
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assert.ok(r.blockers.some((b) => b.code === "TOTAL_MISMATCH"));
});

test("an unclassified line (historic data) needs a decision — nothing is changed automatically", () => {
  const inv = invoice({
    number: "INV-003",
    salesTaxCents: 1_350,
    lines: [
      line({ totalCents: 7_500, productType: "UNCLASSIFIED", description: "Brackets" }),
      line({ totalCents: 15_000, productType: "DESIGN_WITH_PRODUCT", description: "Design" }),
    ],
  });
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assertInvariants(r);
  const needs = r.blockers.filter((b) => b.code === "NEEDS_DECISION");
  assert.equal(needs.length, 2);
  assert.ok(
    needs.some((b) => /Design/.test(b.message)),
    "design with no approved rule stays NEEDS_REVIEW",
  );
  for (const c of r.components) assert.equal(c.reviewStatus, "NEEDS_REVIEW");
});

test("exempt without a reason, and wholesale without a certificate, block filing", () => {
  const noReason = invoice({
    number: "INV-E1",
    salesTaxCents: 0,
    lines: [line({ totalCents: 10_000, taxable: false, taxTreatmentOverride: "EXEMPT" })],
  });
  const wholesale = invoice({
    number: "INV-W1",
    salesTaxCents: 0,
    lines: [
      line({
        totalCents: 10_000,
        taxable: false,
        taxTreatmentOverride: "WHOLESALE",
        exemptionReason: "Resale",
      }),
    ],
  });
  const r = computeSalesTax(baseInput({ invoices: [noReason, wholesale] }));
  assert.ok(r.blockers.some((b) => b.code === "EXEMPT_NO_REASON"));
  assert.ok(r.blockers.some((b) => b.code === "NEEDS_EVIDENCE"));
  wholesale.lines[0].evidenceDocumentId = "doc-resale-cert";
  noReason.lines[0].exemptionReason = "Sold to an exempt school";
  const ok = computeSalesTax(baseInput({ invoices: [noReason, wholesale] }));
  assert.deepEqual(ok.blockers, []);
});

test("a tax-exempt customer needs a certificate on file", () => {
  const inv = invoice({
    number: "INV-EC",
    salesTaxCents: 0,
    customerTaxTreatment: "EXEMPT",
    customerExemptReason: "Resale certificate",
    lines: [line({ totalCents: 10_000 })],
  });
  const r = computeSalesTax(baseInput({ invoices: [inv] }));
  assert.ok(r.blockers.some((b) => b.code === "CUSTOMER_NO_CERT"));
  inv.customerDocumentIds = ["doc-cert"];
  const ok = computeSalesTax(baseInput({ invoices: [inv] }));
  assert.deepEqual(ok.blockers, []);
  assert.equal(ok.components[0].taxTreatment, "EXEMPT");
  assert.equal(ok.components[0].evidenceDocumentId, "doc-cert");
});

test("an invoice entered both as a sale and as independent income blocks filing", () => {
  const inv = acceptanceInvoice();
  const r = computeSalesTax(
    baseInput({
      invoices: [inv],
      incomes: [
        {
          id: "inc-dup",
          date: day("2026-09-13"),
          amountCents: 78_450,
          description: "Customer paid",
          source: null,
        },
      ],
    }),
  );
  assert.ok(r.blockers.some((b) => b.code === "INCOME_DUPLICATE"));
  // An income row LINKED to the payment is the normal bookkeeping entry.
  inv.payments = [payment("2026-09-12", 78_450, "inc-linked")];
  const ok = computeSalesTax(
    baseInput({
      invoices: [inv],
      incomes: [
        {
          id: "inc-linked",
          date: day("2026-09-12"),
          amountCents: 78_450,
          description: "Invoice INV-EX1",
          source: null,
        },
      ],
    }),
  );
  assert.ok(!ok.blockers.some((b) => b.code === "INCOME_DUPLICATE"));
  assert.ok(
    ok.warnings.some((w) => w.code === "INCOME_INCLUDES_TAX" && /\$34\.50/.test(w.message)),
  );
});

test("same amount from a different payer is a coincidence, not a duplicate — but a sale booked only as income is flagged", () => {
  const inv = acceptanceInvoice(); // customer: Example Customer, $784.50
  const other = {
    id: "inc-other",
    date: day("2026-09-20"),
    amountCents: 78_450,
    description: "Market stall takings",
    source: "Farmers market",
    category: "3D-printed product sales",
  };
  const r = computeSalesTax(baseInput({ invoices: [inv], incomes: [other] }));
  assertInvariants(r);
  assert.ok(!r.blockers.some((b) => b.code === "INCOME_DUPLICATE"), "different payer");
  assert.ok(
    r.warnings.some((w) => w.code === "INCOME_NOT_A_SALE" && w.fix.kind === "INCOME"),
    "a sale that only exists as income would miss the return",
  );
  // The same amount from THIS customer is still a likely double entry.
  const same = computeSalesTax(
    baseInput({ invoices: [inv], incomes: [{ ...other, source: "Example Customer" }] }),
  );
  assert.ok(same.blockers.some((b) => b.code === "INCOME_DUPLICATE"));
  assert.ok(!same.warnings.some((w) => w.code === "INCOME_NOT_A_SALE"), "flagged once, not twice");
  // Non-sales income (e.g. "Other business income") isn't nagged about.
  const misc = computeSalesTax(
    baseInput({ invoices: [inv], incomes: [{ ...other, category: "Other business income" }] }),
  );
  assert.ok(!misc.warnings.some((w) => w.code === "INCOME_NOT_A_SALE"));
});

test("livestock sales: exempt by approved rule, flagged if taxable with nothing collected", () => {
  const sale = livestockSale({ salePriceCents: 17_500 });
  const r = computeSalesTax(baseInput({ livestockSales: [sale] }));
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  assert.equal(find(r, "State of Alabama")!.deductionCents, 17_500);
  const taxable = computeSalesTax(
    baseInput({
      livestockSales: [sale],
      rules: [rule({ productType: "LIVE_LIVESTOCK", treatment: "TAXABLE" })],
    }),
  );
  assert.ok(taxable.blockers.some((b) => b.code === "LIVESTOCK_UNCOLLECTED"));
  const noRule = computeSalesTax(baseInput({ livestockSales: [sale], rules: [] }));
  assert.ok(noRule.blockers.some((b) => b.code === "NEEDS_DECISION"));
});

test("a livestock sale also billed on an invoice is caught as a double count", () => {
  const inv = acceptanceInvoice();
  const sale = livestockSale({ salePriceCents: 17_500, buyerName: "Example Customer" });
  const r = computeSalesTax(baseInput({ invoices: [inv], livestockSales: [sale] }));
  assert.ok(r.blockers.some((b) => b.code === "LIVESTOCK_DUPLICATE"));
});

test("discounts follow the rest of the invoice; on a mixed invoice they must be split", () => {
  const plain = invoice({
    number: "INV-DS",
    salesTaxCents: 540,
    lines: [line({ totalCents: 10_000 }), line({ totalCents: -1_000, productType: "DISCOUNT" })],
  });
  const r = computeSalesTax(baseInput({ invoices: [plain] }));
  assertInvariants(r);
  assert.deepEqual(r.blockers, []);
  assert.equal(find(r, "State of Alabama")!.taxableCents, 9_000);
  const mixed = acceptanceInvoice();
  mixed.lines.push(line({ totalCents: -1_000, productType: "DISCOUNT" }));
  mixed.subtotalCents -= 1_000;
  mixed.totalCents -= 1_000;
  const m = computeSalesTax(baseInput({ invoices: [mixed] }));
  assert.ok(m.blockers.some((b) => b.code === "DISCOUNT_MIXED"));
});

test("setup: no authorities or no basis blocks filing", () => {
  const none = computeSalesTax(baseInput({ authorities: [], rates: [], locations: [] }));
  assert.ok(none.blockers.some((b) => b.code === "SETUP_NONE"));
  const noBasis = computeSalesTax(baseInput({ basis: null, invoices: [acceptanceInvoice()] }));
  assert.ok(noBasis.blockers.some((b) => b.code === "BASIS_NONE"));
  assert.equal(noBasis.totals.grossSalesCents, 75_000, "still previews on sale date");
});

test("a rate not re-confirmed for over a year blocks filing", () => {
  const stale = rate({ authorityId: COUNTY.id, ratePpm: 20_000, confirmedAt: day("2025-06-01") });
  const r = computeSalesTax(
    baseInput({ rates: [STATE_4, stale], invoices: [acceptanceInvoice()] }),
  );
  assert.ok(r.blockers.some((b) => b.code === "RATE_STALE" && /Example County/.test(b.message)));
});

test("overlapping rate rows for the same day are a data error", () => {
  const dup = rate({ authorityId: COUNTY.id, ratePpm: 25_000, effectiveFrom: day("2026-01-01") });
  const r = computeSalesTax(
    baseInput({ rates: [STATE_4, COUNTY_2, dup], invoices: [acceptanceInvoice()] }),
  );
  assert.ok(r.blockers.some((b) => b.code === "RATE_OVERLAP"));
});

// —————————————————————————— the backup findings, as a fixture ——————————————————————————

test("migration findings: Aug invoices paid in Sept, design line, 9.5% vs 9% — all flagged, none changed", () => {
  const nine = [
    rate({ authorityId: STATE.id, ratePpm: 40_000 }),
    rate({ authorityId: COUNTY.id, ratePpm: 50_000 }),
  ];
  const inv3 = invoice({
    number: "INV-003",
    issueDate: day("2026-08-20"),
    salesTaxCents: 3_150, // 9% on 350.00 (incl. a $150 design line charged as taxable)
    lines: [
      line({ totalCents: 20_000, productType: "UNCLASSIFIED", description: "Parts" }),
      line({ totalCents: 15_000, productType: "UNCLASSIFIED", description: "Design" }),
    ],
    payments: [payment("2026-09-03", 38_150, "inc-3")],
  });
  const inv4 = invoice({
    number: "INV-004",
    issueDate: day("2026-08-25"),
    salesTaxCents: 950, // 9.5%
    lines: [line({ totalCents: 10_000, description: "Parts" })],
    payments: [payment("2026-09-05", 10_950, "inc-4")],
  });
  const incomes = [
    {
      id: "inc-3",
      date: day("2026-09-03"),
      amountCents: 38_150,
      description: "Invoice INV-003",
      source: null,
    },
    {
      id: "inc-4",
      date: day("2026-09-05"),
      amountCents: 10_950,
      description: "Invoice INV-004",
      source: null,
    },
  ];
  const input = { rates: nine, invoices: [inv3, inv4], incomes };

  // Sale-date basis: they are AUGUST sales.
  const aug = computeSalesTax(baseInput({ ...input, period: "2026-08" }));
  assertInvariants(aug);
  assert.equal(aug.salesLines.length, 3);
  assert.ok(aug.blockers.some((b) => b.code === "NEEDS_DECISION" && /Design/.test(b.message)));
  assert.ok(aug.blockers.some((b) => b.code === "TAX_MISMATCH" && /INV-004/.test(b.message)));
  // Payment-date basis: they are SEPTEMBER sales. Same lines, never both.
  const sep = computeSalesTax(baseInput({ ...input, basis: "PAYMENT_DATE", period: "2026-09" }));
  assert.equal(sep.salesLines.length, 3);
  const augCash = computeSalesTax(
    baseInput({ ...input, basis: "PAYMENT_DATE", period: "2026-08" }),
  );
  assert.equal(augCash.salesLines.length, 0);
  // Income booked with the tax inside it is flagged, not rewritten.
  const sepAccrual = computeSalesTax(baseInput({ ...input, period: "2026-09" }));
  const incomeTax = sepAccrual.warnings.filter((w) => w.code === "INCOME_INCLUDES_TAX");
  assert.equal(incomeTax.length, 2);
  // August invoices flagged in September still say which invoice they are.
  assert.deepEqual(incomeTax.map((w) => (w.fix.kind === "INVOICE" ? w.fix.number : null)).sort(), [
    "INV-003",
    "INV-004",
  ]);
  assert.ok(
    !sepAccrual.blockers.some((b) => b.code === "INCOME_DUPLICATE"),
    "linked income is not a duplicate",
  );
  // The input records are exactly as they were.
  assert.equal(inv3.lines[1].productType, "UNCLASSIFIED");
  assert.equal(inv4.salesTaxCents, 950);
});

test("distribute(): slices always sum exactly and follow the weights", () => {
  assert.deepEqual(distribute(0, [1, 2], [1, 1]), [0, 0]);
  assert.deepEqual(distribute(3, [1, 1, 1], [0, 0, 0]), [1, 1, 1]);
  assert.deepEqual(
    distribute(-5, [0, 0], [3, 1]).reduce((s, x) => s + x, 0),
    -5,
  );
  assert.deepEqual(distribute(7, [0, 0], [0, 0]), [7, 0]);
  const s = distribute(350, [900, 450, 1400, 700], [1, 1, 1, 1]);
  assert.equal(
    s.reduce((a, b) => a + b, 0),
    350,
  );
});

// Keep the shared rules fixture honest.
test("fixture sanity", () => {
  assert.equal(RULES.length, 2);
});
