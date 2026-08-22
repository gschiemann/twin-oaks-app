// Shared filament helpers — page files export only Next-recognized fields,
// so every bit of spool math and display lives here.

import { SPOOL_STATUS_LABELS, type SpoolStatus } from "@/lib/domain";

// A spool under this many grams is "running low" — the number the owner
// actually acts on (time to order another one).
export const LOW_GRAMS = 100;

// Everything these helpers need. Kept structural so a Prisma row, a form
// preview, or a plain object all satisfy it.
export type SpoolBits = {
  material: string;
  colorName?: string | null;
  manufacturer?: string | null;
  status: string;
  totalGrams: number;
  remainingGrams: number;
  purchasePriceCents?: number | null;
};

/** In stock or loaded on a printer — filament he still owns. */
export function isOnHand(status: string): boolean {
  return status === "IN_STOCK" || status === "IN_USE";
}

export function isRunningLow(spool: Pick<SpoolBits, "status" | "remainingGrams">): boolean {
  return isOnHand(spool.status) && spool.remainingGrams < LOW_GRAMS;
}

/** Cost of one gram, in cents (fractional — never rounded until display). */
export function centsPerGram(
  spool: Pick<SpoolBits, "purchasePriceCents" | "totalGrams">,
): number | null {
  if (spool.purchasePriceCents == null || spool.totalGrams <= 0) return null;
  return spool.purchasePriceCents / spool.totalGrams;
}

/** What the filament still on the spool is worth, in whole cents. */
export function valueRemainingCents(
  spool: Pick<SpoolBits, "purchasePriceCents" | "totalGrams" | "remainingGrams">,
): number | null {
  const perGram = centsPerGram(spool);
  if (perGram == null) return null;
  return Math.round(perGram * Math.max(0, spool.remainingGrams));
}

export function centsPerGramShort(
  spool: Pick<SpoolBits, "purchasePriceCents" | "totalGrams">,
): string {
  const perGram = centsPerGram(spool);
  if (perGram == null) return "—";
  return `${perGram < 1 ? perGram.toFixed(2) : perGram.toFixed(1)}¢`;
}

export function pricePerGramLabel(
  spool: Pick<SpoolBits, "purchasePriceCents" | "totalGrams">,
): string {
  const short = centsPerGramShort(spool);
  return short === "—" ? "—" : `${short} per gram`;
}

export function formatGrams(grams: number): string {
  const rounded = Math.abs(grams) < 10 ? Math.round(grams * 10) / 10 : Math.round(grams);
  return `${rounded.toLocaleString("en-US")} g`;
}

export function remainingPct(spool: Pick<SpoolBits, "totalGrams" | "remainingGrams">): number {
  if (spool.totalGrams <= 0) return 0;
  return Math.max(0, Math.min(100, (spool.remainingGrams / spool.totalGrams) * 100));
}

/** "PLA · Black" — what the owner calls the spool. */
export function spoolName(spool: Pick<SpoolBits, "material" | "colorName">): string {
  return [spool.material, spool.colorName].filter(Boolean).join(" · ");
}

export function statusLabel(status: string): string {
  return SPOOL_STATUS_LABELS[status as SpoolStatus] ?? status;
}

export function statusTone(status: string): string {
  if (status === "IN_USE") return "blue";
  if (status === "IN_STOCK") return "green";
  if (status === "EMPTY") return "amber";
  return "stone";
}

// The remaining bar: one div inside another, width as a percentage. No chart
// library — this has to paint instantly on an old phone.
export function RemainingBar({
  spool,
  tall = false,
}: {
  spool: Pick<SpoolBits, "status" | "totalGrams" | "remainingGrams">;
  tall?: boolean;
}) {
  const pct = remainingPct(spool);
  // A sliver still shows, so "almost gone" never looks the same as "gone".
  const width = spool.remainingGrams > 0 ? Math.max(2, Math.round(pct)) : 0;
  const low = spool.remainingGrams < LOW_GRAMS;
  return (
    <div
      className={`overflow-hidden rounded-full bg-stone-100 ${tall ? "h-4" : "h-2.5"}`}
      role="img"
      aria-label={`${formatGrams(spool.remainingGrams)} left of ${formatGrams(spool.totalGrams)}`}
    >
      <div
        className={`h-full rounded-full ${low ? "bg-red-500" : "bg-oak-600"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// Both save screens say the same plain-English thing when a save is refused.
export function spoolSaveError(error: string | undefined, buttonLabel: string): string | null {
  if (error === "missing") {
    return `Pick a material and type the full spool weight in grams, then tap ${buttonLabel} again.`;
  }
  if (error === "over") {
    return `Grams left cannot be more than the full spool weight. Fix either number, then tap ${buttonLabel} again.`;
  }
  return null;
}
