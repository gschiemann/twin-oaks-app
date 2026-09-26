"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { isValidPeriod } from "@/lib/sales-tax/format";
import { computeMonth, fingerprint } from "@/lib/sales-tax/load";
import type { EngineResult } from "@/lib/sales-tax/types";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function periodFrom(formData: FormData): string {
  const p = str(formData.get("period"));
  if (!isValidPeriod(p)) redirect("/tax/sales");
  return p;
}

// Closing a month freezes exactly what will be filed: the full result is
// recomputed HERE (never taken from the page) and saved as a snapshot any
// export can regenerate. A later change is saved as a CORRECTION, never by
// rewriting the close.
export async function closeMonth(formData: FormData) {
  const accountId = await requireAccountId();
  const period = periodFrom(formData);
  const back = `/tax/sales?month=${period}`;
  const reviewerName = str(formData.get("reviewerName"));
  if (!reviewerName) redirect(`${back}&error=reviewer`);

  const result = await computeMonth(accountId, period);
  if (!result.readyToFile) redirect(`${back}&error=blocked`);

  const latest = await prisma.salesTaxSnapshot.findFirst({
    where: { accountId, period },
    orderBy: { createdAt: "desc" },
  });
  if (
    latest &&
    fingerprint(JSON.parse(latest.snapshotJson) as EngineResult) === fingerprint(result)
  ) {
    redirect(`${back}&saved=unchanged`);
  }

  await prisma.salesTaxSnapshot.create({
    data: {
      accountId,
      period,
      kind: latest ? "CORRECTION" : "CLOSE",
      basis: result.basis ?? "",
      reviewerName,
      note: str(formData.get("note")),
      grossSalesCents: result.totals.grossSalesCents,
      taxableCents: result.totals.stateTaxableCents,
      taxCents: result.totals.expectedTaxCents,
      snapshotJson: JSON.stringify(result),
    },
  });
  redirect(`${back}&saved=${latest ? "correction" : "closed"}`);
}

// The confirmation from the state's portal, kept against the snapshot it
// was filed from.
export async function recordFiling(formData: FormData) {
  const accountId = await requireAccountId();
  const period = periodFrom(formData);
  const back = `/tax/sales?month=${period}`;
  const snapshotId = str(formData.get("snapshotId"));
  const snapshot = snapshotId
    ? await prisma.salesTaxSnapshot.findFirst({ where: { id: snapshotId, accountId, period } })
    : null;
  if (!snapshot) redirect(`${back}&error=no-close`);

  const filedOn = parseDateInput(formData.get("filedOn"));
  const filedBy = str(formData.get("filedBy"));
  if (!filedOn || !filedBy) redirect(`${back}&error=filing`);
  const amountPaidCents = parseDollarsToCents(formData.get("amountPaid"));

  await prisma.salesTaxFiling.create({
    data: {
      accountId,
      period,
      snapshotId: snapshot.id,
      filedOn,
      confirmationNumber: str(formData.get("confirmationNumber")),
      amountPaidCents,
      filedBy,
      notes: str(formData.get("notes")),
    },
  });
  redirect(`${back}&saved=filed`);
}

export async function deleteFiling(formData: FormData) {
  const accountId = await requireAccountId();
  const period = periodFrom(formData);
  const id = str(formData.get("id"));
  if (id) await prisma.salesTaxFiling.deleteMany({ where: { id, accountId } });
  redirect(`/tax/sales?month=${period}`);
}
