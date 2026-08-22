import Link from "next/link";
import {
  DEFAULT_LABOR_RATE_CENTS_PER_HOUR,
  DEFAULT_MACHINE_RATE_CENTS_PER_HOUR,
  PRINT_JOB_STATUSES,
  PRINT_JOB_STATUS_LABELS,
} from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { centsToDollarsInput, hoursPartOf, minutesPartOf, rateToDollars } from "./job-bits";

export type CustomerOption = { id: string; name: string; company: string | null };
export type AssetOption = { id: string; name: string; kind: string };
export type InvoiceOption = { id: string; number: string; customerName: string };

type Defaults = {
  id?: string;
  jobNumber?: string | null;
  partName?: string | null;
  partNumber?: string | null;
  description?: string | null;
  customerId?: string | null;
  printerAssetId?: string | null;
  invoiceId?: string | null;
  quantity?: number | null;
  failedCount?: number | null;
  printMinutes?: number | null;
  laborMinutes?: number | null;
  machineRateCentsPerHour?: number | null;
  laborRateCentsPerHour?: number | null;
  packagingCostCents?: number | null;
  shippingCostCents?: number | null;
  otherCostCents?: number | null;
  salePriceCents?: number | null;
  status?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  notes?: string | null;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-1 text-base font-semibold text-stone-900">{children}</h2>;
}

