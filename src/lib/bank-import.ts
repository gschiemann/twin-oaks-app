// Bank CSV import — pure functions, no React, no Prisma, no I/O.
//
// The owner exports a CSV from whatever bank or credit card he happens to
// use, and there is no sample file to build against. So everything here is
// format-TOLERANT: sniff the delimiter, guess the columns by header name AND
// by the shape of the values, and refuse (return null) rather than guess a
// date wrong. Nothing in this file talks to the database or writes anything —
// the caller decides what to do with what it parses.
//
// Money is integer cents everywhere (see src/lib/money.ts). Bank sign
// convention: NEGATIVE = money out, POSITIVE = money in, always as the bank
// stated it (matching the BankTransaction.amountCents comment in the schema).

import { createHash } from "node:crypto";

// ———————————————————————————————————————————————————————————————————————
// Delimiters + CSV parsing
// ———————————————————————————————————————————————————————————————————————

export const SUPPORTED_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof SUPPORTED_DELIMITERS)[number];

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ",": "commas",
  ";": "semicolons",
  "\t": "tabs",
};

/** Strip a UTF-8 byte-order mark — Excel puts one on every CSV it saves, and
 *  it silently poisons the first header name ("﻿Date" !== "Date"). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Which character separates the fields: comma, semicolon (common on
 * European exports) or tab. Counts separators OUTSIDE quotes on the first
 * few non-empty lines and picks the one that appears consistently on every
 * line — a description containing "Smith, John" must not win the vote.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text).split(/\r\n|\r|\n/).filter((l) => l.trim() !== "").slice(0, 20);
  if (sample.length === 0) return ",";

  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const d of SUPPORTED_DELIMITERS) {
    const counts = sample.map((line) => countOutsideQuotes(line, d));
    const min = Math.min(...counts);
    const total = counts.reduce((s, n) => s + n, 0);
    // A delimiter that appears on EVERY line is worth far more than one that
    // appears many times on one line (that one is inside a description).
    const score = min * 1000 + total;
    if (min > 0 && score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++; // escaped ""
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

/**
 * RFC-4180-ish reader: quoted fields may contain the delimiter, newlines and
 * escaped quotes (""); rows may end CRLF, CR or LF. Completely blank lines
 * are dropped. (src/lib/csv.ts only BUILDS csv — this is the other half.)
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = stripBom(text);
  const sep = delimiter ?? sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      endField();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();

  return rows.map((r) => r.map((c) => c.trim()));
}

// ———————————————————————————————————————————————————————————————————————
// Amounts
// ———————————————————————————————————————————————————————————————————————

/**
 * "$1,234.56" → 123456 · "(45.00)" → -4500 · "45.00-" → -4500 ·
 * "-12" → -1200 · "45,00" (European) → 4500 · "" → null.
 *
 * Separator rule, so no bank format is guessed at:
 *  - both "." and "," present → the RIGHTMOST one is the decimal point.
 *  - only "," → "1,234" / "12,345,678" (3-digit groups) is grouping;
 *    otherwise a trailing ",dd" is a decimal comma.
 *  - only "." → two or more dots is grouping ("1.234.567"); a single dot is
 *    a decimal point (the overwhelmingly common case).
 */
