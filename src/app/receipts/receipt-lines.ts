// FR-006 — the arithmetic behind itemised receipts. Pure functions only, so
// the same numbers back the receipt page, the categorize page and the split
// action without any of them re-deriving it slightly differently.

import { ACCOUNTING_CATEGORIES } from "@/lib/domain";

/** Everything the math needs — a stored ReceiptLine row satisfies it. */
export type LineLike = {
  description: string;
  quantity: number;
  amountCents: number;
  accountingCategory: string | null;
};

export function linesTotalCents(lines: LineLike[]): number {
  return lines.reduce((sum, l) => sum + (Number.isFinite(l.amountCents) ? l.amountCents : 0), 0);
}

/** One category's share of a receipt — what a split would file as one expense. */
export type CategorySplit = {
  accountingCategory: string;
  amountCents: number;
  lineCount: number;
  /** The line descriptions in this category, in receipt order. */
  descriptions: string[];
};

/**
 * The lines grouped by category, biggest first. Lines with no category are
 * deliberately left out — an expense must carry a real accounting category
 * (the app never invents one), so uncategorized money is reported separately
 * by `uncategorized()` instead of being quietly lumped in somewhere.
 */
export function splitByCategory(lines: LineLike[]): CategorySplit[] {
  const groups = new Map<string, CategorySplit>();
  for (const line of lines) {
    const category = line.accountingCategory?.trim();
    if (!category) continue;
    const existing = groups.get(category);
    if (existing) {
      existing.amountCents += line.amountCents;
      existing.lineCount += 1;
      existing.descriptions.push(line.description);
    } else {
      groups.set(category, {
        accountingCategory: category,
        amountCents: line.amountCents,
        lineCount: 1,
        descriptions: [line.description],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.amountCents - a.amountCents);
}

/** The lines still waiting for a category — money a split would leave behind. */
export function uncategorized(lines: LineLike[]): { amountCents: number; lineCount: number } {
  const rest = lines.filter((l) => !l.accountingCategory?.trim());
  return { amountCents: linesTotalCents(rest), lineCount: rest.length };
}

/** A receipt is worth splitting only when its lines name two real categories. */
export function isSplittable(lines: LineLike[]): boolean {
  return splitByCategory(lines).length >= 2;
}

/** Keeps a typed category inside the fixed list; anything else becomes null. */
export function normalizeAccountingCategory(value: string | null): string | null {
  if (!value) return null;
  return (ACCOUNTING_CATEGORIES as readonly string[]).includes(value) ? value : null;
}

/** Line quantities are a convenience, not a calculation input (the amount IS
 *  the line's money). Anything unusable falls back to 1 rather than failing. */
export function parseQuantity(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 1;
  const n = Number(value.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

/** The one sentence the operator reads when the lines and the total disagree.
 *  Never an error, never a block — receipts really do have tax and fees. */
export function linesVsTotalNote(
  linesCents: number,
  totalCents: number | null,
  salesTaxCents: number | null,
  money: (cents: number | null) => string,
): { tone: "match" | "explained" | "differs"; text: string } | null {
  if (totalCents == null) return null;
  if (linesCents === totalCents) {
    return { tone: "match", text: `Lines add up to ${money(linesCents)} — that matches the receipt total.` };
  }
  const base = `Lines add up to ${money(linesCents)} — the receipt total says ${money(totalCents)}.`;
  if (salesTaxCents != null && linesCents + salesTaxCents === totalCents) {
    return { tone: "explained", text: `${base} The difference is exactly the sales tax, so it all adds up.` };
  }
  return { tone: "differs", text: base };
}
