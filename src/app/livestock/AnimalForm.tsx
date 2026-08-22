import {
  ANIMAL_SEXES,
  ANIMAL_SEX_LABELS,
  ANIMAL_SPECIES,
  ANIMAL_STATUSES,
  ANIMAL_STATUS_LABELS,
  BIRTH_TYPES,
  BIRTH_TYPE_LABELS,
  type AnimalSex,
  type AnimalStatus,
  type BirthType,
} from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { animalLabel } from "@/lib/livestock";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

export type ParentOption = { id: string; tagNumber: string; name: string | null };

type Defaults = {
  id?: string;
  tagNumber?: string | null;
  name?: string | null;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  birthDate?: Date | null;
  birthType?: string | null;
  sireId?: string | null;
  damId?: string | null;
  status?: string | null;
  acquisitionDate?: Date | null;
  acquisitionCostCents?: number | null;
  currentWeightLbs?: number | null;
  notes?: string | null;
};

export default function AnimalForm({
  action,
  submitLabel,
  defaults = {},
  rams,
  ewes,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: Defaults;
  /** Possible sires — this account's rams. */
  rams: ParentOption[];
  /** Possible dams — this account's ewes. */
  ewes: ParentOption[];
}) {
  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="tagNumber">
            Tag # *
          </label>
          <input
            id="tagNumber"
            name="tagNumber"
            required
            defaultValue={defaults.tagNumber ?? ""}
            placeholder="114"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            defaultValue={defaults.name ?? ""}
            placeholder="Bella"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="sex">
            Ewe, ram, or wether? *
          </label>
          <select
            id="sex"
            name="sex"
            required
            defaultValue={defaults.sex ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Choose…
            </option>
            {ANIMAL_SEXES.map((s) => (
              <option key={s} value={s}>
                {ANIMAL_SEX_LABELS[s as AnimalSex]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="status">
            Where is it now?
          </label>
          <select
            id="status"
            name="status"
            defaultValue={defaults.status ?? "ACTIVE"}
            className={inputCls}
          >
            {ANIMAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ANIMAL_STATUS_LABELS[s as AnimalStatus]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="breed">
            Breed
          </label>
          <input
            id="breed"
            name="breed"
            defaultValue={defaults.breed ?? ""}
            placeholder="Katahdin"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="species">
            Kind of animal
          </label>
          <select
            id="species"
            name="species"
            defaultValue={defaults.species ?? "Sheep"}
            className={inputCls}
          >
            {ANIMAL_SPECIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="birthDate">
            Born
          </label>
          <input
            id="birthDate"
            name="birthDate"
            type="date"
            defaultValue={defaults.birthDate ? toDateInputValue(defaults.birthDate) : ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="birthType">
            Born as
          </label>
          <select
            id="birthType"
            name="birthType"
            defaultValue={defaults.birthType ?? ""}
            className={inputCls}
          >
            <option value="">—</option>
            {BIRTH_TYPES.map((b) => (
              <option key={b} value={b}>
                {BIRTH_TYPE_LABELS[b as BirthType]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="sireId">
            Sire (father)
          </label>
          <select
            id="sireId"
            name="sireId"
            defaultValue={defaults.sireId ?? ""}
            className={inputCls}
          >
            <option value="">Unknown</option>
            {rams.map((r) => (
              <option key={r.id} value={r.id}>
                {animalLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="damId">
            Dam (mother)
          </label>
          <select id="damId" name="damId" defaultValue={defaults.damId ?? ""} className={inputCls}>
            <option value="">Unknown</option>
            {ewes.map((e) => (
              <option key={e.id} value={e.id}>
                {animalLabel(e)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="acquisitionDate">
            Bought on
          </label>
          <input
            id="acquisitionDate"
            name="acquisitionDate"
            type="date"
            defaultValue={
              defaults.acquisitionDate ? toDateInputValue(defaults.acquisitionDate) : ""
            }
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="acquisitionCost">
            What you paid
          </label>
          <input
            id="acquisitionCost"
            name="acquisitionCost"
            inputMode="decimal"
            placeholder="$0.00"
            defaultValue={
              defaults.acquisitionCostCents != null
                ? (defaults.acquisitionCostCents / 100).toFixed(2)
                : ""
            }
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="currentWeightLbs">
          Current weight (lbs)
        </label>
        <input
          id="currentWeightLbs"
          name="currentWeightLbs"
          inputMode="decimal"
          defaultValue={defaults.currentWeightLbs ?? ""}
          placeholder="145"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-stone-500">
          Logging a weigh-in on the animal&apos;s page keeps this up to date for you.
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
          placeholder="Good mother, easy keeper"
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        {submitLabel}
      </button>
    </form>
  );
}
