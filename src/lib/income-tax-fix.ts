// Takes sales tax back out of income booked before payments were split
// (see src/lib/sales-tax/income-fix.ts for the rules). Account-scoped; used by
// the confirmed "Fix" on an invoice payment and by the owner's one-time fix.

import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { corrected, taxHeldInIncome, type TaxHeld } from "@/lib/sales-tax/income-fix";

export async function findTaxHeldInIncome(
  accountId: string,
  invoiceId?: string,
): Promise<TaxHeld[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      accountId,
      kind: "INVOICE",
      salesTaxCents: { gt: 0 },
      totalCents: { gt: 0 },
      ...(invoiceId ? { id: invoiceId } : {}),
      payments: { some: { incomeId: { not: null } } },
    },
    select: {
      id: true,
      number: true,
      totalCents: true,
      salesTaxCents: true,
      payments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, amountCents: true, incomeId: true },
      },
    },
  });
  const incomeIds = invoices.flatMap((i) =>
    i.payments.map((p) => p.incomeId).filter((v): v is string => !!v),
  );
  const incomes = incomeIds.length
    ? await prisma.income.findMany({
        where: { accountId, id: { in: incomeIds } },
        select: { id: true, amountCents: true, notes: true, description: true },
      })
    : [];
  return taxHeldInIncome(invoices, incomes);
}

/**
 * Apply the corrections. Each row is updated only if its amount is still what
 * was read, so a double tap — or two servers running the one-time fix at the
 * same moment — can never take the tax out twice.
 */
export async function takeTaxOut(
  accountId: string,
  held: TaxHeld[],
  when: Date = new Date(),
): Promise<{ rows: number; taxCents: number }> {
  let rows = 0;
  let taxCents = 0;
  for (const h of held) {
    const res = await prisma.income.updateMany({
      where: { id: h.income.id, accountId, amountCents: h.income.amountCents },
      data: corrected(h, formatDate(when)),
    });
    if (res.count > 0) {
      rows += 1;
      taxCents += h.taxCents;
    }
  }
  return { rows, taxCents };
}
