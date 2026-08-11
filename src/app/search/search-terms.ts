// Search-term classification for global search (SPEC §29: "Dollar amounts" and
// "Dates" must be findable, not just text).
//
// Pure parsing only — no Prisma, no React. The page turns these terms into
// per-model `where` clauses.

import { parseDollarsToCents } from "@/lib/money";

/** A single calendar day in local time: [gte, lt). */
export type DayRange = { gte: Date; lt: Date };

export type SearchTerm =
  | { kind: "text"; raw: string }
  | { kind: "money"; raw: string; cents: number }
  | { kind: "date"; raw: string; range: DayRange };

// "$87", "87.42", "1,234.56" — an optional $, up to 7 leading digits, optional
// thousands groups, optional 1–2 decimals.
const MONEY_SHAPE = /^\$?\d{1,7}(,\d{3})*(\.\d{1,2})?$/;

/**
 * Dollar amount → integer cents, or null when the term isn't money.
 *
 * A bare integer ("2026") is deliberately NOT money — it's almost always a
 * year, and the SPEC's own example search is "Tractor #1 hydraulic 2026". The
 * operator has to signal money with a "$", a decimal point, or a comma.
 */
export function parseMoneyTerm(raw: string): number | null {
  if (!MONEY_SHAPE.test(raw)) return null;
  if (!raw.startsWith("$") && !raw.includes(".") && !raw.includes(",")) return null;
  return parseDollarsToCents(raw);
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;

/**
 * "8/9/2026" | "8/9/26" | "2026-08-09" | "8/9" (current year) → the local day
 * range that contains it. Always a range, never a bare Date: stored timestamps
 * carry a time component (`parseDateInput` uses local noon), so equality on a
 * midnight Date would match nothing.
 */
export function parseDateTerm(raw: string, now: Date = new Date()): DayRange | null {
  const iso = ISO_DATE.exec(raw);
  if (iso) return localDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = SLASH_DATE.exec(raw);
  if (!slash) return null;

  const yearPart = slash[3];
  let year: number;
  if (yearPart === undefined) {
    year = now.getFullYear();
  } else if (yearPart.length === 4) {
    year = Number(yearPart);
  } else {
    // Two-digit years pivot at 69 (the POSIX convention): 26 → 2026, 98 → 1998.
    const yy = Number(yearPart);
    year = yy <= 69 ? 2000 + yy : 1900 + yy;
  }
  return localDay(year, Number(slash[1]), Number(slash[2]));
}

function localDay(year: number, month: number, day: number): DayRange | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const gte = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject days that don't exist — JS rolls "2/30/2026" over into March.
  if (gte.getFullYear() !== year || gte.getMonth() !== month - 1 || gte.getDate() !== day) {
    return null;
  }
  // Day + 1 via the constructor, so DST transitions stay correct.
  const lt = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { gte, lt };
}

/** Money first, then date, then plain text. */
export function classifyTerm(raw: string, now: Date = new Date()): SearchTerm {
  const cents = parseMoneyTerm(raw);
  if (cents !== null) return { kind: "money", raw, cents };

  const range = parseDateTerm(raw, now);
  if (range) return { kind: "date", raw, range };

  return { kind: "text", raw };
}
