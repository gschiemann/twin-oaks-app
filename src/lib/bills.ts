// Regular business bills — the "what's coming up" side of the money.
//
// ———————————————————————————————————————————————————————————————————————
// DELIBERATE DESIGN CONSTRAINT — PLEASE DO NOT "HELPFULLY" REMOVE THIS.
//
// A business bill is DECLARED here and SHOWN as upcoming. It is NEVER
// auto-posted to the books. There is no materializer in this file and there
// must not be one: nothing in /bills ever creates an Expense row.
//
// The household side (src/lib/household.ts, materializeRecurring) DOES post
// itself, and that is correct there — personal budgeting wants rent to appear
// whether or not anyone remembers it. The business side is different:
//   • an Expense is a tax record; an invented one is a wrong tax record,
//   • the amount actually paid drifts (fuel surcharge, a late fee, a skipped
//     month), so an auto-posted guess would quietly falsify the books,
//   • money leaving the business should stay a deliberate act by a human.
//
// So: this page reminds, the operator pays, then the operator records the
// real expense with the real amount. If a future ticket asks for
// "auto-post business bills", the answer is a reminder, not a ledger row.
// ———————————————————————————————————————————————————————————————————————
//
// Everything here is integer cents. No floats, no NaN — a bad number would
// be a wrong dollar figure on the dashboard, and this is the farmer's money.

import { prisma } from "@/lib/db";
import { outstandingCentsOf, paidCentsOf } from "@/app/invoices/invoice-bits";

// Bills repeat on a day of the month, capped at 28 so the day exists in
// every month — February has no 30th, and a bill that silently skipped
// February would be the worst kind of bug on this screen.
export const MIN_BILL_DAY = 1;
export const MAX_BILL_DAY = 28;

export type BillRecord = {
  id: string;
  description: string;
  amountCents: number;
  division: string;
  accountingCategory: string;
  vendorName: string | null;
  dayOfMonth: number;
  active: boolean;
  notes: string | null;
};

export type UpcomingBill = BillRecord & {
  /** The next calendar day this bill comes due (local noon). */
  dueDate: Date;
  /** Whole days from today to that date. 0 = due today. Never negative. */
  daysAway: number;
};

// The exact columns upcomingBills() needs — kept next to BillRecord so the
// two can never drift apart.
const BILL_SELECT = {
  id: true,
  description: true,
  amountCents: true,
  division: true,
  accountingCategory: true,
  vendorName: true,
  dayOfMonth: true,
  active: true,
  notes: true,
} as const;

export function clampBillDay(day: number): number {
  if (!Number.isFinite(day)) return MIN_BILL_DAY;
  return Math.min(MAX_BILL_DAY, Math.max(MIN_BILL_DAY, Math.trunc(day)));
}

