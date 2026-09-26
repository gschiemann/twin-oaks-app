// How much of each invoice payment is sales tax — owed to the state, so
// never income — and how much is revenue. Pure integers, no database.
//
// Tax is allocated to an invoice's payments in the order they were recorded:
//   • a payment carries round(amount × invoice tax ÷ invoice total), rounded
//     half up in integer arithmetic;
//   • the payment that completes the invoice takes whatever tax is left, so
//     the tax across all payments equals the invoice's tax to the cent;
//   • money beyond the invoice total (an overpayment) carries no tax.
// Recording order — not payment date — keeps an earlier payment's share
// fixed when a back-dated payment is added later.

/** Tax share of each payment, in the order given (recording order). */
export function allocatePaymentTax(
  invoiceTotalCents: number,
  invoiceTaxCents: number,
  paymentAmountsCents: readonly number[],
): number[] {
  const total = Math.trunc(invoiceTotalCents);
  const tax = Math.trunc(invoiceTaxCents);
  if (total <= 0 || tax <= 0) return paymentAmountsCents.map(() => 0);
  let paid = 0;
  let allocated = 0;
  return paymentAmountsCents.map((raw) => {
    const amount = Math.max(0, Math.trunc(raw));
    const before = paid;
    paid += amount;
    if (amount === 0 || before >= total) return 0;
    const left = tax - allocated;
    const share = paid >= total ? left : proportional(amount, tax, total);
    const clamped = Math.max(0, Math.min(share, left, amount));
    allocated += clamped;
    return clamped;
  });
}

/** The tax share of a payment about to be recorded after `priorAmountsCents`. */
export function taxShareOfNextPayment(
  invoiceTotalCents: number,
  invoiceTaxCents: number,
  priorAmountsCents: readonly number[],
  amountCents: number,
): number {
  const shares = allocatePaymentTax(invoiceTotalCents, invoiceTaxCents, [
    ...priorAmountsCents,
    amountCents,
  ]);
  return shares[shares.length - 1];
}

/** round(amount × tax ÷ total), half up, exact for integers. */
function proportional(amount: number, tax: number, total: number): number {
  const numerator = 2 * amount * tax + total;
  if (Number.isSafeInteger(numerator)) return Math.floor(numerator / (2 * total));
  return Number((2n * BigInt(amount) * BigInt(tax) + BigInt(total)) / (2n * BigInt(total)));
}
