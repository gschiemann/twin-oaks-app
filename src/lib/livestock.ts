// Twin Oaks OS — flock math (SPEC §§22–24).
//
// Pure functions only: no React, no Prisma, no hidden clock. Every function
// that needs "today" takes it as an argument with a default, so the whole
// file is unit-testable. Money is integer cents, start to finish.

import { ANIMAL_EVENT_FIELDS, GESTATION_DAYS, type AnimalEventKind } from "@/lib/domain";

const MS_PER_DAY = 86_400_000;

// ————————————————————————— identity —————————————————————————

/** "#114 — Bella", or just "#114" when the animal has no name. */
export function animalLabel(animal: { tagNumber: string; name?: string | null }): string {
  return animal.name ? `#${animal.tagNumber} — ${animal.name}` : `#${animal.tagNumber}`;
}

/** Row-sized sex word. The domain labels spell out "(female)" — too long here. */
export function sexShortLabel(sex: string): string {
  if (sex === "EWE") return "Ewe";
  if (sex === "RAM") return "Ram";
  if (sex === "WETHER") return "Wether";
  return sex;
}

/** Tags sort the way a shepherd reads them: 2, 9, 10 — not 10, 2, 9. */
export function compareTags(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** Flock search: tag number or name, case-insensitive, partial match. */
export function matchesAnimalSearch(
  animal: { tagNumber: string; name?: string | null },
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (q === "") return true;
  return (
    animal.tagNumber.toLowerCase().includes(q) || (animal.name ?? "").toLowerCase().includes(q)
  );
}

// ————————————————————————— age —————————————————————————

export function ageInDays(
  birthDate: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birthDate) return null;
  return Math.floor((now.getTime() - birthDate.getTime()) / MS_PER_DAY);
}

/** Whole calendar months between two dates (never negative-rounded oddly). */
export function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

/**
 * Age the way it gets said out loud: "6 days", "8 mo", "3 yrs".
 * No birth date on file reads "—", never "0".
 */
export function ageLabel(birthDate: Date | null | undefined, now: Date = new Date()): string {
  const days = ageInDays(birthDate, now);
  if (birthDate == null || days == null || days < 0) return "—";
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.max(0, monthsBetween(birthDate, now));
  if (months < 1) return `${days} days`;
  if (months < 24) return months === 1 ? "1 mo" : `${months} mo`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 yr" : `${years} yrs`;
}

/** True when the animal was born in the given calendar year. */
export function bornInYear(birthDate: Date | null | undefined, year: number): boolean {
  return birthDate != null && birthDate.getFullYear() === year;
}

// ————————————————————————— dates —————————————————————————

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Expected lambing date for a breeding on `date` (sheep gestation). */
export function dueDateFrom(date: Date): Date {
  return addDays(date, GESTATION_DAYS);
}

/**
 * Same math on an <input type="date"> string ("2026-08-22" → "2027-01-16"),
 * so the form can suggest a due date without shipping a Date to the browser.
 * Returns "" for anything that isn't a date input value.
 */
export function addDaysToDateInput(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [y, m, d] = value.split("-").map(Number);
  const out = new Date(y, m - 1, d + days, 12, 0, 0);
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  return `${out.getFullYear()}-${mm}-${dd}`;
}

// ————————————————————————— events —————————————————————————

/** Which optional fields an event kind actually uses (domain.ts is the list). */
export function eventUsesField(kind: AnimalEventKind, field: string): boolean {
  return (ANIMAL_EVENT_FIELDS[kind] ?? []).includes(field);
}

export type WithdrawalEvent = {
  withdrawalUntil?: Date | null;
  productName?: string | null;
  kind?: string;
};

export type ActiveWithdrawal = { until: Date; productName: string | null };

/**
 * The legal safeguard: if any treatment carries a withdrawal date still in
 * the future, this animal must not go for meat yet. The LATEST date wins —
 * two treatments mean the longer one governs.
 */
export function activeWithdrawal(
  events: WithdrawalEvent[],
  now: Date = new Date(),
): ActiveWithdrawal | null {
  let found: ActiveWithdrawal | null = null;
  for (const e of events) {
    const until = e.withdrawalUntil;
    if (!until || until.getTime() <= now.getTime()) continue;
    if (!found || until.getTime() > found.until.getTime()) {
      found = { until, productName: e.productName ?? null };
    }
  }
  return found;
}

// ————————————————————————— money —————————————————————————

