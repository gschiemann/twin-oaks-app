// The pre-tax split of invoice payments: the tax part is owed to the state,
// only the rest is income.
//   pnpm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatePaymentTax, taxShareOfNextPayment } from "../split";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("one full payment carries exactly the invoice's tax", () => {
  // The design doc's acceptance invoice: $750 + $34.50 tax = $784.50.
  assert.deepEqual(allocatePaymentTax(78_450, 3_450, [78_450]), [3_450]);
  assert.equal(78_450 - taxShareOfNextPayment(78_450, 3_450, [], 78_450), 75_000);
});

test("partial payments: proportional shares, the completing payment takes the rest", () => {
  // $381.50 invoice with $31.50 tax, paid $100 then $281.50.
  const shares = allocatePaymentTax(38_150, 3_150, [10_000, 28_150]);
  assert.equal(shares[0], 826); // 10000 × 3150 ÷ 38150 = 825.69 → 826
  assert.equal(shares[1], 3_150 - 826);
  assert.equal(sum(shares), 3_150, "tax across payments equals the invoice's tax");
});

test("rounding: the last payment absorbs the cents so nothing drifts", () => {
  // Three equal thirds of a $3.00 invoice with $0.10 tax: 3.33¢ each.
  const shares = allocatePaymentTax(300, 10, [100, 100, 100]);
  assert.deepEqual(shares, [3, 3, 4]);
  // Many small payments still sum exactly.
  const many = Array.from({ length: 7 }, () => 1_429); // 7 × 14.29 = 100.03 ≥ 100.00
  const s = allocatePaymentTax(10_000, 700, many);
  assert.equal(sum(s), 700);
  for (const x of s) assert.ok(x >= 0);
});

test("exact half-cent rounds up (integer arithmetic, no float drift)", () => {
  // 50 × 9 ÷ 100 = 4.5 → 5
  assert.equal(allocatePaymentTax(100, 9, [50])[0], 5);
  // 1 × 1 ÷ 2 = 0.5 → 1
  assert.equal(allocatePaymentTax(2, 1, [1])[0], 1);
  // Large amounts stay exact past 2^53 intermediates.
  const big = allocatePaymentTax(9_000_000_000_000, 1_000_000_000, [3_000_000_000_000]);
  assert.equal(big[0], 333_333_333);
});

test("an overpayment carries no tax; neither does a no-tax invoice", () => {
  assert.deepEqual(allocatePaymentTax(10_900, 900, [10_900, 500]), [900, 0]);
  assert.deepEqual(allocatePaymentTax(10_000, 0, [10_000]), [0]);
  assert.deepEqual(allocatePaymentTax(0, 0, [500]), [0]);
  assert.deepEqual(
    allocatePaymentTax(-5_000, -450, [100]),
    [0],
    "credit invoices take no payments' tax",
  );
});

test("a share never exceeds the payment or the tax left", () => {
  // A tiny first payment on a tax-heavy invoice, then the rest.
  const shares = allocatePaymentTax(1_000, 999, [1, 999]);
  assert.ok(shares[0] <= 1);
  assert.equal(sum(shares), 999);
  for (const [i, x] of shares.entries()) assert.ok(x <= [1, 999][i]);
});

test("the next payment's share matches what allocating the whole list gives", () => {
  const prior = [10_000, 5_000];
  const all = allocatePaymentTax(38_150, 3_150, [...prior, 23_150]);
  assert.equal(taxShareOfNextPayment(38_150, 3_150, prior, 23_150), all[2]);
  assert.equal(sum(all), 3_150);
});
