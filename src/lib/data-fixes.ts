// One-off corrections to existing records that the OWNER asked for, applied
// on the server — the only place that can reach the database (this app has
// no admin console). Each fix is idempotent and guarded, so every server
// instance may run it and a record still changes at most once.

import { prisma } from "@/lib/db";
import { OWNER_ACCOUNT_ID } from "@/lib/session";
import { profileRowSeed } from "@/lib/business";
import type { ProductType } from "@/lib/domain";
import { findTaxHeldInIncome, takeTaxOut } from "@/lib/income-tax-fix";
import { guessKinds } from "@/lib/sales-tax/classify";
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

/** The owner asked Claude to make these calls; each rule says so. */
const DECIDED_BY = "Claude, for Greg";

const SALE_OF_GOODS =
  "A retail sale of tangible personal property — taxable (Ala. Code §40-23-2(1)).";

const RULES: {
  productType: ProductType;
  treatment: "TAXABLE" | "EXEMPT";
  exemptionReason?: string;
  notes: string;
}[] = [
  { productType: "PRINTED_PART", treatment: "TAXABLE", notes: SALE_OF_GOODS },
  { productType: "OTHER_GOODS", treatment: "TAXABLE", notes: SALE_OF_GOODS },
  {
    productType: "LIVE_LIVESTOCK",
    treatment: "EXEMPT",
    exemptionReason: "Livestock — no Alabama sales tax (ALDOR: sales where no sales tax is due)",
    notes: "Meat, wool and other products made from the animals are not livestock.",
  },
  {
    productType: "DESIGN_WITH_PRODUCT",
    treatment: "TAXABLE",
    notes:
      "Design that goes into a product sold is part of its price: gross proceeds include labor and service costs (Ala. Code §40-23-1), and ALDOR doesn't exempt fabrication labor.",
  },
  {
    productType: "DESIGN_STANDALONE",
    treatment: "EXEMPT",
    exemptionReason: "Design service, no product sold — not a sale of tangible personal property",
    notes: "If a product is made from the design and sold, it's Design (part of a product).",
  },
  {
    productType: "FABRICATION_LABOR",
    treatment: "TAXABLE",
    notes:
      "Labor to make what's sold is part of its price (Ala. Code §40-23-1); ALDOR doesn't exempt fabrication labor.",
  },
  {
    productType: "REPAIR_LABOR",
    treatment: "EXEMPT",
    exemptionReason: "Repair or installation labor billed as its own line — exempt (ALDOR)",
    notes: "Parts used are still taxable — bill them on their own line.",
  },
  {
    productType: "SERVICE",
    treatment: "EXEMPT",
    exemptionReason: "Service, no product sold — not subject to Alabama sales tax",
    notes: "",
  },
  {
    productType: "SHIPPING",
    treatment: "TAXABLE",
    notes:
      "Delivery in our own vehicle is taxable even when billed separately (Ala. Admin. Code r. 810-6-1-.178). Shipping by a carrier (USPS, UPS, FedEx) billed separately isn't — mark those lines Exempt.",
  },
];

// 2026-09-26, the owner: "do what's right" — decide what's taxable under
// Alabama law, with the source on each rule, and sort the older invoice
// lines whose wording leaves no doubt (src/lib/sales-tax/classify.ts). The
// rest stay "Not classified" for a person. Once only: skipped when a rule it
// made exists. Rules set in the app are kept, and only lines still not
// classified are touched.
async function ownerTaxRules(): Promise<void> {
  const A = OWNER_ACCOUNT_ID;
  const done = await prisma.$transaction(
    async (tx) => {
      if (await tx.salesTaxRule.count({ where: { accountId: A, approvedBy: DECIDED_BY } }))
        return null;
      const now = new Date();
      const rules = await tx.salesTaxRule.createMany({
        data: RULES.map((r) => ({
          accountId: A,
          productType: r.productType,
          treatment: r.treatment,
          rateClass: "GENERAL",
          exemptionReason: r.exemptionReason ?? null,
          requiresEvidence: false,
          approvedBy: DECIDED_BY,
          approvedAt: now,
          notes: r.notes || null,
        })),
        skipDuplicates: true,
      });

      const invoices = await tx.invoice.findMany({
        where: { accountId: A, kind: "INVOICE", lines: { some: { productType: "UNCLASSIFIED" } } },
        select: {
          division: true,
          lines: { select: { id: true, description: true, totalCents: true, productType: true } },
        },
      });
      const groups = new Map<
        string,
        { productType: ProductType; reason?: string; ids: string[] }
      >();
      let open = 0;
      for (const inv of invoices) {
        const guesses = guessKinds(inv.lines, inv.division);
        inv.lines.forEach((l, i) => {
          if (l.productType !== "UNCLASSIFIED") return;
          open += 1;
          const g = guesses[i];
          if (!g) return;
          const key = `${g.productType}|${g.exemptReason ?? ""}`;
          const group = groups.get(key) ?? {
            productType: g.productType,
            reason: g.exemptReason,
            ids: [],
          };
          group.ids.push(l.id);
          groups.set(key, group);
        });
      }
      let sorted = 0;
      for (const g of groups.values()) {
        const res = await tx.invoiceLine.updateMany({
          where: {
            id: { in: g.ids },
            productType: "UNCLASSIFIED",
            invoice: { accountId: A },
            ...(g.reason ? { taxTreatmentOverride: null } : {}),
          },
          data: {
            productType: g.productType,
            ...(g.reason ? { taxTreatmentOverride: "EXEMPT", exemptionReason: g.reason } : {}),
          },
        });
        sorted += res.count;
      }
      return { rules: rules.count, sorted, open };
    },
    { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
  );
  if (done) {
    console.log(
      `[twin-oaks] data fix: ${done.rules} sales tax rules; sorted ${done.sorted} of ${done.open} unclassified invoice lines`,
    );
  }
}

async function runFixes(): Promise<void> {
  for (const fix of [ownerIncomeTax, ownerSalesTaxSetup, ownerTaxRules]) {
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