export function parseAmountToCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true; // accounting parentheses
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = true; // trailing minus (some core-banking exports)
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Currency symbols, codes, spaces (incl. non-breaking), stray quotes.
  s = s.replace(/[$€£¥₹]/g, "").replace(/\b(usd|eur|gbp|cad|aud)\b/gi, "");
  s = s.replace(/[\s '"]/g, "");
  if (s === "") return null;
  // A second minus can survive inside e.g. "USD -12.00".
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    s = s.split(groupSep).join("");
    if (decimalSep === ",") s = s.replace(",", ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.split(",").join("");
    else if (/,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else s = s.split(",").join("");
  } else if (hasDot) {
    if ((s.match(/\./g) ?? []).length >= 2) s = s.split(".").join("");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

// ———————————————————————————————————————————————————————————————————————
// Dates
// ———————————————————————————————————————————————————————————————————————

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Local NOON, like parseDateInput in src/lib/dates.ts, so a calendar day
 *  never shifts across timezones. Returns null if the day isn't real. */
function makeDate(y: number, m: number, d: number): Date | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  // Rejects Feb 30 and friends — JS would roll them into March.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  // Two-digit years: 00–68 → 2000s, 69–99 → 1900s (the POSIX convention).
  return n <= 68 ? 2000 + n : 1900 + n;
}

/**
 * Handles YYYY-MM-DD, MM/DD/YYYY, M/D/YY, YYYYMMDD, "Aug 12, 2026",
 * "12 Aug 2026" — and DD/MM/YYYY **only when it cannot be anything else**
 * (first number > 12). A slash date where both numbers could be a month is
 * read as US MM/DD; anything genuinely undecidable (13/14/2026) returns
 * null instead of guessing, because a wrong date silently mis-matches a
 * transaction.
 */
export function parseBankDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^["']|["']$/g, "");
  if (s === "") return null;

  // ISO first — unambiguous, and covers "2026-08-12T00:00:00Z" too.
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 12 Aug 2026 / Aug 12, 2026 / August 12 2026
  const nameFirst = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/);
  if (nameFirst) {
    const m = MONTH_NAMES[nameFirst[1].toLowerCase()];
    if (!m) return null;
    return makeDate(expandYear(nameFirst[3]), m, Number(nameFirst[2]));
  }
  const dayFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s-]+(\d{2,4})$/);
  if (dayFirst) {
    const m = MONTH_NAMES[dayFirst[2].toLowerCase()];
    if (!m) return null;
    return makeDate(expandYear(dayFirst[3]), m, Number(dayFirst[1]));
  }

  // 8 solid digits: YYYYMMDD.
  const packed = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed) return makeDate(Number(packed[1]), Number(packed[2]), Number(packed[3]));

  const slash = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = expandYear(slash[3]);
    if (a > 12 && b <= 12) return makeDate(year, b, a); // must be DD/MM
    if (a <= 12 && b > 12) return makeDate(year, a, b); // must be MM/DD
    if (a <= 12 && b <= 12) return makeDate(year, a, b); // ambiguous → US MM/DD
    return null; // 13/14/2026 — refuse to guess
  }

  return null;
}

/** True when the whole column of samples only makes sense as DD/MM (some
 *  value has a first number above 12). Lets the UI warn instead of quietly
 *  importing a US reading of a European file. */
export function columnLooksDayFirst(values: string[]): boolean {
  return values.some((v) => /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.test(v.trim()) &&
    Number(v.trim().split(/[/\-.]/)[0]) > 12);
}

// ———————————————————————————————————————————————————————————————————————
// Descriptions
// ———————————————————————————————————————————————————————————————————————

/** Upper-case, whitespace-collapsed form used for fingerprints and matching
 *  so trivial spacing differences between two exports don't look different. */
export function normalizeDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

// Noise every card processor sprays into a description. Dropping it makes
// the word-overlap part of the match score mean something.
const NOISE_TOKENS = new Set([
  "POS", "DEBIT", "CREDIT", "CARD", "PURCHASE", "AUTHORIZED", "AUTH", "ON",
  "THE", "AND", "FOR", "WWW", "COM", "LLC", "INC", "CO", "USA", "US", "ACH",
  "WEB", "ID", "REF", "TRANSACTION", "TRANS", "XXXXX", "RECURRING", "ONLINE",
  "PAYMENT", "PMNT", "PMT", "WITHDRAWAL", "DEPOSIT", "CHECKCARD", "VISA",
  "MASTERCARD", "AMEX", "STORE", "SALE",
]);

/** Meaningful words in a description, for the overlap part of scoreMatch. */
export function descriptionTokens(raw: string): Set<string> {
  const out = new Set<string>();
  for (const token of normalizeDescription(raw).split(/[^A-Z0-9&]+/)) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue; // store numbers, card tails, dates
    if (NOISE_TOKENS.has(token)) continue;
    out.add(token);
  }
  return out;
}

/** Best-effort vendor name to pre-fill the expense form with — the operator
 *  always sees it in an editable field before anything is saved. */
