"use server";

// Banking — server actions.
//
// SAFETY NOTES that must survive any edit of this file:
//  - Bank data is sensitive: nothing here logs a description or an amount.
//  - Every query is scoped by accountId; ids that aren't this account's are
//    a no-op, never an error page.
//  - The importer NEVER creates, edits or deletes an Expense or an Income.
//    Matching only writes the link onto the BankTransaction row.

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import {
  EMPTY_MAPPING,
  analyzeCsvText,
  fingerprintTransactions,
  looksLikeHeaderRow,
  mappingIsUsable,
  parseCsv,
  rowsToTransactions,
  type ColumnMapping,
} from "@/lib/bank-import";
import { attachExpenseToBankTransaction, attachIncomeToBankTransaction } from "./link-expense";
import type { AnalyzeState } from "./bank-bits";

// Helpers copied verbatim from src/app/assets/actions.ts (house convention).
function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// The whole file rides back to the browser after the mapping preview and
// then comes back with the confirmed mapping, so keep it well inside the
// server-action body limit. ~400 KB is roughly 4,000 transactions.
const MAX_CSV_BYTES = 400_000;
const PREVIEW_ROWS = 5;

// ———————————————————————————————————————————————————————————————————————
// Step 1 — read the file and guess the columns (nothing is saved yet)
// ———————————————————————————————————————————————————————————————————————

// AnalyzeState and EMPTY_ANALYZE_STATE now live in ./bank-bits — they had to
// move, and this is the one edit made to this file:
//
// A "use server" module may only export async FUNCTIONS. `export const
// EMPTY_ANALYZE_STATE = {...}` compiles fine, but Next's action transform
// appends ensureServerEntryExports([...every export...]) to the module, which
// throws at RUNTIME on the first request that loads it:
//   A "use server" file can only export async functions, found object.
// That took the whole /banking route down before it rendered a byte.
//
// The type is re-exported below (a type-only re-export is erased at compile
// time, so it never reaches that check), which keeps
// `import type { AnalyzeState } from "./actions"` working for any caller.
export type { AnalyzeState };

function mappingFromJson(json: string): ColumnMapping | null {
  try {
    const raw = JSON.parse(json) as Partial<Record<keyof ColumnMapping, unknown>>;
    const index = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
    const mapping: ColumnMapping = {
      date: index(raw.date),
      description: index(raw.description),
      amount: index(raw.amount),
      debit: index(raw.debit),
      credit: index(raw.credit),
      balance: index(raw.balance),
      outSign: raw.outSign === "positive" ? "positive" : "negative",
    };
    return mappingIsUsable(mapping) ? mapping : null;
  } catch {
    return null;
  }
}

export async function analyzeUpload(
  _prev: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  const accountId = await requireAccountId();
  const bankName = (str(formData.get("bankName")) ?? "My bank").slice(0, 60);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file arrived. Tap “Choose file” and pick the CSV your bank gave you.", analysis: null };
  }
  if (file.size > MAX_CSV_BYTES) {
    return {
      error:
        "That file is bigger than this importer takes (about 4,000 transactions). Export a shorter date range from your bank — a month or a quarter at a time — and upload that.",
      analysis: null,
    };
  }

  let text = "";
  try {
    text = await file.text();
  } catch {
    return {
      error:
        "Couldn't read that file. If it's stored in iCloud, open it once in the Files app so it downloads to this device, then pick it again.",
      analysis: null,
    };
  }

  const analysis = analyzeCsvText(text);
  if (analysis.dataRows.length === 0) {
    return {
      error:
        "There were no transactions in that file. Make sure you exported it as CSV (not PDF or Excel) and try again.",
      analysis: null,
    };
  }

  // A bank we've imported before keeps its confirmed mapping, so the second
  // statement asks nothing.
  let guess = analysis.guess;
  let usedSavedProfile = false;
  const profile = await prisma.bankImportProfile.findFirst({ where: { accountId, bankName } });
  if (profile) {
    const saved = mappingFromJson(profile.mappingJson);
    if (saved) {
      guess = saved;
      usedSavedProfile = true;
    }
  }

  return {
    error: null,
    analysis: {
      fileName: file.name || "statement.csv",
      bankName,
      header: analysis.header,
      preview: analysis.dataRows.slice(0, PREVIEW_ROWS),
      totalRows: analysis.dataRows.length,
      guess,
      dayFirstWarning: analysis.dayFirstWarning,
      usedSavedProfile,
      csvText: text,
    },
  };
}

// ———————————————————————————————————————————————————————————————————————
// Step 2 — the confirmed mapping actually imports
// ———————————————————————————————————————————————————————————————————————

