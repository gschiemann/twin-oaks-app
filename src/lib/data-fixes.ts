// One-off corrections to existing records that the OWNER asked for, applied
// on the server — the only place that can reach the database (this app has
// no admin console). Each fix is idempotent and guarded, so every server
// instance may run it and a record still changes at most once.

import { prisma } from "@/lib/db";
import { OWNER_ACCOUNT_ID } from "@/lib/session";
import { profileRowSeed } from "@/lib/business";
import { findTaxHeldInIncome, takeTaxOut } from "@/lib/income-tax-fix";
import { TAX_TAKEN_OUT } from "@/lib/sales-tax/income-fix";

declare global {
  var __twinOaksDataFixes: Promise<void> | undefined;
}

// 2026-09-26, the owner: "fix the old stuff and make us correct".
// Invoice payments recorded before the pre-tax split (v6.1) booked their
// sales tax as income. Take it out of the owner's rows only — other accounts
// fix theirs with the confirmed Fix on each payment. A row corrected once
// (its note says so) is left alone even if edited back.
async function ownerIncomeTax(): Promise<void> {
  const held = (await findTaxHeldInIncome(OWNER_ACCOUNT_ID)).filter(
    (h) => !(h.income.notes ?? "").includes(TAX_TAKEN_OUT),
  );
  if (held.length === 0) return;
  const r = await takeTaxOut(OWNER_ACCOUNT_ID, held);
  if (r.rows > 0) {
    console.log(`[twin-oaks] data fix: took ${r.taxCents}¢ sales tax out of ${r.rows} income rows`);
  }
}

