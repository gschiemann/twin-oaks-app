"use client";

// The two-step upload wizard.
//
// Step 1 posts the file to analyzeUpload() through useActionState — the file
// is READ and GUESSED AT, and nothing is written. Step 2 posts the confirmed
// column mapping (plus the file's text, carried back in a hidden field) to
// importTransactions(), which is the first moment anything is saved.
//
// It is a client component for exactly one reason: analyzeUpload returns the
// guess, and the guess has to be shown before it is used. Everything else on
// /banking is a plain server-rendered form.

import { useActionState, useState } from "react";
import SolidFileInput from "@/components/SolidFileInput";
import {
  Card,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { analyzeUpload, importTransactions } from "./actions";
import {
  EMPTY_ANALYZE_STATE,
  MAPPING_FIELDS,
  mappingToFormValues,
  type AnalyzeState,
} from "./bank-bits";

const fileInputCls =
  "w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-oak-700 file:px-4 file:py-2 file:font-semibold file:text-white";

type Analysis = NonNullable<AnalyzeState["analysis"]>;

export default function ImportPanel({
  hasTransactions,
  defaultBankName,
}: {
  /** Anything imported already? If so this panel starts folded away so the
   *  review list is the first thing on the screen. */
  hasTransactions: boolean;
  /** The bank he used last time, so the second statement needs no typing. */
  defaultBankName: string;
}) {
  const [state, formAction, pending] = useActionState(analyzeUpload, EMPTY_ANALYZE_STATE);
  const [open, setOpen] = useState(!hasTransactions);
  // "Start over" can't clear useActionState, so the last analysis is hidden
  // instead — and un-hidden the moment another file is sent.
  const [dismissed, setDismissed] = useState(false);
  const analysis = dismissed ? null : state.analysis;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btnSecondaryCls} mb-4 w-full`}>
        Upload another bank file
      </button>
    );
  }

  return (
    <Card className="mb-4">
      {analysis ? (
        <MappingStep
          key={`${analysis.fileName}-${analysis.totalRows}`}
          analysis={analysis}
          onStartOver={() => setDismissed(true)}
        />
      ) : (
        <form action={formAction} className="space-y-3">
          <h2 className="font-semibold text-stone-900">Upload the file from your bank</h2>
          <p className="text-sm text-stone-600">
            Sign in to your bank, export your transactions as a <strong>CSV</strong> file, and pick
            it below. Nothing is added to your books by uploading — you&apos;ll see the columns and
            a few sample rows first, and you get the last word on every single line.
          </p>

          {state.error ? (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">That file didn&apos;t work.</p>
              <p className="mt-1 text-sm text-red-800">{state.error}</p>
            </div>
          ) : null}

          <div>
            <label className={labelCls} htmlFor="bankName">
              Which bank is this from?
            </label>
            <input
              id="bankName"
              name="bankName"
              defaultValue={defaultBankName}
              placeholder="My bank"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-stone-500">
              Just a label so you can tell your accounts apart. Once you set the columns for a bank,
              it remembers them next time.
            </p>
          </div>

          <div>
            <label className={labelCls} htmlFor="file">
              The CSV file
            </label>
            {/* No `capture`: the file lives in Files/iCloud, not the camera. */}
            <SolidFileInput
              id="file"
              name="file"
              accept=".csv,.txt,text/csv,text/comma-separated-values,text/plain"
              required
              className={fileInputCls}
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            onClick={() => setDismissed(false)}
            className={`${btnPrimaryCls} w-full disabled:opacity-60`}
          >
            {pending ? "Reading the file…" : "Read the file"}
          </button>
        </form>
      )}
    </Card>
  );
}

// ———————————————————————————————————————————————————————————————————————
// Step 2 — confirm the columns. Remounted per analysis (see the key above)
// so the selects start from the newest guess.
// ———————————————————————————————————————————————————————————————————————

function MappingStep({
  analysis,
  onStartOver,
}: {
  analysis: Analysis;
  onStartOver: () => void;
}) {
  const values = mappingToFormValues(analysis.guess);
  // Only tracked field: whether there is ONE amount column, because the
  // "how does this file write money going out" question only applies then.
  const [amountCol, setAmountCol] = useState(values.amount);
  const columns = analysis.header.map((name, index) => ({ name, index }));

  return (
    <form action={importTransactions} className="space-y-4">
      <input type="hidden" name="csvText" value={analysis.csvText} />

      <div>
        <h2 className="font-semibold text-stone-900">Check the columns before importing</h2>
        <p className="mt-1 text-sm text-stone-600">
          <strong>{analysis.fileName}</strong> — {analysis.totalRows}{" "}
          {analysis.totalRows === 1 ? "row" : "rows"}. Below is what each column looks like to the
          app. If it&apos;s right, import it. Still nothing is saved until you tap the button at the
          bottom.
        </p>
      </div>

      {analysis.usedSavedProfile ? (
        <p className="rounded-xl bg-oak-50 p-3 text-sm text-oak-900">
          You&apos;ve imported from {analysis.bankName} before — the columns are already set the way
          you confirmed last time.
        </p>
      ) : null}

      {analysis.dayFirstWarning ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Heads up: this file writes dates day-first, like 25/12/2026. Those read correctly, but a
          date such as 05/06/2026 will be read as <strong>June 5th</strong>. Check the sample rows
          below before you import.
        </p>
      ) : null}

      <div>
        <label className={labelCls} htmlFor="confirm-bankName">
          Bank
        </label>
        <input
          id="confirm-bankName"
          name="bankName"
          defaultValue={analysis.bankName}
          className={inputCls}
        />
      </div>

      <div className="space-y-3">
        {MAPPING_FIELDS.map((field) => (
          <div key={field.key}>
            <label className={labelCls} htmlFor={`map-${field.key}`}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <select
              id={`map-${field.key}`}
              name={field.key}
              className={inputCls}
              defaultValue={field.key === "amount" ? undefined : values[field.key]}
              value={field.key === "amount" ? amountCol : undefined}
              onChange={field.key === "amount" ? (e) => setAmountCol(e.target.value) : undefined}
            >
              <option value="">— not in this file —</option>
              {columns.map((c) => (
                <option key={c.index} value={c.index}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">{field.hint}</p>
          </div>
        ))}
      </div>

      {amountCol !== "" ? (
        <div>
          <label className={labelCls} htmlFor="outSign">
            How does this file write money going OUT?
          </label>
          <select id="outSign" name="outSign" className={inputCls} defaultValue={values.outSign}>
            <option value="negative">With a minus sign, like -42.50 (most bank accounts)</option>
            <option value="positive">
              As a plain positive number, like 42.50 (most credit-card statements)
            </option>
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Get this wrong and money out will show up as money in — the sample rows below use your
            answer, so check one you recognise.
          </p>
        </div>
      ) : (
        <input type="hidden" name="outSign" value={values.outSign} />
      )}

      <div>
        <p className={labelCls}>The first few rows in your file</p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.index}
                    className="whitespace-nowrap border-b border-stone-200 px-2 py-1.5 font-semibold text-stone-700"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.preview.map((row, r) => (
                <tr key={r}>
                  {columns.map((c) => (
                    <td
                      key={c.index}
                      className="max-w-[14rem] truncate border-b border-stone-100 px-2 py-1.5 text-stone-600"
                    >
                      {row[c.index] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button type="submit" className={`${btnPrimaryCls} w-full`}>
        Import these {analysis.totalRows} {analysis.totalRows === 1 ? "row" : "rows"}
      </button>
      <button type="button" onClick={onStartOver} className={`${btnSecondaryCls} w-full`}>
        Pick a different file
      </button>
      <p className="text-center text-xs text-stone-500">
        Importing only puts these lines on a review list. It does not create a single expense or
        income — that stays your call, one line at a time.
      </p>
    </form>
  );
}