function mappingFromForm(formData: FormData): ColumnMapping {
  const index = (name: string): number | null => {
    const n = num(formData.get(name));
    return n != null && Number.isInteger(n) && n >= 0 ? n : null;
  };
  const mapping: ColumnMapping = {
    ...EMPTY_MAPPING,
    date: index("date"),
    description: index("description"),
    amount: index("amount"),
    debit: index("debit"),
    credit: index("credit"),
    balance: index("balance"),
    outSign: str(formData.get("outSign")) === "positive" ? "positive" : "negative",
  };
  // The two shapes are exclusive: a single amount column wins over a pair.
  if (mapping.amount != null) {
    mapping.debit = null;
    mapping.credit = null;
  }
  return mapping;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function importTransactions(formData: FormData) {
  const accountId = await requireAccountId();
  const csvText = typeof formData.get("csvText") === "string" ? (formData.get("csvText") as string) : "";
  const bankName = (str(formData.get("bankName")) ?? "My bank").slice(0, 60);
  const mapping = mappingFromForm(formData);

  if (csvText.trim() === "") redirect("/banking?error=nofile");
  if (!mappingIsUsable(mapping)) redirect("/banking?error=mapping");

  const rows = parseCsv(csvText);
  const hasHeader = rows.length > 0 && looksLikeHeaderRow(rows[0]);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const { transactions, skipped } = rowsToTransactions(dataRows, mapping, hasHeader ? 2 : 1);
  if (transactions.length === 0) redirect("/banking?error=norows");

  const fingerprinted = fingerprintTransactions(accountId, transactions);

  // Idempotency: anything already in the books under the same fingerprint is
  // simply not inserted again, so re-uploading an overlapping statement adds
  // zero rows.
  const existing = new Set<string>();
  for (const part of chunk(fingerprinted.map((f) => f.fingerprint), 300)) {
    const found = await prisma.bankTransaction.findMany({
      where: { accountId, fingerprint: { in: part } },
      select: { fingerprint: true },
    });
    for (const f of found) existing.add(f.fingerprint);
  }
  const fresh = fingerprinted.filter((f) => !existing.has(f.fingerprint));

  const importBatchId = randomUUID();
  let added = 0;
  for (const part of chunk(fresh, 200)) {
    const data = part.map((t) => ({
      accountId,
      bankName,
      importBatchId,
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      balanceCents: t.balanceCents,
      fingerprint: t.fingerprint,
      status: "UNMATCHED",
    }));
    try {
      const result = await prisma.bankTransaction.createMany({ data });
      added += result.count;
    } catch {
      // A duplicate slipped in between the check and the insert (double tap).
      // Fall back to one at a time so the rest of the batch still lands.
      for (const row of data) {
        try {
          await prisma.bankTransaction.create({ data: row });
          added++;
        } catch {
          // Already present — that's the guarantee working, not an error.
        }
      }
    }
  }

  // Remember the mapping for next time this bank is chosen.
  try {
    await prisma.bankImportProfile.upsert({
      where: { accountId_bankName: { accountId, bankName } },
      create: { accountId, bankName, mappingJson: JSON.stringify(mapping) },
      update: { mappingJson: JSON.stringify(mapping) },
    });
  } catch {
    // A remembered mapping is a convenience — never fail an import over it.
  }

  const params = new URLSearchParams({
    imported: String(added),
    already: String(fingerprinted.length - fresh.length),
    unreadable: String(skipped.length),
  });
  if (added > 0) params.set("batch", importBatchId);
  redirect(`/banking?${params.toString()}`);
}

// ———————————————————————————————————————————————————————————————————————
// Reviewing — every one of these is reversible
// ———————————————————————————————————————————————————————————————————————

function backTo(formData: FormData, extra: string): string {
  const show = str(formData.get("show"));
  const base = show ? `/banking?show=${encodeURIComponent(show)}&` : "/banking?";
  return `${base}${extra}`;
}

/** "Yes, that's it" — record the link. Nothing about the expense/income row
 *  itself is touched. */
export async function markMatched(formData: FormData) {
  const accountId = await requireAccountId();
  const txnId = str(formData.get("txnId"));
  const expenseId = str(formData.get("expenseId"));
  const incomeId = str(formData.get("incomeId"));
  if (!txnId || (!expenseId && !incomeId)) redirect(backTo(formData, "error=match"));

  const linked = expenseId
    ? await attachExpenseToBankTransaction(accountId, txnId, expenseId)
    : await attachIncomeToBankTransaction(accountId, txnId, incomeId);

  redirect(backTo(formData, linked ? "matched=1" : "error=match"));
}

/** "Ignore / personal" — out of the review list, still on the record. */
export async function markIgnored(formData: FormData) {
  const accountId = await requireAccountId();
  const txnId = str(formData.get("txnId"));
  if (!txnId) redirect(backTo(formData, "error=match"));

  await prisma.bankTransaction.updateMany({
    where: { id: txnId, accountId },
    data: { status: "IGNORED", matchedExpenseId: null, matchedIncomeId: null },
  });
  redirect(backTo(formData, "ignored=1"));
}

/** The undo for both of the above. */
export async function putBackOnList(formData: FormData) {
  const accountId = await requireAccountId();
  const txnId = str(formData.get("txnId"));
  if (!txnId) redirect(backTo(formData, "error=match"));

  await prisma.bankTransaction.updateMany({
    where: { id: txnId, accountId },
    data: { status: "UNMATCHED", matchedExpenseId: null, matchedIncomeId: null },
  });
  redirect(backTo(formData, "undone=1"));
}

// ———————————————————————————————————————————————————————————————————————
// Import history — undo a whole batch
// ———————————————————————————————————————————————————————————————————————

export async function deleteImportBatch(formData: FormData) {
  const accountId = await requireAccountId();
  const batchId = str(formData.get("batchId"));
  // Two-step on purpose: the button asks first, and only the confirmed form
  // carries confirm=yes.
  const confirmed = str(formData.get("confirm")) === "yes";
  if (!batchId) redirect("/banking/imports");
  if (!confirmed) redirect(`/banking/imports?confirm=${encodeURIComponent(batchId)}`);

  const result = await prisma.bankTransaction.deleteMany({
    where: { accountId, importBatchId: batchId },
  });
  redirect(`/banking/imports?removed=${result.count}`);
}
