"use client";

import { useEffect, useRef, useState } from "react";
import { inputCls, labelCls } from "@/components/ui";
import { rateForCustomer, type CustomerTaxRule } from "@/lib/tax";

// BUG-001: the operator never calculates tax by hand. Every keystroke here
// re-derives subtotal → taxable base → tax → total, and the same arithmetic
// runs again server-side (src/lib/tax.ts) so the stored numbers can't drift
// from what was on screen.

type Row = {
  key: number;
  description: string;
  quantity: string;
  price: string;
  taxable: boolean;
};

function rowTotalCents(r: Row): number {
  const qty = Number(r.quantity) || 0;
  const price = Number(r.price.replace(/[$,\s]/g, "")) || 0;
  return Math.round(qty * price * 100);
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function InvoiceLinesEditor({
  initialLines,
  defaultTaxRatePercent,
  initialTaxRatePercent,
  initialManualTaxCents,
  customer,
}: {
  initialLines?: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    taxable: boolean;
  }[];
  defaultTaxRatePercent: number;
  initialTaxRatePercent?: number | null;
  initialManualTaxCents?: number | null;
  customer?: (CustomerTaxRule & { name?: string }) | null;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((l, i) => ({
          key: i,
          description: l.description,
          quantity: String(l.quantity),
          price: (l.unitPriceCents / 100).toFixed(2),
          taxable: l.taxable,
        }))
      : [{ key: 0, description: "", quantity: "1", price: "", taxable: true }],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [rate, setRate] = useState(
    String(initialTaxRatePercent ?? defaultTaxRatePercent ?? 0),
  );
  const [manualOn, setManualOn] = useState(initialManualTaxCents != null);
  const [manual, setManual] = useState(
    initialManualTaxCents != null ? (initialManualTaxCents / 100).toFixed(2) : "",
  );

  // Picking a customer pulls in their tax rule. The first render is skipped
  // so opening an existing invoice keeps the rate it was issued with.
  const customerKey = customer
    ? `${customer.taxTreatment}:${customer.taxRatePercent ?? ""}`
    : "";
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!customer) return;
    setRate(String(rateForCustomer(customer, defaultTaxRatePercent)));
    if (customer.taxTreatment === "EXEMPT") setManualOn(false);
    // customerKey encodes everything that can change the derived rate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerKey]);

  const exempt = customer?.taxTreatment === "EXEMPT";
  const subtotal = rows.reduce((s, r) => s + rowTotalCents(r), 0);
  const taxableBase = rows.reduce((s, r) => s + (r.taxable ? rowTotalCents(r) : 0), 0);
  const ratePct = exempt ? 0 : Number(rate) || 0;
  const computedTax = Math.round((taxableBase * ratePct) / 100);
  const tax = exempt
    ? 0
    : manualOn
      ? Math.round((Number(manual.replace(/[$,\s]/g, "")) || 0) * 100)
      : computedTax;
  const total = subtotal + tax;

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <span className={labelCls}>Line items *</span>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <input
              name={`line-desc-${r.key}`}
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
              placeholder="20 custom brackets, PETG"
              className={`${inputCls} mb-2`}
            />
            <div className="flex items-end gap-2">
              <div className="w-20">
                <label className="mb-1 block text-xs text-stone-500">Qty</label>
                <input
                  name={`line-qty-${r.key}`}
                  value={r.quantity}
                  onChange={(e) => update(r.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  className={inputCls}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-stone-500">Unit price</label>
                <input
                  name={`line-price-${r.key}`}
                  value={r.price}
                  onChange={(e) => update(r.key, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder="$0.00"
                  className={inputCls}
                />
              </div>
              <div className="flex-1 pb-2.5 text-right text-sm font-semibold tabular-nums text-stone-700">
                {money(rowTotalCents(r))}
              </div>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  className="pb-2 text-sm font-medium text-red-500"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              ) : null}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs font-medium text-stone-600">
              <input
                type="checkbox"
                name={`line-taxable-${r.key}`}
                checked={r.taxable}
                onChange={(e) => update(r.key, { taxable: e.target.checked })}
                className="accent-oak-700"
              />
              Taxable
            </label>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          setRows((rs) => [
            ...rs,
            { key: nextKey, description: "", quantity: "1", price: "", taxable: true },
          ]);
          setNextKey((k) => k + 1);
        }}
        className="mt-2 text-sm font-semibold text-oak-700"
      >
        + Add line
      </button>

      {/* Sales tax — calculated, with an escape hatch */}
      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-3">
        {exempt ? (
          <p className="mb-3 rounded-lg bg-oak-50 px-3 py-2 text-sm font-medium text-oak-900">
            🚫 This customer is tax exempt — no tax will be charged.
            {customer?.taxExemptReason ? ` (${customer.taxExemptReason})` : ""}
          </p>
        ) : null}
        <div className={`mb-3 flex items-end gap-3 ${exempt ? "hidden" : ""}`}>
          <div className="w-28">
            <label className="mb-1 block text-xs text-stone-500" htmlFor="taxRatePercent">
              Tax rate %
            </label>
            <input
              id="taxRatePercent"
              name="taxRatePercent"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              className={inputCls}
            />
          </div>
          <label className="flex-1 pb-2.5 text-xs font-medium text-stone-600">
            <input
              type="checkbox"
              checked={manualOn}
              onChange={(e) => setManualOn(e.target.checked)}
              className="mr-2 accent-oak-700"
            />
            Enter tax manually
          </label>
        </div>

        {manualOn ? (
          <div className="mb-3">
            <label className="mb-1 block text-xs text-stone-500" htmlFor="manualTax">
              Tax amount
            </label>
            <input
              id="manualTax"
              name="manualTax"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="decimal"
              placeholder="$0.00"
              className={inputCls}
            />
          </div>
        ) : (
          // The server reads this only when the manual box is unchecked.
          <input type="hidden" name="manualTax" value="" />
        )}

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Subtotal</dt>
            <dd className="font-medium tabular-nums text-stone-900">{money(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Taxable amount</dt>
            <dd className="font-medium tabular-nums text-stone-900">{money(taxableBase)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">
              Sales tax {manualOn ? "(manual)" : `@ ${ratePct || 0}%`}
            </dt>
            <dd className="font-medium tabular-nums text-stone-900">{money(tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-1 text-base font-bold text-stone-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(total)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
