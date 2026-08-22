// SPEC §4 — "wait, did I already save this one?"
//
// Duplicate detection is a WARNING, never a gate. Nothing here refuses a
// save, edits a record, or deletes anything: it answers one question —
// "does this receipt look like a purchase already in the books?" — and the
// operator decides. The only action offered is archiving (status ARCHIVED),
// which keeps the original document forever, exactly like every other
// receipt.
//
// Three signals, strongest first:
//   1. the same receipt number            (all but conclusive)
//   2. same vendor + same total, within 3 days
//   3. the identical file (same name AND same byte size)
//
// Every query is scoped to the account, like everything else in the app.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

/** How far apart two receipts for the same vendor+amount can be and still
 *  read as the same purchase. */
export const DUPLICATE_DAY_WINDOW = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields duplicate matching looks at — a plain Receipt row satisfies it. */
export type DupeSubject = {
  id: string;
  vendorName: string | null;
  receiptDate: Date | null;
  totalCents: number | null;
  receiptNumber: string | null;
  fileName: string | null;
  fileSize: number | null;
};

export type DuplicateReason = "RECEIPT_NUMBER" | "VENDOR_AMOUNT_DATE" | "SAME_FILE";

export type DuplicateCandidate = {
  id: string;
  vendorName: string | null;
  receiptDate: Date | null;
  totalCents: number | null;
  status: string;
  reason: DuplicateReason;
  /** Plain-English reason, e.g. "Same receipt number (4471-22)". */
  why: string;
};

// Strongest evidence first — the operator should read the best reason.
const REASON_RANK: Record<DuplicateReason, number> = {
  RECEIPT_NUMBER: 0,
  VENDOR_AMOUNT_DATE: 1,
  SAME_FILE: 2,
};

const norm = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

function daysApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

/** Case/whitespace variants so an exact-match SQL `in` still catches
 *  "TSC-4471" vs " tsc-4471". SQLite has no case-insensitive mode, so the
 *  query casts a slightly wider net and the comparison below decides. */
function variants(value: string): string[] {
  const t = value.trim();
  return Array.from(new Set([value, t, t.toUpperCase(), t.toLowerCase()]));
}

/**
 * The whole rule, as a pure function: why (if at all) `other` looks like the
 * same purchase as `subject`. Exported so the same comparison runs for a
 * single receipt and for a whole list.
 */
export function duplicateReason(
  subject: DupeSubject,
  other: DupeSubject,
): DuplicateReason | null {
  if (!subject.id || !other.id || subject.id === other.id) return null;

  const subjNumber = norm(subject.receiptNumber);
  if (subjNumber && subjNumber === norm(other.receiptNumber)) return "RECEIPT_NUMBER";

  const subjVendor = norm(subject.vendorName);
  if (
    subjVendor &&
    subjVendor === norm(other.vendorName) &&
    subject.totalCents != null &&
    subject.totalCents === other.totalCents &&
    subject.receiptDate &&
    other.receiptDate &&
    daysApart(subject.receiptDate, other.receiptDate) <= DUPLICATE_DAY_WINDOW
  ) {
    return "VENDOR_AMOUNT_DATE";
  }

  const subjFile = norm(subject.fileName);
  if (
    subjFile &&
    subjFile === norm(other.fileName) &&
    subject.fileSize != null &&
    subject.fileSize === other.fileSize
  ) {
    return "SAME_FILE";
  }

  return null;
}

function whyText(subject: DupeSubject, other: DupeSubject, reason: DuplicateReason): string {
  switch (reason) {
    case "RECEIPT_NUMBER":
      return `Same receipt number (${(other.receiptNumber ?? subject.receiptNumber ?? "").trim()}).`;
    case "VENDOR_AMOUNT_DATE":
      return `Same vendor and the same total (${formatCents(other.totalCents)}), within ${DUPLICATE_DAY_WINDOW} days.`;
    case "SAME_FILE":
      return `The same file was attached (${other.fileName ?? subject.fileName}).`;
  }
}

/** "Possible duplicate of the Tractor Supply receipt from Aug 14" — the UI
 *  adds the "— open it" link after it. */