export function vendorGuessFromDescription(raw: string): string {
  let s = normalizeDescription(raw);
  s = s.replace(/^(POS|CHECKCARD|DEBIT CARD|CREDIT CARD|VISA|MASTERCARD)\s+/g, "");
  s = s.replace(/^PURCHASE AUTHORIZED ON \d{1,2}\/\d{1,2}\s*/g, "");
  s = s.replace(/^(SQ|TST|SP|PY|PAYPAL|DD|EB)\s*\*+\s*/g, "");
  s = s.replace(/\s+#?\d{3,}.*$/g, ""); // store number and everything after
  s = s.replace(/\s+[A-Z]{2}$/g, ""); // trailing state code
  s = s.replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
  if (s === "") s = normalizeDescription(raw);
  // Title Case — "TRACTOR SUPPLY" shouting on a form looks like a bug.
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 60);
}

// ———————————————————————————————————————————————————————————————————————
// Column mapping
// ———————————————————————————————————————————————————————————————————————

/**
 * Which column holds what. Two shapes are supported, because banks disagree:
 *  - ONE signed amount column (`amount`), or
 *  - a DEBIT / CREDIT pair (money out in one column, money in in the other).
 * `outSign` only applies to the single-column shape: "negative" means the
 * file already writes money out as -12.34; "positive" means it writes
 * charges as 12.34 and we flip them (the usual credit-card statement).
 */
export type ColumnMapping = {
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  outSign: "negative" | "positive";
};

export const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  description: null,
  amount: null,
  debit: null,
  credit: null,
  balance: null,
  outSign: "negative",
};

/** A mapping can produce transactions if it has a date and either a single
 *  amount column or at least one side of a debit/credit pair. */
export function mappingIsUsable(m: ColumnMapping): boolean {
  return m.date != null && (m.amount != null || m.debit != null || m.credit != null);
}

const HEADER_PATTERNS: { role: keyof Omit<ColumnMapping, "outSign">; re: RegExp; score: number }[] = [
  { role: "date", re: /^(transaction|posting|posted|effective|value|booking)?\s*date$/i, score: 60 },
  { role: "date", re: /date/i, score: 40 },
  { role: "description", re: /^(description|memo|payee|merchant|narrative|details?|name)$/i, score: 60 },
  { role: "description", re: /(descri|memo|payee|merchant|narrative|detail|reference|name)/i, score: 40 },
  { role: "amount", re: /^amount$/i, score: 60 },
  { role: "amount", re: /^(transaction\s*)?(amount|amt|value)$/i, score: 55 },
  { role: "amount", re: /(amount|amt)/i, score: 30 },
  { role: "debit", re: /^(debit|withdrawal|withdrawals|money\s*out|paid\s*out|charges?|spent)$/i, score: 65 },
  { role: "debit", re: /(debit|withdraw|money\s*out|paid\s*out)/i, score: 45 },
  { role: "credit", re: /^(credit|deposit|deposits|money\s*in|paid\s*in|received)$/i, score: 65 },
  { role: "credit", re: /(credit|deposit|money\s*in|paid\s*in)/i, score: 45 },
  { role: "balance", re: /balance/i, score: 60 },
];

function columnValues(rows: string[][], index: number): string[] {
  return rows.map((r) => (r[index] ?? "").trim()).filter((v) => v !== "");
}

/**
 * Best guess at the mapping, from the header names AND the shape of the
 * values underneath them (a column of parseable dates is a date column even
 * if it's called "Posted"). Every guess is shown to the operator with a
 * preview before a single row is imported — this only saves him typing.
 */
