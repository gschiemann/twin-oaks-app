// FR-007 — Business Profile. Entered once in Settings, reused on every
// customer-facing document. One profile per account (multi-user, 2026-08).
//
// The design rule that matters: a finalized document must never change
// because Settings changed later. So documents SNAPSHOT the profile at
// finalization (Invoice.businessSnapshot) and rendering prefers that
// snapshot over the live row.

import { prisma } from "@/lib/db";
import { OWNER_ACCOUNT_ID } from "@/lib/session";
import { ALL_DIVISIONS, DIVISIONS, type Division } from "@/lib/domain";

export type BusinessInfo = {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoPath: string | null;
};

// Twin Oaks' real details — the OWNER account's defaults until the form is
// saved once. Other accounts get a profile row at signup, so they never see
// these.
export const DEFAULT_BUSINESS: BusinessInfo = {
  name: "Twin Oaks Farm & Tech",
  addressLine1: "7575 State Highway 134 East",
  addressLine2: null,
  city: "Columbia",
  state: "Alabama",
  postalCode: "36319",
  phone: null,
  email: "twinoaksfarmandtech@gmail.com",
  website: "twinoaksfarmandtech.com",
  logoPath: null,
};

// The shipped Twin Oaks lockup — the OWNER's document fallback only. Other
// accounts show no logo until they upload their own.
export const DEFAULT_LOGO_SRC = "/brand/twin-oaks-logo.png";

export type BusinessProfileInfo = BusinessInfo & {
  defaultTaxRatePercent: number;
  divisions: Division[];
  householdCategoriesCsv: string | null;
};

function parseDivisions(csv: string | null): Division[] {
  if (!csv) return [...DIVISIONS];
  const list = csv
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d): d is Division => (ALL_DIVISIONS as readonly string[]).includes(d));
  return list.length > 0 ? list : [...DIVISIONS];
}

export async function getBusinessProfile(accountId: string): Promise<BusinessProfileInfo> {
  const row = await prisma.businessProfile.findFirst({ where: { accountId } }).catch(() => null);
  if (!row) {
    // Only the owner can lack a row (pre-multi-user data); everyone else's is
    // created at signup. A missing row on another account still renders.
    const base = accountId === OWNER_ACCOUNT_ID ? DEFAULT_BUSINESS : { ...DEFAULT_BUSINESS, name: "My business", addressLine1: null, city: null, state: null, postalCode: null, email: null, website: null };
    const divisions: Division[] = accountId === OWNER_ACCOUNT_ID ? [...DIVISIONS] : ["GENERAL"];
    return { ...base, defaultTaxRatePercent: 0, divisions, householdCategoriesCsv: null };
  }
  return {
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    phone: row.phone,
    email: row.email,
    website: row.website,
    logoPath: row.logoPath,
    defaultTaxRatePercent: row.defaultTaxRatePercent,
    divisions: parseDivisions(row.divisionsCsv),
    householdCategoriesCsv: row.householdCategoriesCsv,
  };
}

// Document logo: the uploaded one, or the Twin Oaks lockup for the owner
// only. Null = render no logo (a neutral document for other businesses).
export function brandLogoSrcFor(accountId: string, logoFileSrc: string | null): string | null {
  if (logoFileSrc) return logoFileSrc;
  return accountId === OWNER_ACCOUNT_ID ? DEFAULT_LOGO_SRC : null;
}

// "Columbia, Alabama 36319" — skips whatever is missing.
export function cityStateZip(b: BusinessInfo): string {
  const cityState = [b.city, b.state].filter(Boolean).join(", ");
  return [cityState, b.postalCode].filter(Boolean).join(" ");
}

export function businessAddressLines(b: BusinessInfo): string[] {
  return [b.addressLine1, b.addressLine2, cityStateZip(b)].filter(
    (l): l is string => Boolean(l && l.trim()),
  );
}

export function snapshotBusiness(b: BusinessInfo): string {
  return JSON.stringify({
    name: b.name,
    addressLine1: b.addressLine1,
    addressLine2: b.addressLine2,
    city: b.city,
    state: b.state,
    postalCode: b.postalCode,
    phone: b.phone,
    email: b.email,
    website: b.website,
    logoPath: b.logoPath,
  });
}

// Rendering path for any document: the frozen snapshot wins; live profile is
// only a fallback for drafts that were never finalized.
export function businessFromSnapshot(
  snapshot: string | null | undefined,
  live: BusinessInfo,
): BusinessInfo {
  if (!snapshot) return live;
  try {
    const parsed = JSON.parse(snapshot) as Partial<BusinessInfo>;
    return { ...live, ...parsed };
  } catch {
    return live;
  }
}
