// Twin Oaks OS — job costing for the print shop (SPEC §§12, 15, 30).
//
// ─────────────────────────────────────────────────────────────────────────
// HOW A PRINT JOB IS COSTED — in plain words
//
//   "What did this job really cost me, and did I make money on it?"
//
//   1. FILAMENT.  Every spool has a price and a weight, so it has a price
//      per gram. A job costs the grams it pulled off each spool. Waste
//      grams — purge towers, brims, skirts, a nozzle clog — came off the
//      same spool and cost the same money, so they are charged too.
//   2. PRINTER TIME.  Hours on the machine × your machine rate. That rate
//      is what the printer costs you to run for an hour (power, wear,
//      nozzles, eventually replacing it). Defaults to $0.50/hr; change it
//      per job when you want.
//   3. YOUR LABOR.  Hands-on minutes × your hourly rate — modeling, plate
//      prep, supports, sanding, packing. Defaults to $25/hr. Your time is
//      not free and this app will not pretend it is.
//   4. PACKAGING, SHIPPING, ANYTHING ELSE.  Typed in per job.
//
//   Add those up and you have the TOTAL COST. Sale price minus total cost
//   is the PROFIT. Profit ÷ quantity is the PROFIT PER PART.
//
//   FAILED PRINTS. Type in the print time and the grams you actually
//   burned — failures included — because that is money you actually spent.
//   Profit per part is then divided by the parts you can actually SELL
//   (quantity), never by the attempts. So a job with failures does not
//   hide them: the same cost is spread over fewer good parts and the
//   per-part profit drops. `failedPrintCostCents` puts a dollar figure on
//   exactly that share so it can be shown out loud, never buried.
//
// EVERY number here is integer cents. Fractional money (price per gram,
// a rate per minute) is turned into cents with Math.round as early as
// possible and only whole cents are ever added together. Nothing in this
// file can return NaN: a missing, negative, or nonsense input reads as
// zero, and a missing rate falls back to the domain default.
// ─────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_LABOR_RATE_CENTS_PER_HOUR,
  DEFAULT_MACHINE_RATE_CENTS_PER_HOUR,
} from "@/lib/domain";

// ── Shapes ───────────────────────────────────────────────────────────────
// Deliberately structural (not Prisma types) so these stay pure functions
// that can be handed a row, a form draft, or a test fixture.

export type CostedSpool = {
  purchasePriceCents?: number | null;
  totalGrams?: number | null;
};

export type CostedFilamentUse = {
  grams?: number | null;
  wasteGrams?: number | null;
  spool?: CostedSpool | null;
};

export type CostedJob = {
  quantity?: number | null;
  failedCount?: number | null;
  printMinutes?: number | null;
  laborMinutes?: number | null;
  machineRateCentsPerHour?: number | null;
  laborRateCentsPerHour?: number | null;
  packagingCostCents?: number | null;
  shippingCostCents?: number | null;
  otherCostCents?: number | null;
  salePriceCents?: number | null;
  status?: string | null;
};

export type CostBreakdown = {
  materialCents: number;
  machineCents: number;
  laborCents: number;
  packagingCents: number;
  shippingCents: number;
  otherCents: number;
  totalCents: number;
};

export type JobProfit = {
  totalCostCents: number;
  salePriceCents: number;
  profitCents: number;
  profitPerPartCents: number;
  marginPercent: number;
};

// ── Number safety ────────────────────────────────────────────────────────

/** Any missing/NaN/Infinite value reads as 0. Nothing downstream can go NaN. */
function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Costs and weights are never negative — a typo can't create money. */
function atLeastZero(value: number | null | undefined): number {
  const n = finite(value);
  return n > 0 ? n : 0;
}

/** Whole cents, always. */
function cents(value: number | null | undefined): number {
  return Math.round(atLeastZero(value));
}

/** An unset rate falls back to the shop default; 0 is a real, allowed rate. */
function rateOrDefault(rate: number | null | undefined, fallback: number): number {
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : fallback;
}

// ── The four cost pieces ─────────────────────────────────────────────────

/** Printer time in minutes × the machine rate per hour → cents. */
export function machineCostCents(
  printMinutes: number | null | undefined,
  ratePerHour: number | null | undefined,
): number {
  const minutes = atLeastZero(printMinutes);
  const rate = rateOrDefault(ratePerHour, DEFAULT_MACHINE_RATE_CENTS_PER_HOUR);
  return Math.round((minutes * rate) / 60);
}

/** Hands-on minutes × your hourly rate → cents. */
export function laborCostCents(
  laborMinutes: number | null | undefined,
  ratePerHour: number | null | undefined,
): number {
  const minutes = atLeastZero(laborMinutes);
  const rate = rateOrDefault(ratePerHour, DEFAULT_LABOR_RATE_CENTS_PER_HOUR);
  return Math.round((minutes * rate) / 60);
}

