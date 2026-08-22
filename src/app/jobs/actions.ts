"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { PRINT_JOB_STATUSES } from "@/lib/domain";

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

// Time is typed the way the printer shows it — hours in one box, minutes in
// the other — and stored as plain minutes. Both boxes empty means "not set".
function minutesFromForm(
  formData: FormData,
  hoursField: string,
  minutesField: string,
): number | null {
  const hours = num(formData.get(hoursField));
  const minutes = num(formData.get(minutesField));
  if (hours == null && minutes == null) return null;
  const total = Math.max(0, hours ?? 0) * 60 + Math.max(0, minutes ?? 0);
  return Math.round(total);
}

function wholeAtLeastZero(value: number | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Math.trunc(value);
  return n > 0 ? n : 0;
}

// Numbering is per account: every shop starts at JOB-001. Gap-tolerant —
// deleting JOB-004 never makes the next job collide with an existing number.
// (Same approach as nextInvoiceNumber in src/app/invoices/actions.ts.)
async function nextJobNumber(accountId: string): Promise<string> {
  const count = await prisma.printJob.count({ where: { accountId } });
  for (let n = count + 1; n < count + 50; n++) {
    const jobNumber = `JOB-${String(n).padStart(3, "0")}`;
    const exists = await prisma.printJob.findFirst({
      where: { accountId, jobNumber },
      select: { id: true },
    });
    if (!exists) return jobNumber;
  }
  return `JOB-${Date.now()}`;
}

// A customer / printer / invoice id posted by the browser only counts if it
// really belongs to this account — anything else is quietly dropped.
async function ownedId(
  accountId: string,
  table: "customer" | "asset" | "invoice",
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const where = { id, accountId };
  const select = { id: true };
  const row =
    table === "customer"
      ? await prisma.customer.findFirst({ where, select })
      : table === "asset"
        ? await prisma.asset.findFirst({ where, select })
        : await prisma.invoice.findFirst({ where, select });
  return row ? row.id : null;
}

async function jobDataFromForm(accountId: string, formData: FormData) {
  const partName = str(formData.get("partName"));
  if (!partName) return null;

  const status = str(formData.get("status"));

  return {
    partName,
    partNumber: str(formData.get("partNumber")),
    description: str(formData.get("description")),
    customerId: await ownedId(accountId, "customer", str(formData.get("customerId"))),
    printerAssetId: await ownedId(accountId, "asset", str(formData.get("printerAssetId"))),
    invoiceId: await ownedId(accountId, "invoice", str(formData.get("invoiceId"))),
    quantity: wholeAtLeastZero(num(formData.get("quantity")), 1),
    failedCount: wholeAtLeastZero(num(formData.get("failedCount")), 0),
    printMinutes: minutesFromForm(formData, "printHours", "printMins"),
    laborMinutes: minutesFromForm(formData, "laborHours", "laborMins"),
    machineRateCentsPerHour: parseDollarsToCents(formData.get("machineRate")),
    laborRateCentsPerHour: parseDollarsToCents(formData.get("laborRate")),
    packagingCostCents: parseDollarsToCents(formData.get("packagingCost")),
    shippingCostCents: parseDollarsToCents(formData.get("shippingCost")),
    otherCostCents: parseDollarsToCents(formData.get("otherCost")),
    salePriceCents: parseDollarsToCents(formData.get("salePrice")),
    startedAt: parseDateInput(formData.get("startedAt")),
    completedAt: parseDateInput(formData.get("completedAt")),
    notes: str(formData.get("notes")),
    ...(status && (PRINT_JOB_STATUSES as readonly string[]).includes(status) ? { status } : {}),
  };
}

export async function createJob(formData: FormData) {
  const accountId = await requireAccountId();
  const data = await jobDataFromForm(accountId, formData);
  if (!data) redirect("/jobs/new?error=missing");
  const jobNumber = await nextJobNumber(accountId);
  await prisma.printJob.create({ data: { ...data, accountId, jobNumber } });
  redirect("/jobs?saved=1");
}

export async function updateJob(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/jobs");
  const data = await jobDataFromForm(accountId, formData);
  if (!data) redirect(`/jobs/${id}/edit?error=missing`);
  await prisma.printJob.updateMany({ where: { id, accountId }, data });
  redirect("/jobs?saved=1");
}