export default function PrintJobForm({
  action,
  submitLabel,
  defaults = {},
  customers,
  assets,
  invoices,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  customers: CustomerOption[];
  assets: AssetOption[];
  invoices: InvoiceOption[];
}) {
  // Printers first so the usual answer is at the top, but every active
  // machine stays reachable — nothing is hidden behind the "3D printer" kind.
  const printers = assets.filter((a) => a.kind === "3D printer");
  const otherAssets = assets.filter((a) => a.kind !== "3D printer");

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {defaults.jobNumber ? (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">
          Job number <span className="font-semibold text-stone-900">{defaults.jobNumber}</span> —
          set automatically, never changes.
        </p>
      ) : (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">
          The job number is filled in for you when you save.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="partName">
            Part name *
          </label>
          <input
            id="partName"
            name="partName"
            required
            defaultValue={defaults.partName ?? ""}
            placeholder="Gate latch bracket"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="partNumber">
            Part number
          </label>
          <input
            id="partNumber"
            name="partNumber"
            defaultValue={defaults.partNumber ?? ""}
            placeholder="TO-P-014"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="description">
          What is it?
        </label>
        <input
          id="description"
          name="description"
          defaultValue={defaults.description ?? ""}
          placeholder="PETG, 40% infill, black"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="customerId">
          Customer
        </label>
        <select
          id="customerId"
          name="customerId"
          defaultValue={defaults.customerId ?? ""}
          className={inputCls}
        >
          <option value="">Nobody yet — printing for stock</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.company ? ` — ${c.company}` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Someone new?{" "}
          <Link href="/customers/new" className="font-medium text-oak-700">
            Add a customer
          </Link>
        </p>
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
          <option value="">Not recorded</option>
          {printers.length > 0 ? (
            <optgroup label="Printers">
              {printers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {otherAssets.length > 0 ? (
            <optgroup label="Other equipment">
              {otherAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Printers are equipment records.{" "}
          <Link href="/assets/new" className="font-medium text-oak-700">
            Add a printer
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="quantity">
            How many good parts?
          </label>
          <input
            id="quantity"
            name="quantity"
            inputMode="numeric"
            defaultValue={defaults.quantity ?? 1}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="failedCount">
            How many failed?
          </label>
          <input
            id="failedCount"
            name="failedCount"
            inputMode="numeric"
            defaultValue={defaults.failedCount ?? 0}
            className={inputCls}
          />
        </div>
      </div>

      <SectionTitle>Time on the job</SectionTitle>

      <div>
        <span className={labelCls}>Printer time</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <input
              id="printHours"
              name="printHours"
              inputMode="numeric"
              placeholder="0"
              defaultValue={hoursPartOf(defaults.printMinutes)}
              className={inputCls}
              aria-label="Printer time, hours"
            />
            <span className="text-sm text-stone-500">hrs</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="printMins"
              name="printMins"
              inputMode="numeric"
              placeholder="0"
              defaultValue={minutesPartOf(defaults.printMinutes)}
              className={inputCls}
              aria-label="Printer time, minutes"
            />
            <span className="text-sm text-stone-500">min</span>
          </div>
        </div>
      </div>

      <div>
        <span className={labelCls}>Your hands-on time</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <input
              id="laborHours"
              name="laborHours"
              inputMode="numeric"
              placeholder="0"
              defaultValue={hoursPartOf(defaults.laborMinutes)}
              className={inputCls}
              aria-label="Your time, hours"
            />
            <span className="text-sm text-stone-500">hrs</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="laborMins"
              name="laborMins"
              inputMode="numeric"
              placeholder="0"
              defaultValue={minutesPartOf(defaults.laborMinutes)}
              className={inputCls}
              aria-label="Your time, minutes"
            />
            <span className="text-sm text-stone-500">min</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Modeling, plate prep, supports, sanding, packing — your time is part of the cost.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="machineRate">
            Printer cost per hour
          </label>
          <input
            id="machineRate"
            name="machineRate"
            inputMode="decimal"
            defaultValue={rateToDollars(
              defaults.machineRateCentsPerHour,
              DEFAULT_MACHINE_RATE_CENTS_PER_HOUR,
            )}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="laborRate">
            Your rate per hour
          </label>
          <input
            id="laborRate"
            name="laborRate"
            inputMode="decimal"
            defaultValue={rateToDollars(
              defaults.laborRateCentsPerHour,
              DEFAULT_LABOR_RATE_CENTS_PER_HOUR,
            )}
            className={inputCls}
          />
        </div>
      </div>

      <SectionTitle>Money</SectionTitle>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls} htmlFor="packagingCost">
            Packaging
          </label>
          <input
            id="packagingCost"
            name="packagingCost"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={centsToDollarsInput(defaults.packagingCostCents)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="shippingCost">
            Shipping
          </label>
          <input
            id="shippingCost"
            name="shippingCost"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={centsToDollarsInput(defaults.shippingCostCents)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="otherCost">
            Other
          </label>
          <input
            id="otherCost"
            name="otherCost"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={centsToDollarsInput(defaults.otherCostCents)}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="salePrice">
          What are you charging for the whole job?
        </label>
        <input
          id="salePrice"
          name="salePrice"
          inputMode="decimal"
          placeholder="$0.00"
          defaultValue={centsToDollarsInput(defaults.salePriceCents)}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-stone-500">
          Leave blank until you know — profit stays blank too, never a wrong number.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="invoiceId">
          Invoice this job is on
        </label>
        <select
          id="invoiceId"
          name="invoiceId"
          defaultValue={defaults.invoiceId ?? ""}
          className={inputCls}
        >
          <option value="">Not invoiced yet</option>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.number} — {i.customerName}
            </option>
          ))}
        </select>
      </div>

      <SectionTitle>Where it stands</SectionTitle>

      <div>
        <label className={labelCls} htmlFor="status">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={defaults.status ?? "QUEUED"}
          className={inputCls}
        >
          {PRINT_JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRINT_JOB_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="startedAt">
            Started
          </label>
          <input
            id="startedAt"
            name="startedAt"
            type="date"
            defaultValue={defaults.startedAt ? toDateInputValue(defaults.startedAt) : ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="completedAt">
            Finished
          </label>
          <input
            id="completedAt"
            name="completedAt"
            type="date"
            defaultValue={defaults.completedAt ? toDateInputValue(defaults.completedAt) : ""}
            className={inputCls}
          />
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
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