/**
 * What one gram off this spool cost — a fraction of a cent, kept as a float
 * ONLY here and immediately rounded into cents by the caller. A spool with
 * no price or no weight costs nothing (we can't invent a number).
 */
export function centsPerGram(spool: CostedSpool | null | undefined): number {
  if (!spool) return 0;
  const price = atLeastZero(spool.purchasePriceCents);
  const grams = atLeastZero(spool.totalGrams);
  if (price === 0 || grams === 0) return 0;
  return price / grams;
}

/** What one filament use cost: (grams + waste grams) × that spool's price per gram. */
export function filamentUseCostCents(use: CostedFilamentUse | null | undefined): number {
  if (!use) return 0;
  // Waste came off the same spool as the part did — it cost the same money.
  const grams = atLeastZero(use.grams) + atLeastZero(use.wasteGrams);
  if (grams === 0) return 0;
  return Math.round(grams * centsPerGram(use.spool));
}

/** Total filament money on a job — each use rounded to cents, then summed. */
export function materialCostCents(
  filamentUses: readonly (CostedFilamentUse | null | undefined)[] | null | undefined,
): number {
  if (!filamentUses) return 0;
  let total = 0;
  for (const use of filamentUses) total += filamentUseCostCents(use);
  return total;
}

/** Grams pulled off spools for a job — parts plus waste. */
export function totalGramsUsed(
  filamentUses: readonly (CostedFilamentUse | null | undefined)[] | null | undefined,
): number {
  if (!filamentUses) return 0;
  let grams = 0;
  for (const use of filamentUses) {
    grams += atLeastZero(use?.grams) + atLeastZero(use?.wasteGrams);
  }
  return grams;
}

// ── The whole job ────────────────────────────────────────────────────────

/** Every line of what a job cost, in cents. */
export function jobCostBreakdown(
  job: CostedJob | null | undefined,
  uses: readonly (CostedFilamentUse | null | undefined)[] | null | undefined,
): CostBreakdown {
  const materialCents = materialCostCents(uses);
  const machineCents = machineCostCents(job?.printMinutes, job?.machineRateCentsPerHour);
  const laborCents = laborCostCents(job?.laborMinutes, job?.laborRateCentsPerHour);
  const packagingCents = cents(job?.packagingCostCents);
  const shippingCents = cents(job?.shippingCostCents);
  const otherCents = cents(job?.otherCostCents);
  return {
    materialCents,
    machineCents,
    laborCents,
    packagingCents,
    shippingCents,
    otherCents,
    totalCents:
      materialCents + machineCents + laborCents + packagingCents + shippingCents + otherCents,
  };
}

/** Good parts you can actually sell. Never below 1 for per-part math. */
function sellableParts(job: CostedJob | null | undefined): number {
  const q = Math.trunc(finite(job?.quantity));
  return q > 0 ? q : 1;
}

/** Parts attempted — the good ones plus the ones that failed. */
export function attemptedParts(job: CostedJob | null | undefined): number {
  const good = Math.max(0, Math.trunc(finite(job?.quantity)));
  const failed = Math.max(0, Math.trunc(finite(job?.failedCount)));
  const total = good + failed;
  return total > 0 ? total : 1;
}

/** Cost, sale price, profit, profit per part, margin — the whole answer. */
export function jobProfit(
  job: CostedJob | null | undefined,
  uses: readonly (CostedFilamentUse | null | undefined)[] | null | undefined,
): JobProfit {
  const totalCostCents = jobCostBreakdown(job, uses).totalCents;
  const salePriceCents = cents(job?.salePriceCents);
  const profitCents = salePriceCents - totalCostCents;
  // Divided by the parts that can be SOLD — failures make each good part
  // carry more of the cost instead of quietly disappearing.
  const profitPerPartCents = Math.round(profitCents / sellableParts(job));
  const marginPercent =
    salePriceCents > 0 ? Math.round((profitCents / salePriceCents) * 1000) / 10 : 0;
  return { totalCostCents, salePriceCents, profitCents, profitPerPartCents, marginPercent };
}

/**
 * The dollars this job spent on prints that failed — the failures' share of
 * the total cost. Shown out loud on the job page and in the report so a bad
 * print night is never invisible (SPEC §30, "Failed print cost").
 */
export function failedPrintCostCents(
  job: CostedJob | null | undefined,
  uses: readonly (CostedFilamentUse | null | undefined)[] | null | undefined,
): number {
  const failed = Math.max(0, Math.trunc(finite(job?.failedCount)));
  if (failed === 0) return 0;
  const total = jobCostBreakdown(job, uses).totalCents;
  return Math.round((total * failed) / attemptedParts(job));
}

