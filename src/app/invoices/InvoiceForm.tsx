"use client";

import Link from "next/link";
import { useState } from "react";
import { type Division } from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import DivisionField from "@/components/DivisionField";
import InvoiceLinesEditor from "./InvoiceLinesEditor";

// Customers carry their own tax rule, so picking one fills the rate in.
export type CustomerOption = {
  id: string;
  name: string;
  company: string | null;
  taxTreatment: string;
  taxRatePercent: number | null;
  taxExemptReason: string | null;
};

type Defaults = {
  id?: string;
  customerId?: string | null;
  division?: string | null;
  issueDate?: Date;
  dueDate?: Date | null;
  terms?: string | null;
  notes?: string | null;
  shipToAddress?: string | null;
  salesTaxCents?: number | null;
  taxRatePercent?: number | null;
  taxManualOverride?: boolean;
  lines?: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    taxable: boolean;
  }[];
};

export default function InvoiceForm({
  action,
  submitLabel,
  customers,
  defaults = {},
  kind = "INVOICE",
  defaultTaxRatePercent,
  divisions,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  customers: CustomerOption[];
  defaults?: Defaults;
  kind?: "INVOICE" | "QUOTE";
  defaultTaxRatePercent: number;
  divisions: Division[];
}) {
  const isQuote = kind === "QUOTE";
  const [customerId, setCustomerId] = useState(defaults.customerId ?? "");
  const selected = customers.find((c) => c.id === customerId) ?? null;

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <input type="hidden" name="kind" value={kind} />

      <div>
        <label className={labelCls} htmlFor="customerId">
          Customer *
        </label>
        <select
          id="customerId"
          name="customerId"
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className={inputCls}
        >
          <option value="" disabled>
            Choose…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.company ? ` — ${c.company}` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Someone new?{" "}
          <Link href="/customers/new?returnTo=invoice" className="font-medium text-oak-700 underline">
            Add a customer
          </Link>{" "}
          first.
        </p>
      </div>

      <DivisionField divisions={divisions} defaultValue={defaults.division ?? "TECH"} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="issueDate">
            {isQuote ? "Quote date *" : "Invoice date *"}
          </label>
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            defaultValue={toDateInputValue(defaults.issueDate ?? new Date())}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="dueDate">
            {isQuote ? "Valid until" : "Due date"}
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={defaults.dueDate ? toDateInputValue(defaults.dueDate) : ""}
            className={inputCls}
          />
        </div>
      </div>

      <InvoiceLinesEditor
        initialLines={defaults.lines}
        defaultTaxRatePercent={defaultTaxRatePercent}
        initialTaxRatePercent={defaults.taxRatePercent}
        initialManualTaxCents={
          defaults.taxManualOverride ? (defaults.salesTaxCents ?? 0) : null
        }
        customer={selected}
      />

      <div>
        <label className={labelCls} htmlFor="terms">
          Payment terms
        </label>
        <input
          id="terms"
          name="terms"
          placeholder="Due in 14 days"
          defaultValue={defaults.terms ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="shipToAddress">
          Ship to (only if different from the customer&apos;s address)
        </label>
        <textarea
          id="shipToAddress"
          name="shipToAddress"
          rows={2}
          defaultValue={defaults.shipToAddress ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes (shown on the invoice)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
