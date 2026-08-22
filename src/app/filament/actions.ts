"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { FILAMENT_MATERIALS, SPOOL_STATUSES } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// A printer id from the form is only honored if that asset is this account's.
async function ownedAssetId(
  accountId: string,
  raw: FormDataEntryValue | null,
): Promise<string | null> {
  const id = str(raw);
  if (!id) return null;
  const owned = await prisma.asset.findFirst({ where: { id, accountId }, select: { id: true } });
  return owned?.id ?? null;
}

type SpoolFields = {
  manufacturer: string | null;
  material: string;
  colorName: string | null;
  spoolTag: string | null;
  purchaseDate: Date | null;
  purchasePriceCents: number | null;
  totalGrams: number;
  remainingGrams: number;
  status?: string;
  printerAssetId: string | null;
  notes: string | null;
};

type ParsedSpool = { ok: true; data: SpoolFields } | { ok: false; reason: "missing" | "over" };

async function spoolDataFromForm(accountId: string, formData: FormData): Promise<ParsedSpool> {
  const material = str(formData.get("material"));
  const totalGrams = num(formData.get("totalGrams"));
  if (!material || !(FILAMENT_MATERIALS as readonly string[]).includes(material)) {
    return { ok: false, reason: "missing" };
  }
  if (totalGrams == null || totalGrams <= 0) return { ok: false, reason: "missing" };

  // Left blank = a full spool. He should never have to type 1000 twice.
  const remainingRaw = num(formData.get("remainingGrams"));
  const remainingGrams = Math.max(0, remainingRaw ?? totalGrams);
  if (remainingGrams > totalGrams) return { ok: false, reason: "over" };

  const status = str(formData.get("status"));

  return {
    ok: true,
    data: {
      manufacturer: str(formData.get("manufacturer")),
      material,
      colorName: str(formData.get("colorName")),
      spoolTag: str(formData.get("spoolTag")),
      purchaseDate: parseDateInput(formData.get("purchaseDate")),
      purchasePriceCents: parseDollarsToCents(formData.get("purchasePrice")),
      totalGrams,
      remainingGrams,
      printerAssetId: await ownedAssetId(accountId, formData.get("printerAssetId")),
      notes: str(formData.get("notes")),
      ...(status && (SPOOL_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    },
  };
}

export async function createSpool(formData: FormData) {
  const accountId = await requireAccountId();
  const parsed = await spoolDataFromForm(accountId, formData);
  if (!parsed.ok) redirect(`/filament/new?error=${parsed.reason}`);
  await prisma.filamentSpool.create({ data: { ...parsed.data, accountId } });
  redirect("/filament?saved=1");
}

export async function updateSpool(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/filament");
  const parsed = await spoolDataFromForm(accountId, formData);
  if (!parsed.ok) redirect(`/filament/${id}/edit?error=${parsed.reason}`);
  await prisma.filamentSpool.updateMany({ where: { id, accountId }, data: parsed.data });
  redirect("/filament?saved=1");
}

// Quick action: filament came off the spool without a print job attached
// (job-linked usage is recorded by the jobs module). Clamped at zero, and a
// spool that hits zero is empty — no half-states to clean up later.
export async function logSpoolUsage(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/filament");
  const spool = await prisma.filamentSpool.findFirst({ where: { id, accountId } });
  if (!spool) redirect("/filament");

  const used = Math.max(0, num(formData.get("grams")) ?? 0);
  const wasted = Math.max(0, num(formData.get("wasteGrams")) ?? 0);
  if (used + wasted <= 0) redirect(`/filament/${id}?error=usage`);

  const remainingGrams = Math.max(0, spool.remainingGrams - used - wasted);
  // Zero means empty. Otherwise, using a spool means it is loaded and in use —
  // but a retired spool stays retired.
  const status =
    remainingGrams <= 0 ? "EMPTY" : spool.status === "IN_STOCK" ? "IN_USE" : spool.status;

  await prisma.filamentSpool.updateMany({
    where: { id, accountId },
    data: { remainingGrams, wasteGrams: { increment: wasted }, status },
  });
  redirect(`/filament/${id}`);
}

// One-tap status changes. Marking a spool empty also zeroes what is left on
// it — that is what "empty" means when he taps it.
export async function setSpoolStatus(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/filament");
  const status = str(formData.get("status"));
  if (!status || !(SPOOL_STATUSES as readonly string[]).includes(status)) {
    redirect(`/filament/${id}`);
  }
  await prisma.filamentSpool.updateMany({
    where: { id, accountId },
    data: { status, ...(status === "EMPTY" ? { remainingGrams: 0 } : {}) },
  });
  redirect(`/filament/${id}`);
}

// A spool that jobs were printed from is cost history — it can't be deleted,
// or those jobs lose what their filament cost.
export async function deleteSpool(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/filament");
  const useCount = await prisma.filamentUse.count({ where: { spoolId: id, accountId } });
  if (useCount > 0) redirect(`/filament/${id}?error=has-jobs`);
  await prisma.filamentSpool.deleteMany({ where: { id, accountId } });
  redirect("/filament");
}
