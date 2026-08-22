"use client";

import { useState } from "react";
import {
  ANIMAL_EVENT_FIELDS,
  ANIMAL_EVENT_KINDS,
  ANIMAL_EVENT_LABELS,
  GESTATION_DAYS,
  PREGNANCY_RESULTS,
  PREGNANCY_RESULT_LABELS,
  type AnimalEventKind,
} from "@/lib/domain";
import { addDaysToDateInput, animalLabel } from "@/lib/livestock";
import { btnPrimaryCls, inputCls, labelCls } from "@/components/ui";

export type MateOption = { id: string; tagNumber: string; name: string | null };

// One question per kind, in the owner's words. The event kinds share a few
// database columns, but a vet visit and a deworming are not the same question.
const PRODUCT_LABELS: Partial<Record<AnimalEventKind, string>> = {
  VACCINATION: "Vaccine given",
  MEDICATION: "Medicine given",
  DEWORMING: "Wormer given",
  VET_VISIT: "Vet or clinic",
};

const DESCRIPTION_HINTS: Partial<Record<AnimalEventKind, string>> = {
  INJURY: "Cut on left front leg — cleaned and sprayed",
  HOOF_TRIM: "All four feet, no rot",
  SHEARING: "Full fleece, about 6 lbs",
  TRANSFER: "Moved to the back pasture",
  DEATH: "Found down in the morning",
  NOTE: "Anything worth remembering",
};

export default function EventForm({
  action,
  animalId,
  rams,
  today,
}: {
  action: (formData: FormData) => Promise<void>;
  animalId: string;
  /** Possible mates for a breeding — this account's rams. */
  rams: MateOption[];
  /** Today as an <input type="date"> value, computed on the server. */
  today: string;
}) {
  const [kind, setKind] = useState<AnimalEventKind | "">("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [dueEdited, setDueEdited] = useState(false);

  const uses = (field: string) =>
    kind !== "" && (ANIMAL_EVENT_FIELDS[kind] as readonly string[]).includes(field);

  // A breeding's due date fills itself in — 147 days is the ewe's clock, not
  // something anyone should have to count on a calendar.
  const suggestedDue = addDaysToDateInput(date, GESTATION_DAYS);
  const dueValue = dueEdited ? dueDate : suggestedDue;

  const productLabel = kind === "" ? "What was given" : (PRODUCT_LABELS[kind] ?? "What was given");
  const detailsHint =
    kind === "" ? "Anything worth remembering" : (DESCRIPTION_HINTS[kind] ?? "Anything worth remembering");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="animalId" value={animalId} />

      <div>
        <label className={labelCls} htmlFor="e-kind">
          What happened? *
        </label>
        <select
          id="e-kind"
          name="kind"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value as AnimalEventKind | "")}
          className={inputCls}
        >
          <option value="" disabled>
            Choose…
          </option>
          {ANIMAL_EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {ANIMAL_EVENT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="e-date">
          When *
        </label>
        <input
          id="e-date"
          name="date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputCls}
        />
      </div>

      {uses("weightLbs") ? (
        <div>
          <label className={labelCls} htmlFor="e-weight">
            Weight (lbs)
          </label>
          <input
            id="e-weight"
            name="weightLbs"
            inputMode="decimal"
            placeholder="145"
            className={inputCls}
          />
        </div>
      ) : null}

      {uses("lambCount") ? (
        <div>
          <label className={labelCls} htmlFor="e-lambs">
            How many lambs?
          </label>
          <input
            id="e-lambs"
            name="lambCount"
            inputMode="numeric"
            placeholder="2"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-stone-500">
            Add each lamb as its own animal when you tag them — set this ewe as the dam.
          </p>
        </div>
      ) : null}

      {uses("mateAnimalId") ? (
        <div>
          <label className={labelCls} htmlFor="e-mate">
            Ram used
          </label>
          <select id="e-mate" name="mateAnimalId" defaultValue="" className={inputCls}>
            <option value="">Unknown</option>
            {rams.map((r) => (
              <option key={r.id} value={r.id}>
                {animalLabel(r)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {uses("dueDate") ? (
        <div>
          <label className={labelCls} htmlFor="e-due">
            Due date
          </label>
          <input
            id="e-due"
            name="dueDate"
            type="date"
            value={dueValue}
            onChange={(e) => {
              setDueEdited(true);
              setDueDate(e.target.value);
            }}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-stone-500">
            Filled in for you — {GESTATION_DAYS} days from the breeding date. Change it if you
            need to.
          </p>
        </div>
      ) : null}

      {uses("result") ? (
        <div>
          <label className={labelCls} htmlFor="e-result">
            Result
          </label>
          <select id="e-result" name="result" defaultValue="" className={inputCls}>
            <option value="" disabled>
              Choose…
            </option>
            {PREGNANCY_RESULTS.map((r) => (
              <option key={r} value={r}>
                {PREGNANCY_RESULT_LABELS[r] ?? r}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {uses("productName") ? (
        <div>
          <label className={labelCls} htmlFor="e-product">
            {productLabel}
          </label>
          <input
            id="e-product"
            name="productName"
            placeholder="Ivermectin"
            className={inputCls}
          />
        </div>
      ) : null}

      {uses("dosage") ? (
        <div>
          <label className={labelCls} htmlFor="e-dosage">
            How much
          </label>
          <input id="e-dosage" name="dosage" placeholder="3 cc, by mouth" className={inputCls} />
        </div>
      ) : null}

      {uses("withdrawalUntil") ? (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
          <label className={labelCls} htmlFor="e-withdrawal">
            Do not sell for meat until
          </label>
          <input id="e-withdrawal" name="withdrawalUntil" type="date" className={inputCls} />
          <p className="mt-1 text-sm text-amber-900">
            The withdrawal date is on the product label. Type it here and this animal shows a
            warning until that day passes.
          </p>
        </div>
      ) : null}

      {uses("costCents") ? (
        <div>
          <label className={labelCls} htmlFor="e-cost">
            What it cost
          </label>
          <input
            id="e-cost"
            name="cost"
            inputMode="decimal"
            placeholder="$0.00"
            className={inputCls}
          />
        </div>
      ) : null}

      {kind === "DEATH" ? (
        <p className="rounded-xl border border-stone-300 bg-stone-50 p-3 text-sm text-stone-700">
          Adding this takes the animal out of the flock — its record stays here for your history.
        </p>
      ) : null}

      <div>
        <label className={labelCls} htmlFor="e-description">
          Details
        </label>
        <input
          id="e-description"
          name="description"
          placeholder={detailsHint}
          className={inputCls}
        />
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        Add to the record
      </button>
    </form>
  );
}