export function guessColumns(headerRow: string[], sampleRows: string[][]): ColumnMapping {
  const width = Math.max(headerRow.length, ...sampleRows.map((r) => r.length), 0);
  const ROLES = ["date", "description", "amount", "debit", "credit", "balance"] as const;
  const zeros = () => Object.fromEntries(ROLES.map((r) => [r, new Array<number>(width).fill(0)]));
  const scores = zeros() as Record<string, number[]>;
  const headerScore = zeros() as Record<string, number[]>;

  for (let c = 0; c < width; c++) {
    const header = (headerRow[c] ?? "").trim();
    for (const { role, re, score } of HEADER_PATTERNS) {
      if (header !== "" && re.test(header) && score > headerScore[role][c]) {
        headerScore[role][c] = score;
      }
    }
    for (const role of Object.keys(scores)) scores[role][c] = headerScore[role][c];

    // ——— value shape ———
    const values = columnValues(sampleRows, c);
    if (values.length === 0) continue;
    const dateHits = values.filter((v) => parseBankDate(v) != null).length / values.length;
    const amountHits = values.filter((v) => parseAmountToCents(v) != null).length / values.length;
    const wordy =
      values.filter((v) => /[A-Za-z]{3,}/.test(v) && parseAmountToCents(v) == null).length /
      values.length;
    const avgLen = values.reduce((s, v) => s + v.length, 0) / values.length;

    if (dateHits > 0.8) scores.date[c] += 50;
    if (amountHits > 0.8) {
      const anyNegative = values.some((v) => (parseAmountToCents(v) ?? 0) < 0);
      scores.amount[c] += anyNegative ? 35 : 20;
      scores.debit[c] += 10;
      scores.credit[c] += 10;
      scores.balance[c] += 10;
    } else {
      // Not numeric — it cannot be any money column.
      scores.amount[c] = 0;
      scores.debit[c] = 0;
      scores.credit[c] = 0;
      scores.balance[c] = 0;
    }
    if (wordy > 0.6) {
      scores.description[c] += 35 + Math.min(15, Math.round(avgLen / 4));
      scores.date[c] = dateHits > 0.8 ? scores.date[c] : 0;
    }
  }

  // Greedy assignment: strongest (role, column) pair first, and a column is
  // only ever used once, so "Amount" can't also be "Balance".
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const usedColumns = new Set<number>();
  const pairs: { role: keyof Omit<ColumnMapping, "outSign">; c: number; s: number }[] = [];
  for (const role of Object.keys(scores) as (keyof Omit<ColumnMapping, "outSign">)[]) {
    for (let c = 0; c < width; c++) if (scores[role][c] > 0) pairs.push({ role, c, s: scores[role][c] });
  }
  pairs.sort((a, b) => b.s - a.s || a.c - b.c);
  for (const { role, c } of pairs) {
    if (mapping[role] != null || usedColumns.has(c)) continue;
    mapping[role] = c;
    usedColumns.add(c);
  }

  // A debit/credit PAIR beats a lone amount column when the pair's headers
  // actually said "debit"/"credit" — otherwise the pair is two columns that
  // merely looked numeric and the single amount column is the real one.
  const pairNamed =
    mapping.debit != null &&
    mapping.credit != null &&
    headerScore.debit[mapping.debit] > 0 &&
    headerScore.credit[mapping.credit] > 0;
  if (pairNamed) {
    mapping.amount = null;
  } else if (mapping.amount != null) {
    mapping.debit = null;
    mapping.credit = null;
  }

  // Money-out sign for the single-column shape: if the file already contains
  // negative numbers it states its own signs; if every value is positive it
  // is a charge list (credit-card style) and money out needs flipping.
  if (mapping.amount != null) {
    const values = columnValues(sampleRows, mapping.amount);
    const anyNegative = values.some((v) => (parseAmountToCents(v) ?? 0) < 0);
    mapping.outSign = anyNegative ? "negative" : "positive";
  }

  return mapping;
}

/** Does row 1 name the columns, or is it already a transaction? A header row
 *  has no parseable date and no parseable amount in it. */
export function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.filter((c) => c.trim() !== "");
  if (cells.length === 0) return false;
  const dated = cells.some((c) => parseBankDate(c) != null);
  const money = cells.filter((c) => parseAmountToCents(c) != null).length;
  return !dated && money === 0;
}

// ———————————————————————————————————————————————————————————————————————
// Rows → transactions
// ———————————————————————————————————————————————————————————————————————

export type ParsedBankRow = {
  /** 1-based line number in the file, for "we skipped line 14" messages. */
  rowNumber: number;
  date: Date;
  description: string;
  amountCents: number;
  balanceCents: number | null;
};

export type SkippedRow = { rowNumber: number; reason: string };

export const NO_DESCRIPTION = "(no description)";

/** Apply a confirmed mapping to the data rows. Rows that can't be read are
 *  reported, never silently dropped. */
