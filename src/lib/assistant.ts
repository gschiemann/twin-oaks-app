// FR-002 — the assistant. "Ask about your books" in plain English.
//
// Two halves, deliberately separated:
//
//   buildSnapshot(accountId)  — reads the books and returns a COMPACT,
//     PRE-AGGREGATED picture of this ONE account: totals by category, by
//     division, by month, top vendors and customers, counts of animals /
//     print jobs / spools, what's outstanding, what's flagged. A few KB of
//     already-added-up numbers. Raw rows NEVER leave this function — the
//     model is handed totals, not a database dump — and nothing personal
//     rides along (no emails, no addresses, no phone numbers; only the
//     vendor and customer NAMES a ranking question actually needs).
//
//   askAssistant(snapshot, question, history) — the Anthropic call. Same
//     shape as src/lib/receipt-ai.ts: direct fetch (no SDK), the key is
//     optional, there is an AbortSignal, and it NEVER throws — every
//     failure path comes back as { error } in words the owner can read.
//
// Single tenant, always: every query below carries `accountId`. There is no
// code path here that can read another account's numbers, and no caller can
// pass one in — the route takes the id from the session cookie, never from
// the request body.

import { prisma } from "@/lib/db";
import { getBusinessProfile } from "@/lib/business";
import { formatCents } from "@/lib/money";
import {
  DEFAULT_LABOR_RATE_CENTS_PER_HOUR,
  DEFAULT_MACHINE_RATE_CENTS_PER_HOUR,
  DIVISION_LABELS,
  type Division,
} from "@/lib/domain";

const MODEL = "claude-haiku-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";

// Cost control. Haiku, a short answer, a short conversation window, and a
// hard timeout — one question costs a fraction of a cent.
const MAX_ANSWER_TOKENS = 700;
const MAX_HISTORY_MESSAGES = 6; // three exchanges — enough for "and last year?"
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_MESSAGE_CHARS = 1500;
const REQUEST_TIMEOUT_MS = 30_000;

// Snapshot shaping — keeps the payload a few KB no matter how big the books get.
const TOP_CATEGORIES = 12;
const TOP_VENDORS = 8;
const TOP_CUSTOMERS = 8;
const TOP_HOUSEHOLD_CATEGORIES = 6;
const MAX_PRINT_JOBS = 2000;
const MAX_SNAPSHOT_CHARS = 12_000;

export const ASSISTANT_NOT_CONFIGURED =
  "The assistant isn't switched on for this app yet.";

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

export type SnapshotRow = { label: string; value: string };
export type SnapshotSection = { title: string; note?: string; rows: SnapshotRow[] };

export type AssistantSnapshot = {
  businessName: string;
  year: number;
  lastYear: number;
  generatedAt: string;
  /** A few numbers the page shows as stat cards. */
  headline: {
    revenueYtdCents: number;
    expensesYtdCents: number;
    netYtdCents: number;
    setAsideCents: number;
  };
  /** The same content the model sees, in a shape the page can render. */
  sections: SnapshotSection[];
  /** EXACTLY what is sent to the model. Nothing else about the books is. */
  text: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function row(label: string, value: string | number): SnapshotRow {
  return { label, value: String(value) };
}

function section(
  title: string,
  rows: (SnapshotRow | null)[],
  note?: string,
): SnapshotSection | null {
  const kept = rows.filter((r): r is SnapshotRow => r !== null);
  if (kept.length === 0) return null;
  return note ? { title, note, rows: kept } : { title, rows: kept };
}

// A failed aggregation must never take the whole page down — a book with no
// sheep in it simply has no sheep section.
function safe<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(work).catch((e) => {
    console.error("[assistant] aggregation failed:", e);
    return fallback;
  });
}

