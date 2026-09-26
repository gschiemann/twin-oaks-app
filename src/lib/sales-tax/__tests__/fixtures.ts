// Fixture builders for the sales tax tests. Everything here is FICTIONAL —
// "Example County" and its 2% rate come from the design document's
// illustrative workbook; the 4% state general rate is used only because it
// makes the arithmetic clear. No real Twin Oaks data.

import type {
  AuthorityIn,
  EngineInput,
  InvoiceIn,
  InvoiceLineIn,
  LivestockSaleIn,
  LocationIn,
  PaymentIn,
  RateIn,
  RuleIn,
} from "../types";

/** A calendar day at local noon — exactly how the app stores dates. */
export function day(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export const STATE: AuthorityIn = {
  id: "auth-state",
  name: "State of Alabama",
  level: "STATE",
  jurisdictionCode: "",
  taxType: "SS",
};

export const COUNTY: AuthorityIn = {
  id: "auth-county",
  name: "Example County",
  level: "COUNTY",
  jurisdictionCode: "9999",
  taxType: "ST",
};

export const CITY: AuthorityIn = {
  id: "auth-city",
  name: "Example City",
  level: "CITY",
  jurisdictionCode: "9998",
  taxType: "ST",
};

export function rate(over: Partial<RateIn> & Pick<RateIn, "authorityId" | "ratePpm">): RateIn {
  return {
    id: `rate-${over.authorityId}-${over.rateClass ?? "GENERAL"}-${over.ratePpm}-${over.effectiveFrom ? over.effectiveFrom.getTime() : 0}`,
    rateClass: "GENERAL",
    rateTypeCode: over.authorityId === STATE.id ? "OTHER" : "GENER",
    effectiveFrom: day("2000-01-01"),
    effectiveTo: null,
    source: "Fictional example rate",
    confirmedAt: day("2026-09-01"),
    ...over,
  };
}

export const STATE_4 = rate({ authorityId: STATE.id, ratePpm: 40_000 });
export const COUNTY_2 = rate({ authorityId: COUNTY.id, ratePpm: 20_000 });
export const CITY_3 = rate({ authorityId: CITY.id, ratePpm: 30_000 });

export const EXAMPLE_LOCATION: LocationIn = {
  id: "loc-example",
  name: "Example delivery",
  address: "1 Example Rd",
  city: null,
  county: "Example County",
  state: "AL",
  postalCode: "36000",
  insideCity: false,
  policeJurisdiction: null,
  authorityIds: [STATE.id, COUNTY.id],
};

export const CITY_LOCATION: LocationIn = {
  ...EXAMPLE_LOCATION,
  id: "loc-city",
  name: "Example City delivery",
  city: "Example City",
  insideCity: true,
  authorityIds: [STATE.id, COUNTY.id, CITY.id],
};

export function rule(over: Partial<RuleIn> & Pick<RuleIn, "productType" | "treatment">): RuleIn {
  return {
    rateClass: "GENERAL",
    exemptionReason: null,
    requiresEvidence: false,
    approvedBy: "Test reviewer",
    approvedAt: day("2026-09-01"),
    ...over,
  };
}

export const RULES: RuleIn[] = [
  rule({ productType: "PRINTED_PART", treatment: "TAXABLE" }),
  rule({
    productType: "LIVE_LIVESTOCK",
    treatment: "EXEMPT",
    exemptionReason: "Live livestock — illustrative exemption for this example",
  }),
];

let seq = 0;
export function line(
  over: Partial<InvoiceLineIn> & Pick<InvoiceLineIn, "totalCents">,
): InvoiceLineIn {
  seq += 1;
  return {
    id: `line-${seq}`,
    sortOrder: seq,
    description: `Line ${seq}`,
    quantity: 1,
    unitPriceCents: over.totalCents,
    taxable: true,
    productType: "PRINTED_PART",
    taxTreatmentOverride: null,
    exemptionReason: null,
    evidenceDocumentId: null,
    originalLineId: null,
    ...over,
  };
}

export function payment(
  iso: string,
  amountCents: number,
  incomeId: string | null = null,
): PaymentIn {
  seq += 1;
  // Income posted for the full payment — the way payments were booked before
  // the tax share was split out. Override incomeAmountCents to model newer ones.
  return {
    id: `pay-${seq}`,
    date: day(iso),
    amountCents,
    incomeId,
    incomeAmountCents: incomeId ? amountCents : null,
  };
}

/**
 * An invoice whose subtotal/total are derived from its lines and the tax
 * given — i.e. arithmetically consistent unless a test overrides it.
 */
export function invoice(
  over: Partial<InvoiceIn> & Pick<InvoiceIn, "number" | "lines" | "salesTaxCents">,
): InvoiceIn {
  seq += 1;
  const subtotal = over.lines.reduce((s, l) => s + l.totalCents, 0);
  return {
    id: `inv-${seq}`,
    kind: "INVOICE",
    status: "SENT",
    division: "TECH",
    issueDate: day("2026-09-12"),
    customerId: "cust-1",
    customerName: "Example Customer",
    customerTaxTreatment: "DEFAULT",
    customerExemptReason: null,
    customerDocumentIds: [],
    taxLocationId: EXAMPLE_LOCATION.id,
    subtotalCents: subtotal,
    totalCents: subtotal + over.salesTaxCents,
    payments: [],
    ...over,
  };
}

export function livestockSale(
  over: Partial<LivestockSaleIn> & Pick<LivestockSaleIn, "salePriceCents">,
): LivestockSaleIn {
  seq += 1;
  return {
    id: `ls-${seq}`,
    date: day("2026-09-15"),
    buyerName: "Example Buyer",
    customerId: null,
    customerName: null,
    animalLabel: "L-900",
    animalDocumentIds: [],
    taxLocationId: EXAMPLE_LOCATION.id,
    taxTreatmentOverride: null,
    exemptionReason: null,
    incomeId: null,
    ...over,
  };
}

export function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    period: "2026-09",
    basis: "SALE_DATE",
    basisApprovedBy: "Test reviewer",
    authorities: [STATE, COUNTY],
    rates: [STATE_4, COUNTY_2],
    locations: [EXAMPLE_LOCATION],
    rules: RULES,
    invoices: [],
    livestockSales: [],
    incomes: [],
    generatedAt: new Date("2026-09-26T15:00:00Z"),
    ...over,
  };
}

/** The design document's acceptance example: one September invoice. */
export function acceptanceInvoice(): InvoiceIn {
  return invoice({
    number: "INV-EX1",
    issueDate: day("2026-09-12"),
    salesTaxCents: 3450,
    lines: [
      line({ id: "ex-part-225", description: "Printed part", totalCents: 22_500 }),
      line({ id: "ex-part-350", description: "Printed part", totalCents: 35_000 }),
      line({
        id: "ex-lamb-175",
        description: "Live lamb",
        totalCents: 17_500,
        taxable: false,
        productType: "LIVE_LIVESTOCK",
      }),
    ],
    payments: [payment("2026-09-12", 78_450)],
  });
}