export function rowsToTransactions(
  dataRows: string[][],
  mapping: ColumnMapping,
  firstRowNumber = 1,
): { transactions: ParsedBankRow[]; skipped: SkippedRow[] } {
  const transactions: ParsedBankRow[] = [];
  const skipped: SkippedRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    const cell = (index: number | null) => (index == null ? "" : (row[index] ?? "").trim());

    const date = parseBankDate(cell(mapping.date));
    if (!date) {
      skipped.push({ rowNumber, reason: "no readable date" });
      return;
    }

    let amountCents: number | null = null;
    if (mapping.amount != null) {
      const parsed = parseAmountToCents(cell(mapping.amount));
      if (parsed != null) {
        amountCents = mapping.outSign === "positive" ? -parsed : parsed;
      }
    } else {
      const debit = parseAmountToCents(cell(mapping.debit));
      const credit = parseAmountToCents(cell(mapping.credit));
      // Debit = money out, credit = money in, whatever sign the file used.
      if (debit != null && debit !== 0) amountCents = -Math.abs(debit);
      else if (credit != null && credit !== 0) amountCents = Math.abs(credit);
    }
    if (amountCents == null || amountCents === 0) {
      skipped.push({ rowNumber, reason: "no readable amount" });
      return;
    }

    const description = cell(mapping.description) || NO_DESCRIPTION;
    transactions.push({
      rowNumber,
      date,
      description: description.slice(0, 300),
      amountCents,
      balanceCents: mapping.balance != null ? parseAmountToCents(cell(mapping.balance)) : null,
    });
  });

  return { transactions, skipped };
}

// ———————————————————————————————————————————————————————————————————————
// Fingerprints — how a re-imported statement stays idempotent
// ———————————————————————————————————————————————————————————————————————

/**
 * Stable sha256 of (account, calendar day, normalized description, cents).
 * The database has a UNIQUE(accountId, fingerprint), so re-uploading an
 * overlapping statement inserts nothing.
 *
 * `occurrence` exists for the one honest edge case: two genuinely different
 * transactions on the same day, same merchant, same amount (two $5 coffees).
 * Within one file the second copy gets occurrence 1 and is kept. Because
 * occurrences are numbered from 0 in date order, a later, smaller statement
 * containing only one of them re-derives occurrence 0 and is skipped —
 * duplicates can never be created, only missed until a fuller file arrives.
 */
export function fingerprintOf(
  accountId: string,
  date: Date,
  description: string,
  amountCents: number,
  occurrence = 0,
): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  const parts = [accountId, day, normalizeDescription(description), String(amountCents), String(occurrence)];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export type FingerprintedRow = ParsedBankRow & { fingerprint: string };

/** Fingerprint a whole parsed statement, numbering same-day/same-amount/
 *  same-description repeats as described on fingerprintOf. */
