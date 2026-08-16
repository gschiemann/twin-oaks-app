import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { TAX_TREATMENTS, TAX_TREATMENT_LABELS, type TaxTreatment } from "@/lib/tax";

type Defaults = {
  id?: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  taxTreatment?: string | null;
  taxRatePercent?: number | null;
  taxExemptReason?: string | null;
};

export default function CustomerForm({
  action,
  submitLabel,
  defaults = {},
  returnTo,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  returnTo?: string;
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div>
        <label className={labelCls} htmlFor="name">
          Name *
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaults.name ?? ""}
          placeholder="Jane Hartley"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="company">
          Company
        </label>
        <input
          id="company"
          name="company"
          defaultValue={defaults.company ?? ""}
          placeholder="Acme Fabrication"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={defaults.phone ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults.email ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="address">
          Address
        </label>
        <textarea
          id="address"
          name="address"
          rows={2}
          defaultValue={defaults.address ?? ""}
          className={inputCls}
        />
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <span className={labelCls}>Sales tax for this customer</span>
        <div className="space-y-2">
          {TAX_TREATMENTS.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 has-checked:border-oak-600 has-checked:bg-oak-50 has-checked:text-oak-800"
            >
              <input
                type="radio"
                name="taxTreatment"
                value={t}
                defaultChecked={(defaults.taxTreatment ?? "DEFAULT") === t}
                className="accent-oak-700"
              />
              {TAX_TREATMENT_LABELS[t as TaxTreatment]}
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500" htmlFor="taxRatePercent">
              Their rate %
            </label>
            <input
              id="taxRatePercent"
              name="taxRatePercent"
              inputMode="decimal"
              placeholder="9.5"
              defaultValue={defaults.taxRatePercent ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500" htmlFor="taxExemptReason">
              Exempt reason / cert #
            </label>
            <input
              id="taxExemptReason"
              name="taxExemptReason"
              placeholder="Resale cert #12345"
              defaultValue={defaults.taxExemptReason ?? ""}
              className={inputCls}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Set once — every invoice for this customer starts with the right treatment. Exempt
          customers are never taxed, whatever the invoice says.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          Notes
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
