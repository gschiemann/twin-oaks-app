// Backup payload builder (SPEC §32 — "never rely on only one copy of
// important records"). Shared by the on-demand download (/api/export) and
// the nightly automatic backup (/api/cron/backup).

import { prisma } from "@/lib/db";

export const BACKUP_PREFIX = "backups/";
export const BACKUP_KEEP = 30; // ~a month of dailies

export async function buildBackup() {
  const [
    vendors,
    receipts,
    expenses,
    incomes,
    assets,
    maintenance,
    customers,
    invoices,
    invoiceLines,
    payments,
    mileage,
  ] = await Promise.all([
    prisma.vendor.findMany(),
    prisma.receipt.findMany(),
    prisma.expense.findMany(),
    prisma.income.findMany(),
    prisma.asset.findMany(),
    prisma.maintenanceRecord.findMany(),
    prisma.customer.findMany(),
    prisma.invoice.findMany(),
    prisma.invoiceLine.findMany(),
    prisma.payment.findMany(),
    prisma.mileageLog.findMany(),
  ]);

  return {
    app: "twin-oaks-os",
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    counts: {
      vendors: vendors.length,
      receipts: receipts.length,
      expenses: expenses.length,
      incomes: incomes.length,
      assets: assets.length,
      maintenance: maintenance.length,
      customers: customers.length,
      invoices: invoices.length,
      invoiceLines: invoiceLines.length,
      payments: payments.length,
      mileage: mileage.length,
    },
    // NOTE: receipt/document FILES are not inlined — `filePath` on each
    // receipt points at the stored original. A future ZIP export bundles
    // the images themselves (SPEC §28).
    data: {
      vendors,
      receipts,
      expenses,
      incomes,
      assets,
      maintenance,
      customers,
      invoices,
      invoiceLines,
      payments,
      mileage,
    },
  };
}

export function backupFileName(now = new Date()): string {
  return `${BACKUP_PREFIX}twin-oaks-backup-${now.toISOString().slice(0, 10)}.json`;
}

// Writes a dated backup to Blob storage and prunes old ones. Returns null
// when Blob isn't configured (local dev) rather than throwing.
export async function writeBackupToBlob(): Promise<{ url: string; bytes: number } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const { put, list, del } = await import("@vercel/blob");
  const payload = JSON.stringify(await buildBackup(), null, 2);

  const blob = await put(backupFileName(), payload, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false, // one canonical file per day; a re-run overwrites
    allowOverwrite: true,
  });

  // Prune: keep the newest BACKUP_KEEP files.
  const { blobs } = await list({ prefix: BACKUP_PREFIX });
  const stale = blobs
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
    .slice(BACKUP_KEEP);
  if (stale.length > 0) {
    await del(stale.map((b) => b.url)).catch(() => {});
  }

  return { url: blob.url, bytes: Buffer.byteLength(payload) };
}
