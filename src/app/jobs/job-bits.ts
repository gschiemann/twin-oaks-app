// Small shared bits for the print-job screens — plain language in, plain
// language out. No database, no React: just the wording and the tones.

import { PRINT_JOB_STATUS_LABELS, type PrintJobStatus } from "@/lib/domain";

export function jobStatusTone(status: string): string {
  switch (status) {
    case "DONE":
      return "green";
    case "SHIPPED":
      return "blue";
    case "PRINTING":
      return "amber";
    case "CANCELLED":
      return "red";
    default:
      return "stone";
  }
}

export function jobStatusLabel(status: string): string {
  return PRINT_JOB_STATUS_LABELS[status as PrintJobStatus] ?? status;
}

/** "4h 32m" / "45m" / "—" — never a bare pile of minutes. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function hoursPartOf(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  return String(Math.floor(Math.round(minutes) / 60));
}

export function minutesPartOf(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  return String(Math.round(minutes) % 60);
}

/** Cents-per-hour rate shown in a dollars box ("25.00"). */
export function rateToDollars(cents: number | null | undefined, fallbackCents: number): string {
  const value = cents != null && Number.isFinite(cents) && cents >= 0 ? cents : fallbackCents;
  return (value / 100).toFixed(2);
}

export function centsToDollarsInput(cents: number | null | undefined): string {
  return cents != null && Number.isFinite(cents) ? (cents / 100).toFixed(2) : "";
}

/** How a spool reads on a picker: "Bambu PLA — Matte Black · 740g left". */
export function spoolLabel(spool: {
  manufacturer?: string | null;
  material?: string | null;
  colorName?: string | null;
  spoolTag?: string | null;
  remainingGrams?: number | null;
}): string {
  const name = [spool.manufacturer, spool.material, spool.colorName].filter(Boolean).join(" ");
  const left =
    spool.remainingGrams != null && Number.isFinite(spool.remainingGrams)
      ? `${Math.round(spool.remainingGrams)}g left`
      : "amount unknown";
  return `${name || "Filament"}${spool.spoolTag ? ` (${spool.spoolTag})` : ""} · ${left}`;
}

/**
 * Which month a job belongs to: the day it was finished if it's finished,
 * otherwise the day it was written down. Keeps "this month" honest when a
 * job spans the turn of the month.
 */
export function jobMonthDate(job: { completedAt?: Date | null; createdAt: Date }): Date {
  return job.completedAt ?? job.createdAt;
}
