// FR-007 — Business Profile. Entered once in Settings, reused on every
// customer-facing document.
//
// The design rule that matters: a finalized document must never change
// because Settings changed later. So documents SNAPSHOT the profile at
// finalization (Invoice.businessSnapshot) and rendering prefers that
// snapshot over the live row.

import { prisma } from "@/lib/db";

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

// Twin Oaks' real details, used until the operator saves the form once.
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

export const PROFILE_ID = "singleton";

// The printed brand lockup, shipped with the app. Documents fall back to it
// when no custom logo has been uploaded, so invoices look right on day one.
export const DEFAULT_LOGO_SRC = "/brand/twin-oaks-logo.png";

export async function getBusinessProfile(): Promise<BusinessInfo & { defaultTaxRatePercent: number }> {
  const row = await prisma.businessProfile.findUnique({ where: { id: PROFILE_ID } }).catch(() => null);
  if (!row) return { ...DEFAULT_BUSINESS, defaultTaxRatePercent: 0 };
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
  };
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
  return JSON.stringify(b);
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
