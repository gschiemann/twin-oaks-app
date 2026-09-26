// Taking sales tax back out of income booked before payments were split.
//   pnpm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { TAX_TAKEN_OUT, corrected, taxHeldInIncome, type FixInvoice } from "../income-fix";

const inv = (over: Partial<FixInvoice> & Pick<FixInvoice, "payments">): FixInvoice => ({
  id: "inv-3",
  number: "INV-003",
  totalCents: 38_150, // $350.00 + $31.50 tax
  salesTaxCents: 3_150,
  ...over,
});

test("a payment whose income is the whole payment holds its tax share", () => {
  const held = taxHeldInIncome(
    [inv({ payments: [{ id: "p1", amountCents: 38_150, incomeId: "i1" }] })],
    [
      {
        id: "i1",
        amountCents: 38_150,
        notes: null,
        description: "Invoice INV-003 — Acme ($381.50)",
      },
    ],
  );
  assert.equal(held.length, 1);
  assert.equal(held[0].taxCents, 3_150);
  const c = corrected(held[0], "Sep 26, 2026");
  assert.equal(c.amountCents, 35_000, "income becomes the pre-tax $350.00");
  assert.equal(c.notes, `$31.50 ${TAX_TAKEN_OUT} Sep 26, 2026 — owed to the state.`);
  assert.equal(c.description, "Invoice INV-003 — Acme ($381.50 paid, $31.50 sales tax)");
});

test("income already booked net, missing, or on an untaxed invoice is left alone", () => {
  const incomes = [
    { id: "net", amountCents: 35_000, notes: null, description: "x" },
    { id: "full", amountCents: 12_000, notes: null, description: "y" },
  ];
  assert.deepEqual(
    taxHeldInIncome(
      [
        inv({ payments: [{ id: "a", amountCents: 38_150, incomeId: "net" }] }),
        inv({ id: "inv-9", payments: [{ id: "b", amountCents: 38_150, incomeId: "gone" }] }),
        inv({
          id: "inv-exempt",
          totalCents: 12_000,
          salesTaxCents: 0,
          payments: [{ id: "c", amountCents: 12_000, incomeId: "full" }],
        }),
      ],
      incomes,
    ),
    [],
  );
});

test("partial payments each give back their own share; together, the invoice's tax", () => {
  const held = taxHeldInIncome(
    [
      inv({
        payments: [
          { id: "p1", amountCents: 10_000, incomeId: "i1" },
          { id: "p2", amountCents: 28_150, incomeId: "i2" },
        ],
      }),
    ],
    [
      {
        id: "i1",
        amountCents: 10_000,
        notes: "Deposit",
        description: "Invoice INV-003 — Acme ($100.00)",
      },
      { id: "i2", amountCents: 28_150, notes: null, description: "Hand-typed description" },
    ],
  );
  assert.deepEqual(
    held.map((h) => h.taxCents),
    [826, 3_150 - 826],
  );
  const [a, b] = held.map((h) => corrected(h, "Sep 26, 2026"));
  assert.equal(a.amountCents + b.amountCents, 35_000, "exactly the pre-tax subtotal");
  assert.equal(a.notes.split("\n")[0], "Deposit", "existing notes are kept");
  assert.equal(b.description, "Hand-typed description", "only the app's own wording is updated");
});

test("once corrected, a row no longer counts as holding tax", () => {
  const invoices = [inv({ payments: [{ id: "p1", amountCents: 38_150, incomeId: "i1" }] })];
  const before = { id: "i1", amountCents: 38_150, notes: null, description: "d" };
  const [h] = taxHeldInIncome(invoices, [before]);
  const after = { ...before, ...corrected(h, "Sep 26, 2026") };
  assert.deepEqual(taxHeldInIncome(invoices, [after]), []);
});