export type AnimalCostInput = {
  acquisitionCostCents?: number | null;
  /** Expense rows pinned to this animal (Expense.animalId). */
  expenseCents?: number | null;
  /** What the animal's own events cost (AnimalEvent.costCents). */
  eventCostCents?: number | null;
};

export type AnimalCostBreakdown = {
  acquisitionCents: number;
  expenseCents: number;
  eventCents: number;
  totalCents: number;
};

export function animalCostBreakdown(input: AnimalCostInput): AnimalCostBreakdown {
  const acquisitionCents = input.acquisitionCostCents ?? 0;
  const expenseCents = input.expenseCents ?? 0;
  const eventCents = input.eventCostCents ?? 0;
  return {
    acquisitionCents,
    expenseCents,
    eventCents,
    totalCents: acquisitionCents + expenseCents + eventCents,
  };
}

/** Everything this animal has cost so far, in cents. */
export function animalCostCents(input: AnimalCostInput): number {
  return animalCostBreakdown(input).totalCents;
}

/** Sale price minus everything the animal cost. Negative means it lost money. */
export function saleProfitCents(salePriceCents: number, costCents: number): number {
  return salePriceCents - costCents;
}

/** Whole cents per head; null when there are no head to divide by. */
export function costPerHeadCents(totalCents: number, head: number): number | null {
  if (head <= 0) return null;
  return Math.round(totalCents / head);
}

export function sumCents(values: (number | null | undefined)[]): number {
  return values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

// ————————————————————————— flock —————————————————————————

export type FlockAnimal = {
  sex: string;
  status: string;
  birthDate?: Date | null;
};

export type FlockStats = {
  total: number;
  inFlock: number;
  ewes: number;
  rams: number;
  wethers: number;
  sold: number;
  died: number;
  lambsThisYear: number;
};

/**
 * Head counts for the top of the flock list. "In the flock" means ACTIVE —
 * sold and dead animals stay in the records but not in the count.
 */
export function flockStats(animals: FlockAnimal[], now: Date = new Date()): FlockStats {
  const year = now.getFullYear();
  const stats: FlockStats = {
    total: animals.length,
    inFlock: 0,
    ewes: 0,
    rams: 0,
    wethers: 0,
    sold: 0,
    died: 0,
    lambsThisYear: 0,
  };
  for (const a of animals) {
    if (a.status === "SOLD") stats.sold += 1;
    if (a.status === "DECEASED") stats.died += 1;
    if (bornInYear(a.birthDate, year)) stats.lambsThisYear += 1;
    if (a.status !== "ACTIVE") continue;
    stats.inFlock += 1;
    if (a.sex === "EWE") stats.ewes += 1;
    else if (a.sex === "RAM") stats.rams += 1;
    else if (a.sex === "WETHER") stats.wethers += 1;
  }
  return stats;
}

// ————————————————————————— lambing —————————————————————————

export type LambingEvent = { date: Date; lambCount?: number | null };

export type LambingYear = {
  year: number;
  lambings: number;
  lambs: number;
  /** Lambs per lambing — the litter size. 0 when nothing is logged. */
  averageLitter: number;
};

export type LambingSummary = {
  years: LambingYear[];
  totalLambings: number;
  totalLambs: number;
  averageLitter: number;
};

/**
 * The lambing log, year by year (newest first). A lambing with no count
 * still counts as a lambing — it just contributes one lamb, which is the
 * conservative reading of an unfilled box.
 */
export function lambingSummary(events: LambingEvent[]): LambingSummary {
  const byYear = new Map<number, { lambings: number; lambs: number }>();
  let totalLambings = 0;
  let totalLambs = 0;

  for (const e of events) {
    const year = e.date.getFullYear();
    const lambs = e.lambCount != null && e.lambCount > 0 ? e.lambCount : 1;
    const row = byYear.get(year) ?? { lambings: 0, lambs: 0 };
    row.lambings += 1;
    row.lambs += lambs;
    byYear.set(year, row);
    totalLambings += 1;
    totalLambs += lambs;
  }

  const years: LambingYear[] = [...byYear.entries()]
    .map(([year, row]) => ({
      year,
      lambings: row.lambings,
      lambs: row.lambs,
      averageLitter: row.lambings > 0 ? row.lambs / row.lambings : 0,
    }))
    .sort((a, b) => b.year - a.year);

  return {
    years,
    totalLambings,
    totalLambs,
    averageLitter: totalLambings > 0 ? totalLambs / totalLambings : 0,
  };
}

/** "1.8" — one decimal, the way litter size is quoted. */
export function formatLitter(average: number): string {
  return average.toFixed(1);
}