// Local noon, the same trick parseDateInput() uses: a date pinned at noon
// can't slide onto the previous calendar day when it's read back.
function atNoon(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

/**
 * The next time a day-of-month bill comes due.
 *
 * Due TODAY still counts as today — an unpaid bill doesn't become next
 * month's problem until the day is actually past. Once the day is past, it
 * rolls into next month (and December rolls into January, which the Date
 * constructor handles by taking a month index of 12).
 */
export function nextDueDate(dayOfMonth: number, from: Date = new Date()): Date {
  const day = clampBillDay(dayOfMonth);
  return from.getDate() <= day
    ? atNoon(from.getFullYear(), from.getMonth(), day)
    : atNoon(from.getFullYear(), from.getMonth() + 1, day);
}

/**
 * Whole calendar days between two dates, counted from midnight to midnight
 * so "tomorrow" is always 1 no matter what time of day it is. Math.round
 * absorbs the 23- and 25-hour days at a daylight-saving change.
 */
export function daysUntil(date: Date, from: Date = new Date()): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 1 → "1st", 22 → "22nd". Plain words beat a bare number on this screen. */
export function ordinalDay(day: number): string {
  const d = clampBillDay(day);
  if (d >= 11 && d <= 13) return `${d}th`;
  if (d % 10 === 1) return `${d}st`;
  if (d % 10 === 2) return `${d}nd`;
  if (d % 10 === 3) return `${d}rd`;
  return `${d}th`;
}

/** "due the 15th — 9 days away" / "due the 1st — today". */
export function dueInWords(dayOfMonth: number, daysAway: number): string {
  const when = daysAway <= 0 ? "today" : daysAway === 1 ? "tomorrow" : `${daysAway} days away`;
  return `due the ${ordinalDay(dayOfMonth)} — ${when}`;
}

/**
 * "$1,240" — a rounded, readable figure for a plain-English sentence.
 * Cents are exact everywhere the money is listed; this is only for the
 * "About $1,240 of regular bills are due…" line, where trailing zeros read
 * like a bank statement instead of a sentence.
 */
export function formatApproxDollars(cents: number): string {
  const whole = Math.round((Number.isFinite(cents) ? cents : 0) / 100);
  return whole.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Active bills coming due within the next N days, soonest first, each with
 * its next due date and how many days away that is.
 *
 * Paused bills never appear — pausing is how the operator says "not this
 * one right now" without losing the record.
 */
export async function upcomingBills(
  accountId: string,
  withinDays: number,
): Promise<UpcomingBill[]> {
  const window = Number.isFinite(withinDays) ? Math.max(0, Math.trunc(withinDays)) : 0;
  const from = new Date();

  const bills = await prisma.recurringBill.findMany({
    where: { accountId, active: true },
    select: BILL_SELECT,
  });

  return bills
    .map((bill) => {
      const dueDate = nextDueDate(bill.dayOfMonth, from);
      return { ...bill, dueDate, daysAway: daysUntil(dueDate, from) };
    })
    .filter((bill) => bill.daysAway <= window)
    .sort(
      (a, b) =>
        a.daysAway - b.daysAway ||
        b.amountCents - a.amountCents ||
        a.description.localeCompare(b.description),
    );
}

export type BillMatchInput = Pick<BillRecord, "amountCents" | "description" | "vendorName">;

export type ExpenseMatchInput = {
  id: string;
  date: Date;
  amountCents: number;
  description: string;
  vendorName: string | null;
};

export type BillPaidGuess = {
  /** True only when BOTH tests below pass. A guess, never a fact. */
  likelyPaid: boolean;
  /** The expense we think it is, so the UI can link straight to it. */
  expenseId: string | null;
};

// Words that show up in half the vendor names on earth. Matching on these
// alone would pair "Farm insurance" with "Farm supply" — so they don't count
// as evidence.
const NOISE_WORDS = new Set([
  "bill",
  "bills",
  "monthly",
  "month",
  "payment",
  "payments",
  "invoice",
  "account",
  "service",
  "services",
  "company",
  "inc",
  "llc",
  "the",
  "and",
  "for",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function significantWords(text: string): string[] {
  return text.split(" ").filter((word) => word.length >= 4 && !NOISE_WORDS.has(word));
}

// The name test: one side's vendor name appears inside the other side's
// text, or the two share a real word. Deliberately requires a *word*, not a
// letter — "AT&T" normalizes to "at t", which the substring branch catches
// ("at t wireless") while the word branch correctly ignores it.
function namesOverlap(bill: BillMatchInput, expense: ExpenseMatchInput): boolean {
  const billText = normalizeText(`${bill.vendorName ?? ""} ${bill.description}`);
  const expenseText = normalizeText(`${expense.vendorName ?? ""} ${expense.description}`);
  if (billText === "" || expenseText === "") return false;

  const billVendor = normalizeText(bill.vendorName);
  if (billVendor.length >= 3 && expenseText.includes(billVendor)) return true;

  const expenseVendor = normalizeText(expense.vendorName);
  if (expenseVendor.length >= 3 && billText.includes(expenseVendor)) return true;

  const billWords = new Set(significantWords(billText));
  return significantWords(expenseText).some((word) => billWords.has(word));
}

/**
 * Has this bill probably already been paid this month?
 *
 * THE MATCHING RULE — an expense counts as this bill's payment only when ALL
 * of the following hold:
 *   1. the expense is dated inside the month starting at monthStart,
 *   2. its amount equals the bill's amount TO THE CENT (no tolerance band,
 *      no "close enough" — $184.00 is not $184.37), and
 *   3. the names genuinely overlap (see namesOverlap above).
 * When several expenses qualify, the earliest one wins, so the answer is
 * stable no matter what order the rows arrive in.
 *
 * WHY SO CONSERVATIVE: the two possible mistakes are not equal. A false
 * "due" costs the operator a few seconds of "oh, I already paid that." A
 * false "paid" costs a late fee, a shut-off notice, or a lapsed insurance
 * policy. So the rule is tight on purpose, and the caller must treat the
 * answer as a hint: the bill is still listed and still counted in the
 * totals — the guess only adds a quiet "looks paid" note beside it. Never
 * hide a bill, skip it, or subtract it from a total on the strength of this
 * function. An amount-only or vendor-only match is NOT enough evidence; if a
 * future change loosens either test, this whole comment stops being true.
 */
export function billLikelyPaid(
  bill: BillMatchInput,
  expenses: ExpenseMatchInput[],
  monthStart: Date,
): BillPaidGuess {
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  let match: ExpenseMatchInput | null = null;
  for (const expense of expenses) {
    if (expense.amountCents !== bill.amountCents) continue;
    if (expense.date < monthStart || expense.date >= monthEnd) continue;
    if (!namesOverlap(bill, expense)) continue;
    if (match === null || expense.date < match.date) match = expense;
  }

  return { likelyPaid: match !== null, expenseId: match?.id ?? null };
}

export type OutstandingInvoiceTotals = {
  /** Everything customers still owe, in cents. */
  totalCents: number;
  /** How many invoices that is. */
  count: number;
  /** The slice of totalCents already past its due date. */
  overdueCents: number;
  /** How many of the counted invoices are past due. */
  overdueCount: number;
};

/**
 * Money owed TO the business, derived from invoices minus their payments.
 *
 * Quotes never count (nobody owes money on a price you offered them), and
 * neither do drafts or cancelled invoices — outstandingCentsOf() in
 * src/app/invoices/invoice-bits.ts is the single place that rule lives, so
 * this reuses it rather than re-deriving it and drifting.
 *
 * "Overdue" is simply past dueDate with money still on it — including a
 * partly-paid invoice, whose derived status is PARTIAL but which is late all
 * the same. An invoice with no due date is owed, never overdue.
 */
export async function outstandingInvoiceTotals(
  accountId: string,
): Promise<OutstandingInvoiceTotals> {
  const invoices = await prisma.invoice.findMany({
    where: { accountId, kind: "INVOICE" },
    select: {
      status: true,
      kind: true,
      totalCents: true,
      dueDate: true,
      convertedToInvoiceId: true,
      payments: { select: { amountCents: true } },
    },
  });

  const now = new Date();
  let totalCents = 0;
  let count = 0;
  let overdueCents = 0;
  let overdueCount = 0;

  for (const invoice of invoices) {
    const owed = outstandingCentsOf(invoice, paidCentsOf(invoice.payments));
    if (owed <= 0) continue;
    totalCents += owed;
    count += 1;
    if (invoice.dueDate && invoice.dueDate < now) {
      overdueCents += owed;
      overdueCount += 1;
    }
  }

  return { totalCents, count, overdueCents, overdueCount };
}

/**
 * What the fixed monthly outgoings add up to — the sum of every ACTIVE
 * bill's amount. Paused bills are excluded: they aren't being paid, so
 * counting them would overstate what leaves the account each month.
 */
export async function billsMonthlyTotal(accountId: string): Promise<number> {
  const agg = await prisma.recurringBill.aggregate({
    where: { accountId, active: true },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}
