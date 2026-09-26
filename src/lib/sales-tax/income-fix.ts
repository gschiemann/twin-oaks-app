// Income booked before invoice payments were split into pre-tax income and
// sales tax still holds the tax. Pure: finds those rows and says what each
// should become. Applying it lives in src/lib/income-tax-fix.ts — only on the
// owner's say-so — and every corrected row says so in its notes.

import { formatCents } from "@/lib/money";
import { allocatePaymentTax } from "./split";

/** Written into a corrected income's notes; also marks the row as corrected. */
export const TAX_TAKEN_OUT = "sales tax taken out";

export type FixInvoice = {
  id: string;
  number: string;
  totalCents: number;
  salesTaxCents: number;
  /** In recording order — the order tax is allocated in. */
  payments: { id: string; amountCents: number; incomeId: string | null }[];
};

export type FixIncome = {
  id: string;
  amountCents: number;
  notes: string | null;
  description: string;
};

export type TaxHeld = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentCents: number;
  /** This payment's sales tax share — what comes out of the income. */
  taxCents: number;
  income: FixIncome;
};

/** Payments whose linked income is still the whole payment, tax included. */
export function taxHeldInIncome(invoices: FixInvoice[], incomes: FixIncome[]): TaxHeld[] {
  const byId = new Map(incomes.map((i) => [i.id, i]));
  const held: TaxHeld[] = [];
  for (const inv of invoices) {
    if (inv.salesTaxCents <= 0 || inv.totalCents <= 0) continue;
    const shares = allocatePaymentTax(
      inv.totalCents,
      inv.salesTaxCents,
      inv.payments.map((p) => p.amountCents),
    );
    inv.payments.forEach((p, i) => {
      const income = p.incomeId ? byId.get(p.incomeId) : undefined;
      if (!income || shares[i] <= 0 || income.amountCents < p.amountCents) return;
      held.push({
        paymentId: p.id,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        paymentCents: p.amountCents,
        taxCents: shares[i],
        income,
      });
    });
  }
  return held;
}

/**
 * The corrected row: the tax share out, a dated note, and — when it is the
 * app's own "Invoice INV-003 — Customer ($381.50)" — a description that
 * matches how payments are described now.
 */
export function corrected(
  h: TaxHeld,
  onDay: string,
): { amountCents: number; notes: string; description: string } {
  const note = `${formatCents(h.taxCents)} ${TAX_TAKEN_OUT} ${onDay} — owed to the state.`;
  const paid = `(${formatCents(h.paymentCents)})`;
  const d = h.income.description;
  const description =
    d.startsWith(`Invoice ${h.invoiceNumber} — `) && d.endsWith(paid)
      ? `${d.slice(0, -paid.length)}(${formatCents(h.paymentCents)} paid, ${formatCents(h.taxCents)} sales tax)`
      : d;
  return {
    amountCents: h.income.amountCents - h.taxCents,
    notes: h.income.notes ? `${h.income.notes}\n${note}` : note,
    description,
  };
}