function money(cents: number): string {
  return formatCents(cents);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function divisionLabel(d: string): string {
  return DIVISION_LABELS[d as Division] ?? d;
}

type Bucket = { revenue: number; expenses: number };

export async function buildSnapshot(accountId: string): Promise<AssistantSnapshot> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;
  const yearStart = new Date(year, 0, 1);
  const nextYearStart = new Date(year + 1, 0, 1);
  const monthStart = new Date(year, now.getMonth(), 1);
  const springStart = new Date(year, 2, 1); // March 1
  const springEnd = new Date(year, 5, 1); // June 1

  const profile = await safe(getBusinessProfile(accountId), null);

  // ——— Money in and out ————————————————————————————————————————————————
  // Narrow selects (date + amount only) so month-by-month can be bucketed
  // without pulling descriptions, notes or vendor text into memory.
  const [expenseDates, incomeDates, lastYearExp, lastYearInc] = await Promise.all([
    safe(
      prisma.expense.findMany({
        where: { accountId, date: { gte: yearStart, lt: nextYearStart } },
        select: { date: true, amountCents: true },
      }),
      [] as { date: Date; amountCents: number }[],
    ),
    safe(
      prisma.income.findMany({
        where: { accountId, date: { gte: yearStart, lt: nextYearStart } },
        select: { date: true, amountCents: true },
      }),
      [] as { date: Date; amountCents: number }[],
    ),
    safe(
      prisma.expense.aggregate({ where: { accountId, taxYear: lastYear }, _sum: { amountCents: true } }),
      { _sum: { amountCents: null } },
    ),
    safe(
      prisma.income.aggregate({ where: { accountId, taxYear: lastYear }, _sum: { amountCents: true } }),
      { _sum: { amountCents: null } },
    ),
  ]);

  const byMonth: Bucket[] = Array.from({ length: 12 }, () => ({ revenue: 0, expenses: 0 }));
  let expensesYtd = 0;
  let revenueYtd = 0;
  for (const e of expenseDates) {
    expensesYtd += e.amountCents;
    byMonth[e.date.getMonth()].expenses += e.amountCents;
  }
  for (const i of incomeDates) {
    revenueYtd += i.amountCents;
    byMonth[i.date.getMonth()].revenue += i.amountCents;
  }
  const netYtd = revenueYtd - expensesYtd;
  const thisMonth = byMonth[now.getMonth()];
  const lastMonthIdx = now.getMonth() - 1;
  const lastMonth = lastMonthIdx >= 0 ? byMonth[lastMonthIdx] : null;
  const lastYearExpenses = lastYearExp._sum.amountCents ?? 0;
  const lastYearRevenue = lastYearInc._sum.amountCents ?? 0;
  // Same planning figure the dashboard shows. NOT a tax calculation — the
  // prompt below is explicit about that, and so is the label.
  const setAside = netYtd > 0 ? Math.round(netYtd * 0.25) : 0;

  // ——— Breakdowns ——————————————————————————————————————————————————————
  const [catThis, catLast, byDivision, incomeByCategory, topVendors, expenseCount] =
    await Promise.all([
      safe(
        prisma.expense.groupBy({
          by: ["accountingCategory"],
          where: { accountId, taxYear: year },
          _sum: { amountCents: true },
          _count: true,
          orderBy: { _sum: { amountCents: "desc" } },
        }),
        [] as { accountingCategory: string; _sum: { amountCents: number | null }; _count: number }[],
      ),
      safe(
        prisma.expense.groupBy({
          by: ["accountingCategory"],
          where: { accountId, taxYear: lastYear },
          _sum: { amountCents: true },
        }),
        [] as { accountingCategory: string; _sum: { amountCents: number | null } }[],
      ),
      safe(
        prisma.expense.groupBy({
          by: ["division"],
          where: { accountId, taxYear: year },
          _sum: { amountCents: true },
        }),
        [] as { division: string; _sum: { amountCents: number | null } }[],
      ),
      safe(
        prisma.income.groupBy({
          by: ["category"],
          where: { accountId, taxYear: year },
          _sum: { amountCents: true },
          orderBy: { _sum: { amountCents: "desc" } },
        }),
        [] as { category: string; _sum: { amountCents: number | null } }[],
      ),
      safe(
        prisma.expense.groupBy({
          by: ["vendorName"],
          where: { accountId, taxYear: year, vendorName: { not: null } },
          _sum: { amountCents: true },
          _count: true,
          orderBy: { _sum: { amountCents: "desc" } },
          take: TOP_VENDORS,
        }),
        [] as { vendorName: string | null; _sum: { amountCents: number | null }; _count: number }[],
      ),
      safe(prisma.expense.count({ where: { accountId, taxYear: year } }), 0),
    ]);

  const lastYearByCategory = new Map(
    catLast.map((c) => [c.accountingCategory, c._sum.amountCents ?? 0]),
  );

  // ——— Invoices, customers, what's owed ————————————————————————————————
  const [openInvoices, invoicedByCustomer, customerCount, draftCount] = await Promise.all([
    safe(
      prisma.invoice.findMany({
        where: { accountId, status: "SENT", kind: "INVOICE" },
        select: {
          totalCents: true,
          dueDate: true,
          payments: { select: { amountCents: true } },
        },
      }),
      [] as { totalCents: number; dueDate: Date | null; payments: { amountCents: number }[] }[],
    ),
    safe(
      prisma.invoice.groupBy({
        by: ["customerId"],
        where: { accountId, taxYear: year, kind: "INVOICE", status: { not: "CANCELLED" } },
        _sum: { totalCents: true },
        _count: true,
        orderBy: { _sum: { totalCents: "desc" } },
        take: TOP_CUSTOMERS,
      }),
      [] as { customerId: string; _sum: { totalCents: number | null }; _count: number }[],
    ),
    safe(prisma.customer.count({ where: { accountId } }), 0),
    safe(prisma.invoice.count({ where: { accountId, status: "DRAFT", kind: "INVOICE" } }), 0),
  ]);

  let outstandingCents = 0;
  let overdueCount = 0;
  let overdueCents = 0;
  let awaitingCount = 0;
  for (const inv of openInvoices) {
    const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const due = Math.max(0, inv.totalCents - paid);
    if (due <= 0) continue;
    outstandingCents += due;
    awaitingCount += 1;
    if (inv.dueDate && inv.dueDate.getTime() < now.getTime()) {
      overdueCount += 1;
      overdueCents += due;
    }
  }

  // Names only, and only for the customers a revenue ranking needs. The
  // lookup is itself accountId-scoped, so an id from another account
  // resolves to nothing rather than leaking a name.
  const topCustomerIds = invoicedByCustomer.map((c) => c.customerId).filter(Boolean);
  const customerNames = new Map<string, string>(
    topCustomerIds.length === 0
      ? []
      : (
          await safe(
            prisma.customer.findMany({
              where: { accountId, id: { in: topCustomerIds } },
              select: { id: true, name: true },
            }),
            [] as { id: string; name: string }[],
          )
        ).map((c) => [c.id, c.name] as const),
  );

  // ——— Flagged / needs attention ————————————————————————————————————————
  const [needsReview, missingReceipts, inboxCount, capital, unmatchedBank, mileage, maintenance] =
    await Promise.all([
      safe(
        prisma.expense.aggregate({
          where: { accountId, taxStatus: "NEEDS_REVIEW" },
          _sum: { amountCents: true },
          _count: true,
        }),
        { _sum: { amountCents: null }, _count: 0 },
      ),
      safe(prisma.expense.count({ where: { accountId, receipts: { none: {} } } }), 0),
      safe(prisma.receipt.count({ where: { accountId, status: "INBOX" } }), 0),
      safe(
        prisma.expense.aggregate({
          where: { accountId, taxYear: year, isCapital: true },
          _sum: { amountCents: true },
          _count: true,
        }),
        { _sum: { amountCents: null }, _count: 0 },
      ),
      safe(prisma.bankTransaction.count({ where: { accountId, status: "UNMATCHED" } }), 0),
      safe(
        prisma.mileageLog.aggregate({
          where: { accountId, taxYear: year },
          _sum: { miles: true },
          _count: true,
        }),
        { _sum: { miles: null }, _count: 0 },
      ),
      safe(
        prisma.maintenanceRecord.aggregate({
          where: { accountId, date: { gte: yearStart, lt: nextYearStart } },
          _sum: { partsCostCents: true, laborCostCents: true },
          _count: true,
        }),
        { _sum: { partsCostCents: null, laborCostCents: null }, _count: 0 },
      ),
    ]);

  // ——— Livestock ————————————————————————————————————————————————————————
  const [
    animalsByStatus,
    activeBySex,
    activeBySpecies,
    lambingYear,
    lambingSpring,
    bornThisYear,
    bornSpring,
    salesThisYear,
    salesLastYear,
  ] = await Promise.all([
    safe(
      prisma.animal.groupBy({ by: ["status"], where: { accountId }, _count: true }),
      [] as { status: string; _count: number }[],
    ),
    safe(
      prisma.animal.groupBy({ by: ["sex"], where: { accountId, status: "ACTIVE" }, _count: true }),
      [] as { sex: string; _count: number }[],
    ),
    safe(
      prisma.animal.groupBy({
        by: ["species"],
        where: { accountId, status: "ACTIVE" },
        _count: true,
      }),
      [] as { species: string; _count: number }[],
    ),
    safe(
      prisma.animalEvent.aggregate({
        where: { accountId, kind: "LAMBING", date: { gte: yearStart, lt: nextYearStart } },
        _sum: { lambCount: true },
        _count: true,
      }),
      { _sum: { lambCount: null }, _count: 0 },
    ),
    safe(
      prisma.animalEvent.aggregate({
        where: { accountId, kind: "LAMBING", date: { gte: springStart, lt: springEnd } },
        _sum: { lambCount: true },
        _count: true,
      }),
      { _sum: { lambCount: null }, _count: 0 },
    ),
    safe(
      prisma.animal.count({
        where: { accountId, birthDate: { gte: yearStart, lt: nextYearStart } },
      }),
      0,
    ),
    safe(
      prisma.animal.count({ where: { accountId, birthDate: { gte: springStart, lt: springEnd } } }),
      0,
    ),
    safe(
      prisma.livestockSale.aggregate({
        where: { accountId, taxYear: year },
        _sum: { salePriceCents: true },
        _count: true,
      }),
      { _sum: { salePriceCents: null }, _count: 0 },
    ),
    safe(
      prisma.livestockSale.aggregate({
        where: { accountId, taxYear: lastYear },
        _sum: { salePriceCents: true },
        _count: true,
      }),
      { _sum: { salePriceCents: null }, _count: 0 },
    ),
  ]);

  // ——— 3D printing ——————————————————————————————————————————————————————
  // "Which printer made the most money?" needs revenue AND a cost estimate
  // per printer. Derived here from narrow selects; when a shared
  // src/lib/manufacturing.ts lands (see prisma/schema.prisma), this should
  // call it instead of keeping its own copy of the arithmetic.
  const [printJobs, spools, spoolsByStatus, jobsByStatus] = await Promise.all([
    safe(
      prisma.printJob.findMany({
        where: { accountId },
        select: {
          printerAssetId: true,
          status: true,
          salePriceCents: true,
          invoiceId: true,
          printMinutes: true,
          laborMinutes: true,
          machineRateCentsPerHour: true,
          laborRateCentsPerHour: true,
          packagingCostCents: true,
          shippingCostCents: true,
          otherCostCents: true,
          createdAt: true,
          filamentUses: { select: { spoolId: true, grams: true, wasteGrams: true } },
        },
        take: MAX_PRINT_JOBS,
      }),
      [] as {
        printerAssetId: string | null;
        status: string;
        salePriceCents: number | null;
        invoiceId: string | null;
        printMinutes: number | null;
        laborMinutes: number | null;
        machineRateCentsPerHour: number | null;
        laborRateCentsPerHour: number | null;
        packagingCostCents: number | null;
        shippingCostCents: number | null;
        otherCostCents: number | null;
        createdAt: Date;
        filamentUses: { spoolId: string; grams: number; wasteGrams: number }[];
      }[],
    ),
    safe(
      prisma.filamentSpool.findMany({
        where: { accountId },
        select: {
          id: true,
          purchasePriceCents: true,
          totalGrams: true,
          remainingGrams: true,
          status: true,
        },
      }),
      [] as {
        id: string;
        purchasePriceCents: number | null;
        totalGrams: number;
        remainingGrams: number;
        status: string;
      }[],
    ),
    safe(
      prisma.filamentSpool.groupBy({ by: ["status"], where: { accountId }, _count: true }),
      [] as { status: string; _count: number }[],
    ),
    safe(
      prisma.printJob.groupBy({ by: ["status"], where: { accountId }, _count: true }),
      [] as { status: string; _count: number }[],
    ),
  ]);

  const centsPerGram = new Map<string, number>();
  for (const s of spools) {
    if (s.purchasePriceCents && s.totalGrams > 0) {
      centsPerGram.set(s.id, s.purchasePriceCents / s.totalGrams);
    }
  }

  // Revenue prefers the job's own sale price; when the job only points at an
  // invoice, use that invoice's total (scoped to this account, like everything).
  const linkedInvoiceIds = Array.from(
    new Set(
      printJobs.filter((j) => j.salePriceCents == null && j.invoiceId).map((j) => j.invoiceId!),
    ),
  ).slice(0, 500);
  const invoiceTotals = new Map<string, number>(
    linkedInvoiceIds.length === 0
      ? []
      : (
          await safe(
            prisma.invoice.findMany({
              where: { accountId, id: { in: linkedInvoiceIds } },
              select: { id: true, totalCents: true },
            }),
            [] as { id: string; totalCents: number }[],
          )
        ).map((i) => [i.id, i.totalCents] as const),
  );

  type PrinterTally = { revenue: number; cost: number; jobs: number; revenueThisYear: number };
  const perPrinter = new Map<string, PrinterTally>();
  let printRevenueAll = 0;
  let printRevenueYear = 0;
  let printCostAll = 0;
  for (const j of printJobs) {
    if (j.status === "CANCELLED") continue;
    const revenue =
      j.salePriceCents ?? (j.invoiceId ? (invoiceTotals.get(j.invoiceId) ?? 0) : 0);
    const filament = j.filamentUses.reduce(
      (s, u) => s + (centsPerGram.get(u.spoolId) ?? 0) * (u.grams + u.wasteGrams),
      0,
    );
    const machine =
      ((j.printMinutes ?? 0) / 60) *
      (j.machineRateCentsPerHour ?? DEFAULT_MACHINE_RATE_CENTS_PER_HOUR);
    const labor =
      ((j.laborMinutes ?? 0) / 60) * (j.laborRateCentsPerHour ?? DEFAULT_LABOR_RATE_CENTS_PER_HOUR);
    const cost =
      filament +
      machine +
      labor +
      (j.packagingCostCents ?? 0) +
      (j.shippingCostCents ?? 0) +
      (j.otherCostCents ?? 0);
    const thisYear = j.createdAt >= yearStart && j.createdAt < nextYearStart;
    printRevenueAll += revenue;
    printCostAll += cost;
    if (thisYear) printRevenueYear += revenue;
    const key = j.printerAssetId ?? "";
    const tally = perPrinter.get(key) ?? { revenue: 0, cost: 0, jobs: 0, revenueThisYear: 0 };
    tally.revenue += revenue;
    tally.cost += cost;
    tally.jobs += 1;
    if (thisYear) tally.revenueThisYear += revenue;
    perPrinter.set(key, tally);
  }

  const printerIds = Array.from(perPrinter.keys()).filter((k) => k !== "");
  const printerNames = new Map<string, string>(
    printerIds.length === 0
      ? []
      : (
          await safe(
            prisma.asset.findMany({
              where: { accountId, id: { in: printerIds } },
              select: { id: true, name: true },
            }),
            [] as { id: string; name: string }[],
          )
        ).map((a) => [a.id, a.name] as const),
  );

  // ——— Equipment ————————————————————————————————————————————————————————
  const assetsByKind = await safe(
    prisma.asset.groupBy({
      by: ["kind"],
      where: { accountId, status: "ACTIVE" },
      _count: true,
      orderBy: { _count: { kind: "desc" } },
      take: 8,
    }),
    [] as { kind: string; _count: number }[],
  );

  // ——— Household (personal — deliberately separate books) ————————————————
  const [householdMonth, householdYear, householdByCategory, householdBudget] = await Promise.all([
    safe(
      prisma.householdExpense.aggregate({
        where: { accountId, kind: { not: "INCOME" }, date: { gte: monthStart } },
        _sum: { amountCents: true },
        _count: true,
      }),
      { _sum: { amountCents: null }, _count: 0 },
    ),
    safe(
      prisma.householdExpense.aggregate({
        where: { accountId, kind: { not: "INCOME" }, date: { gte: yearStart, lt: nextYearStart } },
        _sum: { amountCents: true },
        _count: true,
      }),
      { _sum: { amountCents: null }, _count: 0 },
    ),
    safe(
      prisma.householdExpense.groupBy({
        by: ["category"],
        where: { accountId, kind: { not: "INCOME" }, date: { gte: yearStart, lt: nextYearStart } },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
        take: TOP_HOUSEHOLD_CATEGORIES,
      }),
      [] as { category: string; _sum: { amountCents: number | null } }[],
    ),
    safe(
      prisma.householdBudget.aggregate({
        where: { accountId },
        _sum: { monthlyCents: true },
        _count: true,
      }),
      { _sum: { monthlyCents: null }, _count: 0 },
    ),
  ]);

  // ——— Assemble ——————————————————————————————————————————————————————————
  const businessName = profile?.name ?? "This business";

  const shownCategories = catThis.slice(0, TOP_CATEGORIES);
  const otherCategoriesTotal = catThis
    .slice(TOP_CATEGORIES)
    .reduce((s, c) => s + (c._sum.amountCents ?? 0), 0);

  const sections: (SnapshotSection | null)[] = [
    section("Business totals", [
      row(`Revenue so far in ${year}`, money(revenueYtd)),
      row(`Expenses so far in ${year}`, money(expensesYtd)),
      row(`Profit so far in ${year}`, money(netYtd)),
      row(`This month (${MONTHS[now.getMonth()]})`, `${money(thisMonth.revenue)} in, ${money(thisMonth.expenses)} out, ${money(thisMonth.revenue - thisMonth.expenses)} profit`),
      lastMonth
        ? row(
            `Last month (${MONTHS[lastMonthIdx]})`,
            `${money(lastMonth.revenue)} in, ${money(lastMonth.expenses)} out, ${money(lastMonth.revenue - lastMonth.expenses)} profit`,
          )
        : null,
      row(`All of ${lastYear}`, `${money(lastYearRevenue)} in, ${money(lastYearExpenses)} out, ${money(lastYearRevenue - lastYearExpenses)} profit`),
      row(`Expense entries recorded in ${year}`, expenseCount),
    ]),

    section(
      "Tax set-aside",
      [
        row("Rough planning number (25% of this year's profit)", money(setAside)),
        row("Money actually set aside", "not tracked in this app"),
      ],
      "A planning figure only — not a tax calculation and not tax advice.",
    ),

    section(
      `Month by month, ${year}`,
      byMonth
        .slice(0, now.getMonth() + 1)
        .map((b, i) =>
          b.revenue === 0 && b.expenses === 0
            ? null
            : row(MONTHS[i], `${money(b.revenue)} in, ${money(b.expenses)} out, ${money(b.revenue - b.expenses)} profit`),
        ),
    ),

    section(
      `Expenses by category, ${year}`,
      [
        ...shownCategories.map((c) => {
          const thisYearTotal = c._sum.amountCents ?? 0;
          const prior = lastYearByCategory.get(c.accountingCategory) ?? 0;
          const priorNote = prior > 0 ? ` (${money(prior)} in ${lastYear})` : "";
          return row(
            c.accountingCategory,
            `${money(thisYearTotal)} across ${count(c._count, "entry", "entries")}${priorNote}`,
          );
        }),
        otherCategoriesTotal > 0
          ? row("Everything else", `${money(otherCategoriesTotal)} across smaller categories`)
          : null,
      ],
      "Categories are bookkeeping labels, not tax rulings.",
    ),

    section(
      `Expenses by part of the business, ${year}`,
      byDivision.map((d) => row(divisionLabel(d.division), money(d._sum.amountCents ?? 0))),
    ),

    section(
      `Revenue by category, ${year}`,
      incomeByCategory.map((c) => row(c.category, money(c._sum.amountCents ?? 0))),
    ),

    section(
      `Who you spend the most with, ${year}`,
      topVendors.map((v) =>
        row(
          v.vendorName ?? "Unnamed vendor",
          `${money(v._sum.amountCents ?? 0)} across ${count(v._count, "purchase")}`,
        ),
      ),
    ),

    section(`Invoices and money owed to you`, [
      row("Unpaid invoices you've sent", `${awaitingCount} totalling ${money(outstandingCents)}`),
      overdueCount > 0
        ? row("Past their due date", `${overdueCount} totalling ${money(overdueCents)}`)
        : null,
      draftCount > 0 ? row("Draft invoices not sent yet", draftCount) : null,
      customerCount > 0 ? row("Customers on file", customerCount) : null,
    ]),

    section(
      `Biggest customers, ${year}`,
      invoicedByCustomer.map((c) =>
        row(
          customerNames.get(c.customerId) ?? "Unnamed customer",
          `${money(c._sum.totalCents ?? 0)} invoiced across ${count(c._count, "invoice")}`,
        ),
      ),
    ),

    section("Things flagged for a look", [
      needsReview._count > 0
        ? row(
            "Expenses waiting on tax review",
            `${needsReview._count} totalling ${money(needsReview._sum.amountCents ?? 0)}`,
          )
        : null,
      missingReceipts > 0 ? row("Expenses with no receipt attached", missingReceipts) : null,
      inboxCount > 0 ? row("Receipts sitting in the Inbox, not sorted yet", inboxCount) : null,
      capital._count > 0
        ? row(
            `Big purchases flagged in ${year}`,
            `${capital._count} totalling ${money(capital._sum.amountCents ?? 0)} — the accountant decides how these are handled`,
          )
        : null,
      unmatchedBank > 0 ? row("Bank transactions not matched to a record", unmatchedBank) : null,
    ]),

    section(`Mileage and equipment, ${year}`, [
      mileage._count > 0
        ? row(
            "Business miles logged",
            `${(mileage._sum.miles ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} miles across ${count(mileage._count, "trip")}`,
          )
        : null,
      maintenance._count > 0
        ? row(
            "Repairs and maintenance recorded",
            `${count(maintenance._count, "record")} costing ${money((maintenance._sum.partsCostCents ?? 0) + (maintenance._sum.laborCostCents ?? 0))}`,
          )
        : null,
      ...assetsByKind.map((a) => row(`Equipment on the books — ${a.kind}`, a._count)),
    ]),

    section("The flock", [
      ...animalsByStatus.map((a) => row(`Animals — ${a.status.toLowerCase()}`, a._count)),
      ...activeBySpecies.map((s) => row(`In the flock — ${s.species}`, s._count)),
      ...activeBySex.map((s) => row(`In the flock — ${s.sex.toLowerCase()}s`, s._count)),
      lambingYear._count > 0
        ? row(
            `Lambing in ${year}`,
            `${count(lambingYear._count, "lambing")} recorded, ${lambingYear._sum.lambCount ?? 0} lambs counted`,
          )
        : null,
      lambingSpring._count > 0
        ? row(
            `Lambing this spring (March–May ${year})`,
            `${count(lambingSpring._count, "lambing")} recorded, ${lambingSpring._sum.lambCount ?? 0} lambs counted`,
          )
        : null,
      bornThisYear > 0 ? row(`Animals with a ${year} birth date on file`, bornThisYear) : null,
      bornSpring > 0 ? row(`Born March–May ${year}`, bornSpring) : null,
      salesThisYear._count > 0
        ? row(
            `Livestock sold in ${year}`,
            `${count(salesThisYear._count, "sale")} for ${money(salesThisYear._sum.salePriceCents ?? 0)}`,
          )
        : null,
      salesLastYear._count > 0
        ? row(
            `Livestock sold in ${lastYear}`,
            `${count(salesLastYear._count, "sale")} for ${money(salesLastYear._sum.salePriceCents ?? 0)}`,
          )
        : null,
    ]),

    section(
      "3D printing",
      [
        printJobs.length > 0
          ? row("Print jobs on file", `${printJobs.length}${printJobs.length >= MAX_PRINT_JOBS ? " (most recent only)" : ""}`)
          : null,
        ...jobsByStatus.map((j) => row(`Print jobs — ${j.status.toLowerCase()}`, j._count)),
        printRevenueAll > 0 ? row("Print job revenue, all time", money(printRevenueAll)) : null,
        printRevenueYear > 0 ? row(`Print job revenue, ${year}`, money(printRevenueYear)) : null,
        printCostAll > 0
          ? row("Estimated print job costs, all time", `${money(Math.round(printCostAll))} (filament, machine time, labor, packaging and shipping)`)
          : null,
        ...Array.from(perPrinter.entries())
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .map(([id, t]) =>
            row(
              `Printer — ${id === "" ? "no printer recorded on the job" : (printerNames.get(id) ?? "Unnamed printer")}`,
              `${money(t.revenue)} earned across ${count(t.jobs, "job")}, about ${money(Math.round(t.cost))} of estimated cost, ${money(Math.round(t.revenue - t.cost))} left over`,
            ),
          ),
        spools.length > 0
          ? row(
              "Filament spools",
              `${spools.length} on file, ${Math.round(spools.reduce((s, x) => s + x.remainingGrams, 0)).toLocaleString("en-US")} g left`,
            )
          : null,
        ...spoolsByStatus.map((s) => row(`Spools — ${s.status.toLowerCase().replace("_", " ")}`, s._count)),
      ],
      "Printer costs are estimates built from the rates and filament use recorded on each job.",
    ),

    section(
      "Household (personal money, kept out of the business books)",
      [
        householdMonth._count > 0
          ? row("Personal spending this month", money(householdMonth._sum.amountCents ?? 0))
          : null,
        householdYear._count > 0
          ? row(`Personal spending in ${year}`, money(householdYear._sum.amountCents ?? 0))
          : null,
        householdBudget._count > 0
          ? row("Monthly household budget set", money(householdBudget._sum.monthlyCents ?? 0))
          : null,
        ...householdByCategory.map((c) =>
          row(`Household — ${c.category}`, money(c._sum.amountCents ?? 0)),
        ),
      ],
      "Personal spending. Never part of business totals and never part of anything tax-related.",
    ),
  ];

  const kept = sections.filter((s): s is SnapshotSection => s !== null);
  const generatedAt = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const header = [
    `${businessName} — bookkeeping snapshot`,
    `Today is ${generatedAt}. The current tax year is ${year}. Every amount is US dollars.`,
    `Anything not listed below is something you do not know.`,
  ].join("\n");

  const body = kept
    .map((s) => {
      const note = s.note ? `\n(${s.note})` : "";
      return `## ${s.title}${note}\n${s.rows.map((r) => `- ${r.label}: ${r.value}`).join("\n")}`;
    })
    .join("\n\n");

  let text = `${header}\n\n${body}`;
  if (text.length > MAX_SNAPSHOT_CHARS) {
    text = `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n\n(Snapshot trimmed here — some smaller totals were left out.)`;
  }

  return {
    businessName,
    year,
    lastYear,
    generatedAt,
    headline: {
      revenueYtdCents: revenueYtd,
      expensesYtdCents: expensesYtd,
      netYtdCents: netYtd,
      setAsideCents: setAside,
    },
    sections: kept,
    text,
  };
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

export type AssistantTurn = { role: "user" | "assistant"; content: string };
export type AssistantReply = { answer: string; error?: never } | { answer?: never; error: string };

function systemPrompt(snapshotText: string): string {
  return `You are the bookkeeping assistant built into Twin Oaks OS, the app this business keeps its books in. You are talking to the owner about his own records. He is not an accountant and does not want jargon.

WHAT YOU KNOW
A snapshot of his numbers is at the end of this message, under THE NUMBERS. It was added up from his own records the moment he asked. It is everything you know. You cannot look anything else up, you cannot open a record, and you do not remember other conversations.

HOW TO ANSWER
- Answer only from THE NUMBERS. Never estimate, never work a figure out from something close to it, and never invent one. If two numbers in the snapshot do not add up to what he asked for, say what you do have instead of doing arithmetic he did not ask for.
- If the snapshot does not contain the answer, say so plainly in one sentence and, when you can, name the page in the app where it lives ("that one's on the Equipment page"). Do not guess. Do not apologise at length.
- Give real dollar amounts, written the way the snapshot writes them ($1,234.56).
- Two to four short sentences answers almost every question. No bullet lists unless he asks for a list. No headings, no tables, no markdown, no emoji.
- Plain English, the way you would say it out loud. "What you spent", not "expenditures". "Money still owed to you", not "accounts receivable".
- Sound like a steady, experienced bookkeeper sitting at the kitchen table: direct, warm, unhurried. Not a chatbot. No "Great question", no "Certainly", no offering to help with anything else.
- If a number is genuinely worth a second look — a category that doubled, a big pile of unmatched bank lines, invoices well past due — you may say so in one sentence.

TAXES — HOLD THIS LINE
This app organizes and flags. It never decides. So:
- Never say that something is deductible, a write-off, claimable, or a business expense for tax purposes. Never say something is NOT deductible either. That call belongs to his accountant, always.
- You may explain what a bookkeeping category generally holds ("Feed is where hay, grain and minerals get filed").
- You may say that something is worth asking his accountant about, and you should say it whenever tax treatment is the real question behind what he asked.
- The tax set-aside figure in the snapshot is a rough planning number (a quarter of this year's profit), not a tax calculation. Say that whenever you use it. The app does not know what he has actually put aside, so do not imply that it does.
- Never tell him what to file, when to file, or what he owes.

WHAT YOU MUST NOT DO
- The household numbers are his personal spending and are deliberately kept out of the business books. Never add them into a business total and never bring them into anything tax-related.
- You cannot add, change, delete, send or finalize anything. If he asks you to, tell him which page in the app does it.

THE NUMBERS
${snapshotText}`;
}

// Keep the conversation window short (cost) and well-formed (the API wants
// the first message to be from the user).
function trimHistory(history: AssistantTurn[]): AssistantTurn[] {
  const clean = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .map((t) => ({ role: t.role, content: t.content.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS) }))
    .filter((t) => t.content.length > 0);
  const window = clean.slice(-MAX_HISTORY_MESSAGES);
  while (window.length > 0 && window[0].role !== "user") window.shift();
  return window;
}