// One-tap status moves from the job page — "Start printing", "Mark done".
export async function setJobStatus(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const to = str(formData.get("to"));
  if (!id) redirect("/jobs");
  if (!to || !(PRINT_JOB_STATUSES as readonly string[]).includes(to)) {
    redirect(`/jobs/${id}`);
  }

  const job = await prisma.printJob.findFirst({ where: { id, accountId } });
  if (!job) redirect("/jobs");

  // Starting and finishing stamp their dates the first time, so the owner
  // never has to remember to type them.
  const now = new Date();
  const stamps: { startedAt?: Date; completedAt?: Date } = {};
  if (to === "PRINTING" && !job.startedAt) stamps.startedAt = now;
  if ((to === "DONE" || to === "SHIPPED") && !job.completedAt) stamps.completedAt = now;

  await prisma.printJob.updateMany({ where: { id, accountId }, data: { status: to, ...stamps } });
  redirect(`/jobs/${id}?saved=status`);
}

export async function deleteJob(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/jobs");

  // Deleting a job gives every gram it used back to its spool first —
  // otherwise the filament shelf would quietly lose material.
  const uses = await prisma.filamentUse.findMany({ where: { printJobId: id, accountId } });
  for (const use of uses) await returnGramsToSpool(accountId, use.spoolId, use.grams, use.wasteGrams);
  await prisma.printJob.deleteMany({ where: { id, accountId } });
  redirect("/jobs?deleted=1");
}

// ── Filament used on a job ───────────────────────────────────────────────
// Recording a use is also an inventory move: the grams come off the spool
// (parts + waste), and a spool that hits zero is marked Empty. Removing the
// use puts the grams back. The spool is always proven to belong to this
// account before a single gram is written.

async function takeGramsFromSpool(
  accountId: string,
  spoolId: string,
  grams: number,
  wasteGrams: number,
): Promise<void> {
  const spool = await prisma.filamentSpool.findFirst({ where: { id: spoolId, accountId } });
  if (!spool) return;
  const pulled = Math.max(0, grams) + Math.max(0, wasteGrams);
  const remaining = Math.max(0, spool.remainingGrams - pulled);
  await prisma.filamentSpool.updateMany({
    where: { id: spoolId, accountId },
    data: {
      remainingGrams: remaining,
      wasteGrams: Math.max(0, spool.wasteGrams + Math.max(0, wasteGrams)),
      // A retired spool stays retired; anything else that runs out is Empty.
      ...(remaining <= 0 && spool.status !== "RETIRED" ? { status: "EMPTY" } : {}),
      ...(remaining > 0 && spool.status === "IN_STOCK" ? { status: "IN_USE" } : {}),
    },
  });
}

async function returnGramsToSpool(
  accountId: string,
  spoolId: string,
  grams: number,
  wasteGrams: number,
): Promise<void> {
  const spool = await prisma.filamentSpool.findFirst({ where: { id: spoolId, accountId } });
  if (!spool) return;
  const givenBack = Math.max(0, grams) + Math.max(0, wasteGrams);
  // A spool can never hold more than it started with.
  const remaining = Math.min(spool.totalGrams, Math.max(0, spool.remainingGrams + givenBack));
  await prisma.filamentSpool.updateMany({
    where: { id: spoolId, accountId },
    data: {
      remainingGrams: remaining,
      wasteGrams: Math.max(0, spool.wasteGrams - Math.max(0, wasteGrams)),
      ...(remaining > 0 && spool.status === "EMPTY" ? { status: "IN_USE" } : {}),
    },
  });
}

export async function addFilamentUse(formData: FormData) {
  const accountId = await requireAccountId();
  const printJobId = str(formData.get("printJobId"));
  if (!printJobId) redirect("/jobs");

  const job = await prisma.printJob.findFirst({
    where: { id: printJobId, accountId },
    select: { id: true },
  });
  if (!job) redirect("/jobs");

  const spoolId = str(formData.get("spoolId"));
  const grams = num(formData.get("grams"));
  if (!spoolId || grams == null || grams <= 0) redirect(`/jobs/${printJobId}?error=grams`);

  // The spool must be this account's before anything is written.
  const spool = await prisma.filamentSpool.findFirst({
    where: { id: spoolId, accountId },
    select: { id: true },
  });
  if (!spool) redirect(`/jobs/${printJobId}?error=spool`);

  const wasteGrams = Math.max(0, num(formData.get("wasteGrams")) ?? 0);

  await prisma.filamentUse.create({
    data: { accountId, printJobId, spoolId, grams, wasteGrams },
  });
  await takeGramsFromSpool(accountId, spoolId, grams, wasteGrams);

  redirect(`/jobs/${printJobId}?saved=filament`);
}

export async function deleteFilamentUse(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const printJobId = str(formData.get("printJobId"));
  if (id) {
    const use = await prisma.filamentUse.findFirst({ where: { id, accountId } });
    if (use) {
      await prisma.filamentUse.deleteMany({ where: { id, accountId } });
      await returnGramsToSpool(accountId, use.spoolId, use.grams, use.wasteGrams);
    }
  }
  redirect(printJobId ? `/jobs/${printJobId}?saved=filament-removed` : "/jobs");
}
