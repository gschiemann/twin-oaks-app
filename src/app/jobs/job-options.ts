// The three pick-lists every print-job form needs, loaded once and scoped to
// the account. A job that already points at a sold printer or an older
// invoice keeps that choice visible — editing a job must never silently
// blank a field just because the pick-list moved on.

import { prisma } from "@/lib/db";
import type { AssetOption, CustomerOption, InvoiceOption } from "./PrintJobForm";

export async function loadJobFormOptions(
  accountId: string,
  keep: { assetId?: string | null; invoiceId?: string | null } = {},
): Promise<{
  customers: CustomerOption[];
  assets: AssetOption[];
  invoices: InvoiceOption[];
}> {
  const [customers, assets, invoices] = await Promise.all([
    prisma.customer.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.asset.findMany({
      where: {
        accountId,
        ...(keep.assetId
          ? { OR: [{ status: "ACTIVE" }, { id: keep.assetId }] }
          : { status: "ACTIVE" }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    }),
    prisma.invoice.findMany({
      where: {
        accountId,
        ...(keep.invoiceId ? { OR: [{ kind: "INVOICE" }, { id: keep.invoiceId }] } : { kind: "INVOICE" }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, number: true, customer: { select: { name: true } } },
    }),
  ]);

  return {
    customers,
    assets,
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, customerName: i.customer.name })),
  };
}
