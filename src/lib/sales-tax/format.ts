// Exact formatting for the sales tax module. Integers in, strings out — no
// float ever touches money or a rate, so a return figure can't drift by a
// cent through binary rounding.
//
// Dates: the app stores calendar days at LOCAL NOON (parseDateInput), so a
// day is read back from local components and never shifts across timezones.

/** -17500 -> "-175.00", 3450 -> "34.50". Decimal dollars, two places, no separators. */
export function centsToDecimal(cents: number): string {
  const n = Math.trunc(cents);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Numeric dollars for a spreadsheet cell: 3450 -> 34.5 (exactly representable enough for display). */
export function centsToNumber(cents: number): number {
  return Math.trunc(cents) / 100;
}

/** Rate as an unformatted fraction: 40000 ppm -> "0.04", 1250 -> "0.00125". Never "4". */
export function ppmToDecimal(ppm: number): string {
  const n = Math.trunc(ppm);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** 40000 -> "4%", 95000 -> "9.5%", 1250 -> "0.125%". For people, not files. */
export function ppmToPercentLabel(ppm: number): string {
  // ppm / 10_000 = percent; do it on the decimal string to stay exact.
  const n = Math.trunc(ppm);
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 10_000);
  const frac = String(abs % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${n < 0 ? "-" : ""}${frac ? `${whole}.${frac}` : whole}%`;
}

/** "4", "9.5", "0.125" percent text -> ppm. Null if not a clean number. */
export function percentTextToPpm(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 10_000 + Number(f.padEnd(4, "0"));
}

/**
 * Tax on a taxable amount at a rate, rounded half away from zero, entirely in
 * integers (|taxable| x ppm stays far below 2^53 for any real business).
 * Returns (e.g. refunds) mirror sales exactly.
 */
export function taxOn(taxableCents: number, ratePpm: number): number {
  const t = Math.trunc(taxableCents);
  const abs = Math.abs(t) * Math.trunc(ratePpm);
  const rounded = Math.floor((abs + 500_000) / 1_000_000);
  return t < 0 ? 0 - rounded : rounded; // 0 - 0 is +0; never emit -0
}

/** Local calendar day, YYYY-MM-DD. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local month key, YYYY-MM. */
export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidPeriod(p: unknown): p is string {
  if (typeof p !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return false;
  const y = Number(p.slice(0, 4));
  return y >= 2000 && y <= 2100;
}

/** First and last calendar day of a period, as YYYY-MM-DD. */
export function periodDays(period: string): { first: string; last: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month
  return { first: `${period}-01`, last: `${period}-${String(lastDay).padStart(2, "0")}` };
}

export function shiftPeriod(period: string, delta: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + delta;
  const d = new Date(y, m, 1, 12);
  return periodOf(d);
}

export function periodLabel(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return new Date(y, m - 1, 1, 12).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "2026-09-26" -> "Sep 26, 2026" for messages. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
