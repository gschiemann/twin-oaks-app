// One-off corrections to existing records that the OWNER asked for, applied
// on the server — the only place that can reach the database (this app has
// no admin console). Each fix is idempotent and conditional, so every server
// instance may run it and a record still changes at most once.

import { OWNER_ACCOUNT_ID } from "@/lib/session";
import { findTaxHeldInIncome, takeTaxOut } from "@/lib/income-tax-fix";
import { TAX_TAKEN_OUT } from "@/lib/sales-tax/income-fix";

declare global {
  var __twinOaksDataFixes: Promise<void> | undefined;
}

async function runFixes(): Promise<void> {
  // 2026-09-26, the owner: "fix the old stuff and make us correct".
  // Invoice payments recorded before the pre-tax split (v6.1) booked their
  // sales tax as income. Take it out of the owner's rows only — other
  // accounts fix theirs with the confirmed Fix on each payment. A row
  // corrected once (its note says so) is left alone even if edited back.
  const held = (await findTaxHeldInIncome(OWNER_ACCOUNT_ID)).filter(
    (h) => !(h.income.notes ?? "").includes(TAX_TAKEN_OUT),
  );
  if (held.length === 0) return;
  const r = await takeTaxOut(OWNER_ACCOUNT_ID, held);
  console.log(`[twin-oaks] data fix: took ${r.taxCents}¢ sales tax out of ${r.rows} income rows`);
}

/** Memoized per server instance; never throws. */
export function runDataFixes(): Promise<void> {
  if (!globalThis.__twinOaksDataFixes) {
    globalThis.__twinOaksDataFixes = runFixes().catch((e) => {
      console.error("[twin-oaks] data fix failed:", e instanceof Error ? e.message : e);
    });
  }
  return globalThis.__twinOaksDataFixes;
}