export function duplicateHeadline(candidate: DuplicateCandidate): string {
  const who = candidate.vendorName?.trim() || "another";
  const when = candidate.receiptDate ? ` from ${formatDate(candidate.receiptDate)}` : "";
  return `Possible duplicate of the ${who} receipt${when}`;
}

// The SQL side: clauses broad enough to catch the candidates, never trusted
// on their own — duplicateReason() re-checks every row that comes back.
function clausesFor(subject: DupeSubject): Prisma.ReceiptWhereInput[] {
  const clauses: Prisma.ReceiptWhereInput[] = [];

  const number = subject.receiptNumber?.trim();
  if (number) clauses.push({ receiptNumber: { in: variants(number) } });

  if (subject.vendorName?.trim() && subject.totalCents != null && subject.receiptDate) {
    clauses.push({
      totalCents: subject.totalCents,
      receiptDate: {
        gte: new Date(subject.receiptDate.getTime() - DUPLICATE_DAY_WINDOW * DAY_MS),
        lte: new Date(subject.receiptDate.getTime() + DUPLICATE_DAY_WINDOW * DAY_MS),
      },
    });
  }

  const fileName = subject.fileName?.trim();
  if (fileName && subject.fileSize != null) {
    clauses.push({ fileName: { in: variants(fileName) }, fileSize: subject.fileSize });
  }

  return clauses;
}

const CANDIDATE_SELECT = {
  id: true,
  vendorName: true,
  receiptDate: true,
  totalCents: true,
  receiptNumber: true,
  fileName: true,
  fileSize: true,
  status: true,
} as const;

type CandidateRow = DupeSubject & { status: string };

function rank(subject: DupeSubject, rows: CandidateRow[], limit: number): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const row of rows) {
    const reason = duplicateReason(subject, row);
    if (!reason) continue;
    out.push({
      id: row.id,
      vendorName: row.vendorName,
      receiptDate: row.receiptDate,
      totalCents: row.totalCents,
      status: row.status,
      reason,
      why: whyText(subject, row, reason),
    });
  }
  out.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason]);
  return out.slice(0, limit);
}

/**
 * Receipts in this account that look like the same purchase as `receipt`.
 * Empty array when there is nothing to compare on (a bare photo with no
 * vendor, total or file) — silence beats a guess. Never throws: a warning
 * that can't be computed must not take a page down with it.
 */
export async function findLikelyDuplicates(
  accountId: string,
  receipt: DupeSubject,
  limit = 3,
): Promise<DuplicateCandidate[]> {
  if (!accountId || !receipt?.id) return [];
  const clauses = clausesFor(receipt);
  if (clauses.length === 0) return [];

  try {
    const rows = await prisma.receipt.findMany({
      where: {
        accountId,
        id: { not: receipt.id },
        // An archived receipt is one the operator already dealt with —
        // re-warning about it is how a warning becomes wallpaper.
        status: { not: "ARCHIVED" },
        OR: clauses,
      },
      select: CANDIDATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rank(receipt, rows, limit);
  } catch {
    return [];
  }
}

/**
 * The same answer for a whole list (the Inbox), in a fixed number of queries
 * instead of one per row. Returns receiptId → candidates; ids with no
 * duplicates are simply absent.
 */
export async function findLikelyDuplicatesForMany(
  accountId: string,
  receipts: DupeSubject[],
  limit = 1,
): Promise<Map<string, DuplicateCandidate[]>> {
  const found = new Map<string, DuplicateCandidate[]>();
  if (!accountId || receipts.length === 0) return found;

  const clauses = receipts.flatMap(clausesFor);
  if (clauses.length === 0) return found;

  try {
    const pool = await prisma.receipt.findMany({
      where: { accountId, status: { not: "ARCHIVED" }, OR: clauses },
      select: CANDIDATE_SELECT,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    for (const subject of receipts) {
      const hits = rank(subject, pool, limit);
      if (hits.length > 0) found.set(subject.id, hits);
    }
  } catch {
    return found;
  }
  return found;
}
