// The "kept" report, carried back across the redirect.
//
// removeSampleData() can deliberately leave a practice record alone — when one
// of the operator's OWN records is attached to it — and it says which and why.
// THE SAVE RULE sends him back to this page with a plain URL, so that
// explanation has to ride in the URL or it is lost, and dropping it silently
// is the one thing this page must not do.
//
// It is display-only. Nothing on the page acts on these values: the live
// counts always come from dataOverview(), and the removal itself is long
// finished by the time this is read. A hand-edited or damaged value is
// therefore dropped rather than believed, and every string is length-capped
// before it reaches the screen.

import type { KeptGroup } from "@/lib/sample-data";

/** One line of "what was kept, and why", as it survives the round trip. */
export type KeptLine = { label: string; count: number; reasons: string[] };

/** Comfortably inside every browser's and proxy's URL limit. */
const MAX_ENCODED = 1500;
const MAX_REASONS = 6;
const MAX_TEXT = 140;
const MAX_LINES = 24;

type Wire = { l: string; c: number; r: string[] };

function pack(groups: KeptGroup[], withReasons: boolean): string {
  const wire: Wire[] = groups.map((g) => ({
    l: g.label,
    c: g.count,
    r: withReasons ? g.reasons.slice(0, MAX_REASONS) : [],
  }));
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
}

/**
 * Null when there is nothing to report — or, in the impossible-but-cheap case
 * of a report too long for a URL, after the reasons have been dropped. The
 * counts are never trimmed away: a short report beats a wrong one, and the
 * page still shows the kept rows themselves in the table underneath.
 */
export function encodeKept(groups: KeptGroup[]): string | null {
  if (groups.length === 0) return null;
  const full = pack(groups, true);
  if (full.length <= MAX_ENCODED) return full;
  const bare = pack(groups, false);
  return bare.length <= MAX_ENCODED ? bare : null;
}

export function decodeKept(raw: string | undefined): KeptLine[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const lines: KeptLine[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { l, c, r } = item as { l?: unknown; c?: unknown; r?: unknown };
    if (typeof l !== "string" || typeof c !== "number" || !Number.isFinite(c)) continue;
    lines.push({
      label: l.slice(0, MAX_TEXT),
      count: Math.max(0, Math.trunc(c)),
      reasons: Array.isArray(r)
        ? r
            .filter((x): x is string => typeof x === "string")
            .slice(0, MAX_REASONS)
            .map((x) => x.slice(0, MAX_TEXT))
        : [],
    });
  }
  return lines.slice(0, MAX_LINES);
}

export function keptTotal(lines: KeptLine[]): number {
  return lines.reduce((sum, l) => sum + l.count, 0);
}
