import { ACCOUNTING_CATEGORIES, type Division } from "@/lib/domain";
import { MAX_BILL_DAY, ordinalDay } from "@/lib/bills";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import DivisionField from "@/components/DivisionField";

type Defaults = {
  id?: string;
  description?: string | null;
  amountCents?: number | null;
  division?: string | null;
  accountingCategory?: string | null;
  vendorName?: string | null;
  dayOfMonth?: number | null;
  active?: boolean | null;
  notes?: string | null;
};

export default function BillForm({
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

      <div>
        <label className={labelCls} htmlFor="description">
          What is the bill? *
        </label>
        <input
          id="description"
          name="description"
          required
          defaultValue={defaults.description ?? ""}
          placeholder="Farm insurance"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="amount">
            Amount each month *
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="$0.00"
            defaultValue={
              defaults.amountCents != null ? (defaults.amountCents / 100).toFixed(2) : ""
            }
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="dayOfMonth">
            Day it is due
          </label>
          <select
            id="dayOfMonth"
            name="dayOfMonth"
            defaultValue={String(defaults.dayOfMonth ?? 1)}
            className={inputCls}
          >
            {Array.from({ length: MAX_BILL_DAY }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                the {ordinalDay(d)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-stone-500">
        The list stops at the 28th on purpose: every month has a 28th, but February usually has no
        29th and no month past it has a 31st every time. Picking a day that exists in all twelve
        months means a bill can never quietly skip one.
      </p>

      <DivisionField divisions={divisions} defaultValue={defaults.division ?? divisions[0]} />

      <div>
        <label className={labelCls} htmlFor="accountingCategory">
          Category *
        </label>
        <select
          id="accountingCategory"
          name="accountingCategory"
          required
          defaultValue={defaults.accountingCategory ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Choose…
          </option>
          {ACCOUNTING_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Used to suggest the category when you record the payment — the bill itself never lands in
          your books on its own.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="vendorName">
          Who you pay
        </label>
        <input
          id="vendorName"
          name="vendorName"
          defaultValue={defaults.vendorName ?? ""}
          placeholder="Farm Bureau"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-stone-500">
          Worth filling in: it is how the app spots that you have probably already paid this month.
        </p>
      </div>

      <label className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
        <input
          type="checkbox"
          name="active"
          defaultChecked={defaults.active ?? true}
          className="mt-0.5 accent-oak-700"
        />
        <span>
          <span className="font-medium">Still paying this one</span> — leave it ticked to see it in
          What&apos;s coming up. Untick to pause it without losing the record.
        </span>
      </label>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="Account #, autopay from the checking account, renews in June…"
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
