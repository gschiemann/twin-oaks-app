// Pickers for the invoice and livestock forms: where a sale can be taxed,
// with the combined general rate in force on a given day (to pre-fill the
// invoice's rate), and each kind's approved treatment (to pre-tick Taxable).

import { prisma } from "@/lib/db";
import { isoDay } from "./format";
import { splitIds } from "./load";

export type LocationOption = { id: string; name: string; ratePercent: number | null };

export async function salesTaxOptions(accountId: string, onDay: Date = new Date()) {
  const [authorityCount, locations, rates, rules] = await Promise.all([
    prisma.taxAuthority.count({ where: { accountId } }),
    prisma.taxLocation.findMany({ where: { accountId }, orderBy: { name: "asc" } }),
    prisma.taxRate.findMany({ where: { accountId, rateClass: "GENERAL" } }),
    prisma.salesTaxRule.findMany({
      where: { accountId },
      select: { productType: true, treatment: true },
    }),
  ]);
  const day = isoDay(onDay);
  const generalPpm = (authorityId: string): number | null => {
    const r = rates.find(
      (x) =>
        x.authorityId === authorityId &&
        isoDay(x.effectiveFrom) <= day &&
        (x.effectiveTo === null || day <= isoDay(x.effectiveTo)),
    );
    return r ? r.ratePpm : null;
  };
  const options: LocationOption[] = locations.map((l) => {
    const ids = splitIds(l.authorityIdsCsv);
    let ppm = 0;
    for (const id of ids) {
      const p = generalPpm(id);
      if (p === null) return { id: l.id, name: l.name, ratePercent: null };
      ppm += p;
    }
    // ppm / 10,000 = percent; ppm is an integer, so 95000 -> 9.5 exactly.
    return { id: l.id, name: l.name, ratePercent: ids.length ? ppm / 10_000 : null };
  });
  return {
    /** Sales tax is in use on this account (anything set up at all). */
    enabled: authorityCount > 0 || locations.length > 0 || rules.length > 0,
    locations: options,
    ruleTreatments: Object.fromEntries(rules.map((r) => [r.productType, r.treatment])) as Record<
      string,
      string
    >,
  };
}