export function fingerprintTransactions(
  accountId: string,
  transactions: ParsedBankRow[],
): FingerprintedRow[] {
  const seen = new Map<string, number>();
  return transactions.map((t) => {
    const day = `${t.date.getFullYear()}-${t.date.getMonth()}-${t.date.getDate()}`;
    const key = `${day}|${normalizeDescription(t.description)}|${t.amountCents}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...t, fingerprint: fingerprintOf(accountId, t.date, t.description, t.amountCents, occurrence) };
  });
}

// ———————————————————————————————————————————————————————————————————————
// Matching a bank row against what is already in the books
// ———————————————————————————————————————————————————————————————————————

export type MatchableTxn = { date: Date; description: string; amountCents: number };
export type MatchCandidate = {
  date: Date;
  description: string;
  amountCents: number;
  /** vendor (expense) or source (income) — extra words to match against. */
  party?: string | null;
};

/** How far apart two records can be and still be the same transaction. */
export const MATCH_WINDOW_DAYS = 5;
/** Below this we show no suggestion at all — a wrong suggestion is worse
 *  than none, because it invites a wrong tap. */
export const SUGGEST_MIN_SCORE = 70;
/** "Almost certainly the same one" wording in the UI. */
export const STRONG_MATCH_SCORE = 90;
/**
 * The bar any FUTURE automatic matching would have to clear. Nothing in this
 * app auto-applies a match today: every link is a deliberate tap by the
 * owner. Kept here so the number lives with the scoring rule.
 */
export const AUTO_APPLY_MIN_SCORE = 95;

function daysBetween(a: Date, b: Date): number {
  const day = 24 * 60 * 60 * 1000;
  const an = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bn = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.abs(Math.round((an - bn) / day));
}

/**
 * 0..100 — how strongly a bank row looks like an Expense/Income already in
 * the books. THE RULE, in full:
 *
 *   1. AMOUNT IS A GATE. The two amounts must be equal to the cent
 *      (compared as absolute values, since the bank writes money out as
 *      negative and an Expense stores a positive amount). Not equal → 0.
 *      No "close enough" — a $42.50 and a $42.05 are different purchases.
 *   2. DATE IS A GATE TOO. More than MATCH_WINDOW_DAYS (5) apart → 0.
 *      A card settles a day or two after the receipt, not a fortnight.
 *   3. Points: 60 for the exact amount, then 25 for the same calendar day
 *      falling 5 points per day of distance (25/20/15/10/5/0), then up to
 *      15 for shared words between the bank description and the record's
 *      description + vendor/source name.
 *
 * So the maximum is 100 and a same-day exact amount with no words in common
 * scores 85; an exact amount four days later with nothing in common scores
 * 65 and is not even suggested (SUGGEST_MIN_SCORE = 70).
 */
export function scoreMatch(txn: MatchableTxn, candidate: MatchCandidate): number {
  if (Math.abs(txn.amountCents) !== Math.abs(candidate.amountCents)) return 0;
  const days = daysBetween(txn.date, candidate.date);
  if (days > MATCH_WINDOW_DAYS) return 0;

  let score = 60;
  score += Math.max(0, 25 - 5 * days);

  const left = descriptionTokens(txn.description);
  const right = descriptionTokens(`${candidate.description} ${candidate.party ?? ""}`);
  if (left.size > 0 && right.size > 0) {
    let shared = 0;
    for (const token of left) if (right.has(token)) shared++;
    const ratio = shared / Math.min(left.size, right.size);
    score += Math.round(15 * Math.min(1, ratio));
  }

  return Math.max(0, Math.min(100, score));
}

/** The best-scoring candidates for one bank row, strongest first, with
 *  anything below the suggestion threshold dropped. */
export function rankCandidates<T extends MatchCandidate & { id: string }>(
  txn: MatchableTxn,
  candidates: T[],
  limit = 3,
): { candidate: T; score: number }[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreMatch(txn, candidate) }))
    .filter((r) => r.score >= SUGGEST_MIN_SCORE)
    .sort((a, b) => b.score - a.score || daysBetween(txn.date, a.candidate.date) - daysBetween(txn.date, b.candidate.date))
    .slice(0, limit);
}

// ———————————————————————————————————————————————————————————————————————
// One-call analysis for the upload screen
// ———————————————————————————————————————————————————————————————————————

export type CsvAnalysis = {
  delimiter: CsvDelimiter;
  hasHeader: boolean;
  /** Column names — synthesised ("Column 1"…) when the file has no header. */
  header: string[];
  dataRows: string[][];
  guess: ColumnMapping;
  dayFirstWarning: boolean;
};

/** Everything the mapping screen needs from a pasted/uploaded file. */
export function analyzeCsvText(text: string): CsvAnalysis {
  const delimiter = sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) {
    return {
      delimiter,
      hasHeader: false,
      header: [],
      dataRows: [],
      guess: { ...EMPTY_MAPPING },
      dayFirstWarning: false,
    };
  }

  const hasHeader = looksLikeHeaderRow(rows[0]);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const width = Math.max(...rows.map((r) => r.length));
  const header = hasHeader
    ? Array.from({ length: width }, (_, i) => rows[0][i]?.trim() || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);

  const guess = guessColumns(hasHeader ? rows[0] : [], dataRows.slice(0, 25));
  const dayFirstWarning =
    guess.date != null && columnLooksDayFirst(columnValues(dataRows.slice(0, 50), guess.date));

  return { delimiter, hasHeader, header, dataRows, guess, dayFirstWarning };
}
