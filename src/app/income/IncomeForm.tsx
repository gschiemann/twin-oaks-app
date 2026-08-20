import {
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  type Division,
} from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import DivisionField from "@/components/DivisionField";

type Defaults = {
  id?: string;
  date?: Date;
  source?: string | null;
  description?: string | null;
  amountCents?: number | null;
  division?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
};

export default function IncomeForm({
  action,
  submitLabel,
  defaults = {},
  divisions,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  divisions: Division[];
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="date">
            Date *
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={toDateInputValue(defaults.date ?? new Date())}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="amount">
            Amount *
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="$0.00"
            defaultValue={defaults.amountCents != null ? (defaults.amountCents / 100).toFixed(2) : ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="description">
          Description *
        </label>
        <input
          id="description"
          name="description"
          required
          defaultValue={defaults.description ?? ""}
          placeholder="20 custom brackets for Acme Fab"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="source">
          Customer / buyer
        </label>
        <input id="source" name="source" defaultValue={defaults.source ?? ""} className={inputCls} />
      </div>

      <DivisionField divisions={divisions} defaultValue={defaults.division ?? "TECH"} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="category">
            Income category *
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue={defaults.category ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Choose…
            </option>
            {INCOME_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="paymentMethod">
            Payment method
          </label>
          <select
            id="paymentMethod"
            name="paymentMethod"
            defaultValue={defaults.paymentMethod ?? ""}
            className={inputCls}
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} className={inputCls} />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