function friendlyApiError(status: number): string {
  if (status === 401 || status === 403) {
    return "The assistant's key isn't working. Nothing's wrong with your books — this one is for whoever set the app up.";
  }
  if (status === 429) {
    return "The assistant is busy right now. Give it a minute and ask again.";
  }
  if (status === 529 || status >= 500) {
    return "The assistant is having trouble on its end. Try again in a minute.";
  }
  return "The assistant couldn't answer that one. Try asking it a different way.";
}

/**
 * Ask the model a question about the snapshot. NEVER throws — every failure
 * comes back as { error } in words the owner can read.
 */
export async function askAssistant(
  snapshot: AssistantSnapshot,
  question: string,
  history: AssistantTurn[] = [],
): Promise<AssistantReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: ASSISTANT_NOT_CONFIGURED };

  const asked = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (asked.length < 2) return { error: "Type a question first." };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_ANSWER_TOKENS,
        temperature: 0,
        system: systemPrompt(snapshot.text),
        messages: [...trimHistory(history), { role: "user", content: asked }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[assistant] API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { error: friendlyApiError(res.status) };
    }

    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const answer = (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!answer) {
      return { error: "The assistant came back empty-handed. Try asking it a different way." };
    }
    return { answer };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("[assistant] question failed:", e);
    return {
      error: timedOut
        ? "That took too long and stopped. Try asking again — shorter questions come back faster."
        : "Couldn't reach the assistant just now. Check your connection and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Rate limit — cost control, per account
// ---------------------------------------------------------------------------
//
// In-memory on purpose: one small app, one server process. A multi-replica
// deploy would need this in Redis (or any shared store) instead — each
// replica currently keeps its own count, so the real ceiling there is
// ASK_LIMIT × replicas.

const ASK_LIMIT = 15;
const ASK_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_ACCOUNTS = 500;
const askLog = new Map<string, number[]>();

export type RateLimitResult = { ok: true } | { ok: false; error: string; retryAfterSeconds: number };

export function takeAssistantTurn(accountId: string): RateLimitResult {
  const now = Date.now();

  // Housekeeping so the map can't grow without bound on a long-lived process.
  if (askLog.size > MAX_TRACKED_ACCOUNTS) {
    for (const [key, times] of askLog) {
      if (times.every((t) => now - t >= ASK_WINDOW_MS)) askLog.delete(key);
    }
  }

  const recent = (askLog.get(accountId) ?? []).filter((t) => now - t < ASK_WINDOW_MS);
  if (recent.length >= ASK_LIMIT) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(60, Math.ceil((ASK_WINDOW_MS - (now - oldest)) / 1000));
    askLog.set(accountId, recent);
    return {
      ok: false,
      retryAfterSeconds,
      error: `That's ${ASK_LIMIT} questions in an hour — the assistant needs a breather. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
    };
  }

  recent.push(now);
  askLog.set(accountId, recent);
  return { ok: true };
}

export const ASSISTANT_EXAMPLE_QUESTIONS = [
  "What did I spend on feed this year?",
  "What's my biggest expense category?",
  "Which printer made the most money?",
  "How many lambs were born this spring?",
  "Who owes me money right now?",
  "Am I set aside enough for taxes?",
] as const;
