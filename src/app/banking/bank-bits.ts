// Small helpers shared by the banking pages and the (client) import wizard.
// Deliberately dependency-free — no Prisma, no node: imports — so the client
// bundle can pull it in. Page files export only Next-recognized fields, so
// anything shared lives here (house rule).

import type { ColumnMapping } from "@/lib/bank-import";

/** The mapping fields the operator can set, in the order they're shown. */
export const MAPPING_FIELDS = [
  { key: "date", label: "Date", hint: "The day the money moved", required: true },
  { key: "description", label: "Description", hint: "Who it was paid to / from", required: false },
  { key: "amount", label: "Amount (one column)", hint: "Use this if there is a single amount column", required: false },
  { key: "debit", label: "Money out (debit)", hint: "Only if the bank splits out and in", required: false },
  { key: "credit", label: "Money in (credit)", hint: "Only if the bank splits out and in", required: false },
  { key: "balance", label: "Balance", hint: "Optional — just stored", required: false },
] as const;

export type MappingFieldKey = (typeof MAPPING_FIELDS)[number]["key"];

/** Money out is red, money in is green — the whole point of the review list
 *  is telling those apart at a glance. */
export function amountToneCls(cents: number): string {
  return cents < 0 ? "text-red-700" : "text-oak-700";
}

export function amountWithSign(cents: number, formatted: string): string {
  return cents > 0 ? `+${formatted}` : formatted;
}

export function moneyDirectionLabel(cents: number): string {
  return cents < 0 ? "Money out" : "Money in";
}

export function bankStatusTone(status: string): string {
  switch (status) {
    case "MATCHED":
      return "green";
    case "IGNORED":
      return "stone";
    default:
      return "amber";
  }
}

/** A mapping as it travels through a form: plain strings, "" = not set. */
export type MappingFormValues = Record<MappingFieldKey, string> & { outSign: string };

export function mappingToFormValues(m: ColumnMapping): MappingFormValues {
  const cell = (v: number | null) => (v == null ? "" : String(v));
  return {
    date: cell(m.date),
    description: cell(m.description),
    amount: cell(m.amount),
    debit: cell(m.debit),
    credit: cell(m.credit),
    balance: cell(m.balance),
    outSign: m.outSign,
  };
}

/** Short plain-English summary of a saved mapping, for the history screen. */
export function describeMapping(m: ColumnMapping, header: string[] | null): string {
  const name = (i: number | null) =>
    i == null ? null : (header?.[i]?.trim() || `column ${i + 1}`);
  const parts = [
    name(m.date) ? `date from ${name(m.date)}` : null,
    name(m.description) ? `description from ${name(m.description)}` : null,
    m.amount != null
      ? `amount from ${name(m.amount)}`
      : [name(m.debit) && `money out from ${name(m.debit)}`, name(m.credit) && `money in from ${name(m.credit)}`]
          .filter(Boolean)
          .join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
}

// ———————————————————————————————————————————————————————————————————————
// The upload wizard's state
// ———————————————————————————————————————————————————————————————————————
//
// This lives here, not in actions.ts, for a hard technical reason: a
// "use server" module may only export async FUNCTIONS. A plain `export const`
// compiles, but Next appends ensureServerEntryExports() to the module and the
// route throws on the first request — `A "use server" file can only export
// async functions, found object.` This module has no "use server" and no
// server-only imports, so both the server action and the client wizard can
// share one definition. actions.ts re-exports the TYPE (erased at compile
// time), so `import type { AnalyzeState } from "./actions"` still works.

/** What analyzeUpload() hands back to the upload wizard: either a plain
 *  English reason it couldn't read the file, or everything the mapping
 *  confirmation step needs. Never both. */
export type AnalyzeState = {
  error: string | null;
  analysis: {
    fileName: string;
    bankName: string;
    header: string[];
    preview: string[][];
    totalRows: number;
    guess: ColumnMapping;
    dayFirstWarning: boolean;
    usedSavedProfile: boolean;
    csvText: string;
  } | null;
};

/** Nothing uploaded yet — the useActionState seed. */
export const EMPTY_ANALYZE_STATE: AnalyzeState = { error: null, analysis: null };