// ── Rollups for the production report ────────────────────────────────────

export type RollupJob = CostedJob & {
  id: string;
  partName?: string | null;
  printerAssetId?: string | null;
};

export type RollupUse = CostedFilamentUse & { printJobId: string };

/** Group filament uses by the job they belong to. */
export function usesByJob(
  uses: readonly RollupUse[] | null | undefined,
): Map<string, RollupUse[]> {
  const map = new Map<string, RollupUse[]>();
  for (const use of uses ?? []) {
    if (!use || typeof use.printJobId !== "string") continue;
    const list = map.get(use.printJobId);
    if (list) list.push(use);
    else map.set(use.printJobId, [use]);
  }
  return map;
}

export type JobsSummary = {
  jobs: number;
  jobsCompleted: number;
  parts: number;
  failedParts: number;
  printHours: number;
  gramsUsed: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  failedCostCents: number;
  profitPerPartCents: number;
};

const COMPLETED_STATUSES = new Set(["DONE", "SHIPPED"]);

/** Totals across any set of jobs — powers the header numbers and the report. */
export function summarizeJobs(
  jobs: readonly RollupJob[] | null | undefined,
  uses: readonly RollupUse[] | null | undefined,
): JobsSummary {
  const byJob = usesByJob(uses);
  const summary: JobsSummary = {
    jobs: 0,
    jobsCompleted: 0,
    parts: 0,
    failedParts: 0,
    printHours: 0,
    gramsUsed: 0,
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    failedCostCents: 0,
    profitPerPartCents: 0,
  };

  let printMinutes = 0;
  for (const job of jobs ?? []) {
    if (!job) continue;
    const jobUses = byJob.get(job.id) ?? [];
    const money = jobProfit(job, jobUses);
    summary.jobs += 1;
    if (job.status != null && COMPLETED_STATUSES.has(job.status)) summary.jobsCompleted += 1;
    summary.parts += Math.max(0, Math.trunc(finite(job.quantity)));
    summary.failedParts += Math.max(0, Math.trunc(finite(job.failedCount)));
    printMinutes += atLeastZero(job.printMinutes);
    summary.gramsUsed += totalGramsUsed(jobUses);
    summary.revenueCents += money.salePriceCents;
    summary.costCents += money.totalCostCents;
    summary.profitCents += money.profitCents;
    summary.failedCostCents += failedPrintCostCents(job, jobUses);
  }

  summary.printHours = Math.round((printMinutes / 60) * 10) / 10;
  summary.gramsUsed = Math.round(summary.gramsUsed);
  summary.profitPerPartCents =
    summary.parts > 0 ? Math.round(summary.profitCents / summary.parts) : 0;
  return summary;
}

export type PrinterRollupRow = JobsSummary & { printerAssetId: string | null };

/**
 * Per-printer production: jobs, jobs completed, print hours, revenue, cost,
 * profit. Jobs with no printer set fall into a single "not recorded" bucket
 * so no money can go missing. Pass in the jobs you want counted — cancelled
 * jobs are the caller's call, not this function's.
 */
export function printerRollup(
  jobs: readonly RollupJob[] | null | undefined,
  uses: readonly RollupUse[] | null | undefined,
): PrinterRollupRow[] {
  const groups = new Map<string, RollupJob[]>();
  for (const job of jobs ?? []) {
    if (!job) continue;
    const key = job.printerAssetId ?? "";
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }

  const rows: PrinterRollupRow[] = [];
  for (const [key, groupJobs] of groups) {
    rows.push({ printerAssetId: key === "" ? null : key, ...summarizeJobs(groupJobs, uses) });
  }
  // Best earner first — that's the question the owner is actually asking.
  rows.sort((a, b) => b.profitCents - a.profitCents);
  return rows;
}

export type PartRollupRow = JobsSummary & { partName: string };

/** Per-part production, most profitable first — "which parts are worth printing?" */
export function partRollup(
  jobs: readonly RollupJob[] | null | undefined,
  uses: readonly RollupUse[] | null | undefined,
): PartRollupRow[] {
  const groups = new Map<string, RollupJob[]>();
  for (const job of jobs ?? []) {
    if (!job) continue;
    const key = (job.partName ?? "").trim() || "Unnamed part";
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }

  const rows: PartRollupRow[] = [];
  for (const [partName, groupJobs] of groups) {
    rows.push({ partName, ...summarizeJobs(groupJobs, uses) });
  }
  rows.sort((a, b) => b.profitCents - a.profitCents);
  return rows;
}
