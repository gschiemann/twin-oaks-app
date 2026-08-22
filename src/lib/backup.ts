// Backup payload builder (SPEC §32 — "never rely on only one copy of
// important records"). Shared by the on-demand download (/api/export) and
// the nightly automatic backup (/api/cron/backup).

import { prisma } from "@/lib/db";

export const BACKUP_PREFIX = "backups/";
export const BACKUP_KEEP = 30; // ~a month of dailies

// Pass an accountId for a single business's books (the user-facing export);
// omit it for the operational whole-database dump the nightly cron writes.
export async function buildBackup(accountId?: string) {
  const where = accountId ? { accountId } : undefined;
  // EVERY table with an accountId belongs here. A model added to the schema
  // but forgotten here is silent data loss at restore time — when you add a
  // model, add it to this list in the same commit.
  const [
    vendors,
    receipts,
    receiptLines,
    expenses,
    incomes,
    assets,
    maintenance,
    customers,
    invoices,
    invoiceLines,
    payments,
    mileage,
    householdExpenses,
    householdBudgets,
    recurringHousehold,
    animals,
    animalEvents,
    livestockSales,
    filamentSpools,
    printJobs,
    filamentUses,
    bankTransactions,
    bankImportProfiles,
    documents,
    recurringBills,
  ] = await Promise.all([
    prisma.vendor.findMany({ where }),
    prisma.receipt.findMany({ where }),
    prisma.receiptLine.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.income.findMany({ where }),
    prisma.asset.findMany({ where }),
    prisma.maintenanceRecord.findMany({ where }),
    prisma.customer.findMany({ where }),
    prisma.invoice.findMany({ where }),
    prisma.invoiceLine.findMany({ where: accountId ? { invoice: { accountId } } : undefined }),
    prisma.payment.findMany({ where }),
    prisma.mileageLog.findMany({ where }),
    prisma.householdExpense.findMany({ where }),
    prisma.householdBudget.findMany({ where }),
    prisma.recurringHousehold.findMany({ where }),
    prisma.animal.findMany({ where }),
    prisma.animalEvent.findMany({ where }),
    prisma.livestockSale.findMany({ where }),
    prisma.filamentSpool.findMany({ where }),
    prisma.printJob.findMany({ where }),
    prisma.filamentUse.findMany({ where }),
    prisma.bankTransaction.findMany({ where }),
    prisma.bankImportProfile.findMany({ where }),
    prisma.document.findMany({ where }),
    prisma.recurringBill.findMany({ where }),
  ]);

  const data = {
    vendors,
    receipts,
    receiptLines,
    expenses,
    incomes,
    assets,
    maintenance,
    customers,
    invoices,
    invoiceLines,
    payments,
    mileage,
    householdExpenses,
    householdBudgets,
    recurringHousehold,
    animals,
    animalEvents,
    livestockSales,
    filamentSpools,
    printJobs,
    filamentUses,
    bankTransactions,
    bankImportProfiles,
    documents,
    recurringBills,
  };

  return {
    app: "twin-oaks-os",
    schemaVersion: 5,
    exportedAt: new Date().toISOString(),
    // Derived from `data` itself, so a table can never appear in the export
    // but go missing from the counts (or vice versa).
    counts: Object.fromEntries(
      Object.entries(data).map(([key, rows]) => [key, rows.length]),
    ) as Record<keyof typeof data, number>,
    // NOTE: receipt/document FILES are not inlined — `filePath` on each
    // receipt/document points at the stored original. The accountant ZIP
    // (/api/export/package) bundles the originals themselves (SPEC §28).
    data,
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
