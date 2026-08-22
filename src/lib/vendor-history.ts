// FR-006 — "you usually file this vendor under…"
//
// No AI, no external service, no guessing: this is the operator's OWN
// bookkeeping, counted. When a receipt from Tractor Supply is categorized,
// the form starts on whatever category Tractor Supply has been filed under
// most often in THIS account — and says so, so the operator can see why and
// change it. A suggestion is a starting point, never a decision: the app
// still never decides deductibility or category on its own (SPEC §1/§27).
//
// Two counts, one query each, scoped to the account like everything else.

import { prisma } from "@/lib/db";

/** One category and how many of this vendor's expenses use it. */
export type CategoryCount = { value: string; count: number };

export type VendorSuggestion = {
  /** The vendor as the operator has been spelling it. */
  vendorName: string;
  /** How many expenses this account has for that vendor. */
  expenseCount: number;
  /** Most-used accounting category — a suggestion only exists if this does. */
  accounting: CategoryCount;
  /** Most-used management drill-down path, when there is one. */
  management: CategoryCount | null;
};

const norm = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

/**
 * Every spelling of this vendor already in the books, matched ignoring case
 * and stray spaces — "tractor supply co" finds the rows filed under "Tractor
 * Supply Co". Neither database engine we run on can do that in a WHERE clause
 * we can share (SQLite has no case-insensitive mode; `mode: "insensitive"` is
 * Postgres-only), so the distinct spellings come back and the comparison
 * happens here — the same wide-net-then-check shape as receipt-dupes.ts.
 */
async function spellingsOf(accountId: string, name: string): Promise<string[]> {
  const rows = await prisma.expense.groupBy({
    by: ["vendorName"],
    where: { accountId, vendorName: { not: null } },
    _count: { vendorName: true },
  });
  const target = norm(name);
  return rows
    .filter((r) => r.vendorName != null && norm(r.vendorName) === target)
    // Most-used spelling first, so the note reads back in the operator's own
    // capitalization rather than whatever they typed this time.
    .sort((a, b) => b._count.vendorName - a._count.vendorName)
    .map((r) => r.vendorName as string);
}

/**
 * The accounting and management categories this account files `vendorName`
 * under most often, with their counts.
 *
 * Returns null when there is nothing to go on (no vendor, no history) —
 * silence beats a guess. Never throws: a convenience must not be able to
 * take the expense form down with it.
 */
export async function suggestCategoriesFor(
  accountId: string,
  vendorName: string | null | undefined,
): Promise<VendorSuggestion | null> {
  const name = typeof vendorName === "string" ? vendorName.trim() : "";
  if (!accountId || name === "") return null;

  try {
    const spellings = await spellingsOf(accountId, name);
    if (spellings.length === 0) return null;

    const where = { accountId, vendorName: { in: spellings } };

    const [accounting, management, expenseCount] = await Promise.all([
      prisma.expense.groupBy({
        by: ["accountingCategory"],
        where,
        _count: { accountingCategory: true },
        // Most-used first; the alphabetical tiebreak keeps a two-way tie from
        // flipping between page loads.
        orderBy: [{ _count: { accountingCategory: "desc" } }, { accountingCategory: "asc" }],
        take: 1,
      }),
      prisma.expense.groupBy({
        by: ["managementCategory"],
        where: { ...where, managementCategory: { not: null } },
        _count: { managementCategory: true },
        orderBy: [{ _count: { managementCategory: "desc" } }, { managementCategory: "asc" }],
        take: 1,
      }),
      prisma.expense.count({ where }),
    ]);

    const top = accounting[0];
    if (!top || expenseCount === 0) return null;

    const mgmt = management[0];
    return {
      // The spelling the books actually use, not whatever was typed today.
      vendorName: spellings[0],
      expenseCount,
      accounting: { value: top.accountingCategory, count: top._count.accountingCategory },
      management:
        mgmt && mgmt.managementCategory
          ? { value: mgmt.managementCategory, count: mgmt._count.managementCategory }
          : null,
    };
  } catch {
    return null;
  }
}

/** The quiet one-liner shown under the category picker. Plain English, and
 *  it always says the operator can change it — because they can. */
export function suggestionNote(s: VendorSuggestion): string {
  const lead =
    s.accounting.count === 1
      ? `You filed ${s.vendorName} under ${s.accounting.value} last time.`
      : `You usually file ${s.vendorName} under ${s.accounting.value} — ${s.accounting.count} of your ${s.expenseCount} so far.`;
  return `${lead} Change it if this one is different.`;
}
