"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { DEFAULT_BUSINESS, PROFILE_ID } from "@/lib/business";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function saveBusinessProfile(formData: FormData) {
  const rateRaw = str(formData.get("defaultTaxRatePercent"));
  const rate = rateRaw != null && Number.isFinite(Number(rateRaw)) ? Number(rateRaw) : 0;

  let logoPath: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const stored = await saveUpload(logo);
    logoPath = stored.storageKey;
  }

  const data = {
    name: str(formData.get("name")) ?? DEFAULT_BUSINESS.name,
    addressLine1: str(formData.get("addressLine1")),
    addressLine2: str(formData.get("addressLine2")),
    city: str(formData.get("city")),
    state: str(formData.get("state")),
    postalCode: str(formData.get("postalCode")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
    website: str(formData.get("website")),
    defaultTaxRatePercent: Math.max(0, Math.min(100, rate)),
    ...(logoPath ? { logoPath } : {}),
  };

  await prisma.businessProfile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID, ...data },
    update: data,
  });

  // Documents read this on every render, so clear the whole route cache.
  revalidatePath("/", "layout");
  redirect("/settings/business?saved=1");
}

export async function removeLogo() {
  await prisma.businessProfile
    .update({ where: { id: PROFILE_ID }, data: { logoPath: null } })
    .catch(() => {});
  revalidatePath("/", "layout");
  redirect("/settings/business");
}
