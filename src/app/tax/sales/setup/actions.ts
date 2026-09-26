"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import {
  ALABAMA_STATE_RATE_CODES,
  DERIVED_PRODUCT_TYPES,
  PRODUCT_TYPES,
  RATE_CLASSES,
  SALES_TAX_BASES,
  TAX_AUTHORITY_LEVELS,
  TAX_TREATMENTS_SALES,
  type ProductType,
  type RateClass,
} from "@/lib/domain";
import { isoDay, percentTextToPpm } from "@/lib/sales-tax/format";
import { splitIds } from "@/lib/sales-tax/load";

const BACK = "/tax/sales/setup";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function oneOf<T extends string>(list: readonly T[], v: string | null): T | null {
  return v && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function fail(code: string, anchor = ""): never {
  redirect(`${BACK}?error=${code}${anchor ? `#${anchor}` : ""}`);
}

function done(code: string, anchor = ""): never {
  redirect(`${BACK}?saved=${code}${anchor ? `#${anchor}` : ""}`);
}

// ————————————————————————— reporting basis —————————————————————————

export async function saveBasis(formData: FormData) {
  const accountId = await requireAccountId();
  const basis = oneOf(SALES_TAX_BASES, str(formData.get("basis")));
  const approvedBy = str(formData.get("approvedBy"));
  if (!basis || !approvedBy) fail("basis", "basis");
  const data = {
    salesTaxBasis: basis,
    salesTaxBasisApprovedBy: approvedBy,
    salesTaxBasisApprovedAt: new Date(),
  };
  const existing = await prisma.businessProfile.findFirst({
    where: { accountId },
    select: { id: true },
  });
  if (existing) await prisma.businessProfile.update({ where: { id: existing.id }, data });
  else await prisma.businessProfile.create({ data: { accountId, ...data } });
  done("basis", "basis");
}

// ————————————————————————— authorities —————————————————————————

export async function saveAuthority(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  const level = oneOf(TAX_AUTHORITY_LEVELS, str(formData.get("level")));
  const taxType = str(formData.get("taxType"))?.toUpperCase() ?? null;
  if (!name || !level || !taxType) fail("authority", id ? `auth-${id}` : "authorities");
  const data = {
    name,
    level,
    // Codes are text exactly as published — leading zeros and all.
    jurisdictionCode: str(formData.get("jurisdictionCode")) ?? "",
    taxType,
    notes: str(formData.get("notes")),
  };
  if (id) {
    await prisma.taxAuthority.updateMany({ where: { id, accountId }, data });
    done("authority", `auth-${id}`);
  }
  const created = await prisma.taxAuthority.create({ data: { accountId, ...data } });
  done("authority", `auth-${created.id}`);
}

export async function deleteAuthority(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) fail("authority");
  const locations = await prisma.taxLocation.findMany({
    where: { accountId },
    select: { authorityIdsCsv: true },
  });
  if (locations.some((l) => splitIds(l.authorityIdsCsv).includes(id)))
    fail("authority-in-use", `auth-${id}`);
  await prisma.taxAuthority.deleteMany({ where: { id, accountId } }); // its rates cascade
  done("deleted", "authorities");
}

// ————————————————————————— rates —————————————————————————

/** The day before a local-noon date, at local noon. */
function dayBefore(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
}

// A rate change is a NEW row with its own start date; the open-ended row it
// replaces is ended the day before. History is never overwritten, so any
// past month still computes at the rate in force on each sale date.
export async function addRate(formData: FormData) {
  const accountId = await requireAccountId();
  const authorityId = str(formData.get("authorityId"));
  const anchor = authorityId ? `auth-${authorityId}` : "authorities";
  const authority = authorityId
    ? await prisma.taxAuthority.findFirst({ where: { id: authorityId, accountId } })
    : null;
  if (!authority) fail("rate", anchor);

  const rateClass = oneOf(RATE_CLASSES, str(formData.get("rateClass"))) ?? "GENERAL";
  const ratePpm = percentTextToPpm(str(formData.get("ratePercent")) ?? "");
  const effectiveFrom = parseDateInput(formData.get("effectiveFrom"));
  const effectiveTo = parseDateInput(formData.get("effectiveTo"));
  const source = str(formData.get("source"));
  let rateTypeCode = str(formData.get("rateTypeCode"))?.toUpperCase() ?? null;
  if (!rateTypeCode) {
    // Pre-fill only where the code is published and unambiguous.
    if (authority.level === "STATE")
      rateTypeCode = ALABAMA_STATE_RATE_CODES[rateClass as RateClass];
    else if (rateClass === "GENERAL") rateTypeCode = "GENER";
  }
  if (ratePpm === null || ratePpm > 1_000_000 || !effectiveFrom || !source || !rateTypeCode)
    fail("rate", anchor);
  if (effectiveTo && isoDay(effectiveTo) < isoDay(effectiveFrom)) fail("rate-dates", anchor);

  const existing = await prisma.taxRate.findMany({
    where: { accountId, authorityId: authority.id, rateClass },
  });
  // End the open-ended rate this one replaces.
  const replaced = existing.filter(
    (r) => r.effectiveTo === null && isoDay(r.effectiveFrom) < isoDay(effectiveFrom),
  );
  const newTo = effectiveTo ? isoDay(effectiveTo) : "9999-12-31";
  const overlaps = existing.some((r) => {
    if (replaced.includes(r)) return false;
    const from = isoDay(r.effectiveFrom);
    const to = r.effectiveTo ? isoDay(r.effectiveTo) : "9999-12-31";
    return from <= newTo && isoDay(effectiveFrom) <= to;
  });
  if (overlaps) fail("rate-overlap", anchor);

  await prisma.$transaction([
    ...replaced.map((r) =>
      prisma.taxRate.update({
        where: { id: r.id },
        data: { effectiveTo: dayBefore(effectiveFrom) },
      }),
    ),
    prisma.taxRate.create({
      data: {
        accountId,
        authorityId: authority.id,
        rateClass,
        rateTypeCode,
        ratePpm,
        effectiveFrom,
        effectiveTo,
        source,
        confirmedAt: new Date(),
      },
    }),
  ]);
  done(replaced.length ? "rate-replaced" : "rate", anchor);
}

export async function confirmRate(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const rate = id ? await prisma.taxRate.findFirst({ where: { id, accountId } }) : null;
  if (!rate) fail("rate");
  await prisma.taxRate.update({ where: { id: rate.id }, data: { confirmedAt: new Date() } });
  done("confirmed", `auth-${rate.authorityId}`);
}

export async function deleteRate(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const rate = id ? await prisma.taxRate.findFirst({ where: { id, accountId } }) : null;
  if (!rate) fail("rate");
  await prisma.taxRate.deleteMany({ where: { id: rate.id, accountId } });
  done("deleted", `auth-${rate.authorityId}`);
}

// ————————————————————————— locations —————————————————————————

export async function saveLocation(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  const anchor = id ? `loc-${id}` : "locations";
  if (!name) fail("location", anchor);
  const picked = formData.getAll("authorityIds").filter((v): v is string => typeof v === "string");
  const valid = await prisma.taxAuthority.findMany({
    where: { accountId, id: { in: picked } },
    select: { id: true },
  });
  if (valid.length === 0) fail("location-authorities", anchor);
  const data = {
    name,
    address: str(formData.get("address")),
    city: str(formData.get("city")),
    county: str(formData.get("county")),
    state: (str(formData.get("state")) ?? "AL").toUpperCase(),
    postalCode: str(formData.get("postalCode")),
    insideCity: formData.get("insideCity") != null,
    policeJurisdiction: str(formData.get("policeJurisdiction")),
    authorityIdsCsv: valid.map((a) => a.id).join(","),
    notes: str(formData.get("notes")),
  };
  if (id) {
    await prisma.taxLocation.updateMany({ where: { id, accountId }, data });
    done("location", anchor);
  }
  const created = await prisma.taxLocation.create({ data: { accountId, ...data } });
  done("location", `loc-${created.id}`);
}

export async function deleteLocation(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) fail("location");
  const [invoices, sales] = await Promise.all([
    prisma.invoice.count({ where: { accountId, taxLocationId: id } }),
    prisma.livestockSale.count({ where: { accountId, taxLocationId: id } }),
  ]);
  if (invoices + sales > 0) fail("location-in-use", `loc-${id}`);
  await prisma.taxLocation.deleteMany({ where: { id, accountId } });
  done("deleted", "locations");
}

// ————————————————————————— product rules —————————————————————————

// A rule is a person's decision, so it always carries their name and the
// date. The app suggests nothing silently: no rule, no treatment.
export async function saveRule(formData: FormData) {
  const accountId = await requireAccountId();
  const productType = oneOf(PRODUCT_TYPES, str(formData.get("productType")));
  const anchor = productType ? `rule-${productType}` : "rules";
  if (!productType || DERIVED_PRODUCT_TYPES.includes(productType as ProductType))
    fail("rule", anchor);
  const treatment = oneOf(TAX_TREATMENTS_SALES, str(formData.get("treatment")));
  const approvedBy = str(formData.get("approvedBy"));
  const exemptionReason = str(formData.get("exemptionReason"));
  if (!treatment || !approvedBy) fail("rule", anchor);
  if ((treatment === "EXEMPT" || treatment === "WHOLESALE") && !exemptionReason)
    fail("rule-reason", anchor);
  const data = {
    treatment,
    rateClass: oneOf(RATE_CLASSES, str(formData.get("rateClass"))) ?? "GENERAL",
    exemptionReason: treatment === "EXEMPT" || treatment === "WHOLESALE" ? exemptionReason : null,
    requiresEvidence: formData.get("requiresEvidence") != null,
    approvedBy,
    approvedAt: new Date(),
    notes: str(formData.get("notes")),
  };
  await prisma.salesTaxRule.upsert({
    where: { accountId_productType: { accountId, productType } },
    create: { accountId, productType, ...data },
    update: data,
  });
  done("rule", anchor);
}