/** A calendar day at local noon, the way the app stores dates. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

// 2026-09-26, the owner's sales tax answers: report by PAYMENT DATE; every
// sale so far was picked up at the farm; deliveries may start, so far only
// to Dothan; whether design that goes into a printed part is taxable is
// unknown — left undecided, so those lines stay flagged for a decision.
//
// Facts behind the setup, checked the same day:
//  • State general rate 4% — ALDOR, "State Sales and Use Tax Rates".
//  • The farm (7575 State Hwy 134 E) is in UNINCORPORATED HENRY COUNTY
//    despite its Columbia mailing address: the US Census geocoder and
//    OpenStreetMap agree, and the Houston County line is ~5 km south.
//  • Local general rates, ALDOR taxrates_current.csv (Sept 2026):
//      7034 Henry County    ST 2%  administered by ALDOR  active 2024-02-01
//      7035 Houston County  ST 1%  administered by Avenu  active 2021-05-01
//      9653 City of Dothan  ST 4%  administered by Avenu  active 2021-05-01
//
// Only on a fresh setup (no basis, no authorities, no locations): it never
// overwrites anything set up in the app, and the serializable transaction
// lets only one of several servers starting at once create it.
async function ownerSalesTaxSetup(): Promise<void> {
  const A = OWNER_ACCOUNT_ID;
  const created = await prisma.$transaction(
    async (tx) => {
      const profile = await tx.businessProfile.findFirst({ where: { accountId: A } });
      const authorities = await tx.taxAuthority.count({ where: { accountId: A } });
      const locations = await tx.taxLocation.count({ where: { accountId: A } });
      if (profile?.salesTaxBasis || authorities > 0 || locations > 0) return false;

      const now = new Date();
      const file = "ALDOR local rates file taxrates_current.csv (Sept 2026)";
      const authority = async (
        name: string,
        level: "STATE" | "COUNTY" | "CITY",
        jurisdictionCode: string,
        notes: string,
        rate: { ppm: number; code: string; from: Date; source: string },
      ) => {
        const a = await tx.taxAuthority.create({
          data: {
            accountId: A,
            name,
            level,
            jurisdictionCode,
            taxType: level === "STATE" ? "SS" : "ST",
            notes,
          },
        });
        await tx.taxRate.create({
          data: {
            accountId: A,
            authorityId: a.id,
            rateClass: "GENERAL",
            rateTypeCode: rate.code,
            ratePpm: rate.ppm,
            effectiveFrom: rate.from,
            source: rate.source,
            confirmedAt: now,
          },
        });
        return a;
      };

      const state = await authority("State of Alabama", "STATE", "", "Filed in My Alabama Taxes.", {
        ppm: 40_000,
        code: "OTHER",
        from: day(2000, 1, 1),
        source: "ALDOR State Sales and Use Tax Rates: general 4% (checked 2026-09-26)",
      });
      const henry = await authority(
        "Henry County",
        "COUNTY",
        "7034",
        "Administered by ALDOR — filed with the state return in My Alabama Taxes.",
        { ppm: 20_000, code: "GENER", from: day(2024, 2, 1), source: `${file}: 7034 ST GENER 2%` },
      );
      const houston = await authority(
        "Houston County",
        "COUNTY",
        "7035",
        "Administered by Avenu — its return is filed with Avenu, not in My Alabama Taxes.",
        { ppm: 10_000, code: "GENER", from: day(2021, 5, 1), source: `${file}: 7035 ST GENER 1%` },
      );
      const dothan = await authority(
        "City of Dothan",
        "CITY",
        "9653",
        "Administered by Avenu. For the Houston County side of Dothan.",
        { ppm: 40_000, code: "GENER", from: day(2021, 5, 1), source: `${file}: 9653 ST GENER 4%` },
      );

      const farm = await tx.taxLocation.create({
        data: {
          accountId: A,
          name: "Farm pickup",
          address: "7575 State Highway 134 East",
          city: null,
          county: "Henry County",
          state: "AL",
          postalCode: "36319",
          insideCity: false,
          authorityIdsCsv: [state.id, henry.id].join(","),
          notes:
            "Mailing address says Columbia, but the farm is in unincorporated Henry County (US Census geocoder and OpenStreetMap, checked 2026-09-26).",
        },
      });
      await tx.taxLocation.create({
        data: {
          accountId: A,
          name: "Dothan delivery",
          city: "Dothan",
          county: "Houston County",
          state: "AL",
          insideCity: true,
          authorityIdsCsv: [state.id, houston.id, dothan.id].join(","),
          notes: "Deliveries inside Dothan city limits (Houston County side).",
        },
      });

      // Every sale so far was picked up at the farm.
      const invoices = await tx.invoice.updateMany({
        where: { accountId: A, kind: "INVOICE", taxLocationId: null },
        data: { taxLocationId: farm.id },
      });
      const sales = await tx.livestockSale.updateMany({
        where: { accountId: A, taxLocationId: null },
        data: { taxLocationId: farm.id },
      });

      const basis = {
        salesTaxBasis: "PAYMENT_DATE",
        salesTaxBasisApprovedBy: "Greg",
        salesTaxBasisApprovedAt: now,
        // New invoices start at the farm's rate (4% + 2%).
        defaultTaxRatePercent: 6,
      };
      if (profile) await tx.businessProfile.update({ where: { id: profile.id }, data: basis });
      else
        await tx.businessProfile.create({
          data: { accountId: A, ...(await profileRowSeed(A)), ...basis },
        });
      return { invoices: invoices.count, sales: sales.count };
    },
    { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
  );
  if (created) {
    console.log(
      `[twin-oaks] data fix: sales tax set up; ${created.invoices} invoices and ${created.sales} livestock sales taxed at the farm`,
    );
  }
}

async function runFixes(): Promise<void> {
  for (const fix of [ownerIncomeTax, ownerSalesTaxSetup]) {
    try {
      await fix();
    } catch (e) {
      console.error(`[twin-oaks] data fix ${fix.name} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Memoized per server instance; never throws. */
export function runDataFixes(): Promise<void> {
  if (!globalThis.__twinOaksDataFixes) globalThis.__twinOaksDataFixes = runFixes();
  return globalThis.__twinOaksDataFixes;
}
