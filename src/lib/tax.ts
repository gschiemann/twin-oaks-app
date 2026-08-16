// BUG-001 — sales tax is calculated, never hand-typed.
//
// Rules:
// • Tax applies only to lines marked taxable (labor/freight are commonly
//   exempt), so the taxable base is its own number, shown to the operator.
// • The rate that was actually used is stored on the transaction, so a
//   later rate change in Settings never rewrites an issued invoice.
// • A manual override always wins — some jurisdictions and paper forms
//   round differently, and the operator must be able to match them exactly.

export type TaxableLine = { totalCents: number; taxable: boolean };

export type TaxBreakdown = {
  subtotalCents: number;
  taxableCents: number;
  taxRatePercent: number;
  salesTaxCents: number;
  totalCents: number;
  manual: boolean;
};

export function computeTax(
  lines: TaxableLine[],
  taxRatePercent: number,
  manualTaxCents?: number | null,
): TaxBreakdown {
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const taxableCents = lines.reduce((s, l) => s + (l.taxable ? l.totalCents : 0), 0);

  const rate = Number.isFinite(taxRatePercent) && taxRatePercent > 0 ? taxRatePercent : 0;
  const manual = manualTaxCents != null;
  const salesTaxCents = manual
    ? Math.max(0, Math.round(manualTaxCents))
    : Math.round((taxableCents * rate) / 100);

  return {
    subtotalCents,
    taxableCents,
    taxRatePercent: rate,
    salesTaxCents,
    totalCents: subtotalCents + salesTaxCents,
    manual,
  };
}

// "8.25%" without trailing zero noise.
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(4)).toString()}%`;
}

// ————— Per-customer tax treatment —————
//
// Address-based rate lookup is the eventual goal, but an address alone can't
// answer the two questions that decide the number: do we have nexus in that
// state at all, and is THIS customer exempt (resale/farm certificate)? So the
// rule lives on the customer, where a human put it deliberately.

export const TAX_TREATMENTS = ["DEFAULT", "RATE", "EXEMPT"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  DEFAULT: "Use my default rate",
  RATE: "Their own rate",
  EXEMPT: "Tax exempt",
};

export type CustomerTaxRule = {
  taxTreatment: string;
  taxRatePercent: number | null;
  taxExemptReason?: string | null;
};

// The rate an invoice for this customer should start at. Exempt customers
// resolve to 0 — never to the house rate.
export function rateForCustomer(
  customer: CustomerTaxRule | null | undefined,
  defaultRatePercent: number,
): number {
  if (!customer) return defaultRatePercent;
  if (customer.taxTreatment === "EXEMPT") return 0;
  if (customer.taxTreatment === "RATE") return customer.taxRatePercent ?? 0;
  return defaultRatePercent;
}

export function isExempt(customer: CustomerTaxRule | null | undefined): boolean {
  return customer?.taxTreatment === "EXEMPT";
}
