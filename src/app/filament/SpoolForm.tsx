import { FILAMENT_MATERIALS, SPOOL_STATUSES, SPOOL_STATUS_LABELS } from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

type Defaults = {
  id?: string;
  manufacturer?: string | null;
  material?: string | null;
  colorName?: string | null;
  spoolTag?: string | null;
  purchaseDate?: Date | null;
  purchasePriceCents?: number | null;
  totalGrams?: number | null;
  remainingGrams?: number | null;
  status?: string | null;
  printerAssetId?: string | null;
  notes?: string | null;
};

export type PrinterOption = { id: string; name: string; kind: string };

export default function SpoolForm({
  action,
  submitLabel,
  defaults = {},
  assets,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  assets: PrinterOption[];
}) {
  // Printers first — that is what a spool gets loaded on. Everything else is
  // still selectable, because a resin vat or a shop machine might be the one.
  const printers = assets.filter((a) => a.kind === "3D printer");
  const others = assets.filter((a) => a.kind !== "3D printer");
  const isNew = !defaults.id;

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="material">
            Material *
          </label>
          <select
            id="material"
            name="material"
            required
            defaultValue={defaults.material ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Choose…
            </option>
            {FILAMENT_MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="colorName">
            Color
          </label>
          <input
            id="colorName"
            name="colorName"
            defaultValue={defaults.colorName ?? ""}
            placeholder="Black"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="manufacturer">
            Brand
          </label>
          <input
            id="manufacturer"
            name="manufacturer"
            defaultValue={defaults.manufacturer ?? ""}
            placeholder="Hatchbox"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="spoolTag">
            Your spool label
          </label>
          <input
            id="spoolTag"
            name="spoolTag"
            defaultValue={defaults.spoolTag ?? ""}
            placeholder="S-14"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="totalGrams">
            Full spool weight (grams) *
          </label>
          <input
            id="totalGrams"
            name="totalGrams"
            inputMode="decimal"
            required
            defaultValue={defaults.totalGrams ?? 1000}
            placeholder="1000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="remainingGrams">
            Grams left
          </label>
          <input
            id="remainingGrams"
            name="remainingGrams"
            inputMode="decimal"
            defaultValue={defaults.remainingGrams ?? ""}
            placeholder={isNew ? "Full spool" : "0"}
            className={inputCls}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-stone-500">
        {isNew
          ? "Leave grams left blank on a brand-new spool — it starts out full."
          : "Grams left cannot be more than the full spool weight."}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="purchaseDate">
            Purchase date
          </label>
          <input
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            defaultValue={defaults.purchaseDate ? toDateInputValue(defaults.purchaseDate) : ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="purchasePrice">
            What it cost
          </label>
          <input
            id="purchasePrice"
            name="purchasePrice"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={
              defaults.purchasePriceCents != null
                ? (defaults.purchasePriceCents / 100).toFixed(2)
                : ""
            }
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={defaults.status ?? "IN_STOCK"}
            className={inputCls}
          >
            {SPOOL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SPOOL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="printerAssetId">
            Printer
          </label>
          <select
            id="printerAssetId"
            name="printerAssetId"
            defaultValue={defaults.printerAssetId ?? ""}
            className={inputCls}
          >
            <option value="">Not assigned</option>
            {printers.length > 0 ? (
              <optgroup label="3D printers">
                {printers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length > 0 ? (
              <optgroup label="Other equipment">
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
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
          placeholder="Prints hot, dry it before use"
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
