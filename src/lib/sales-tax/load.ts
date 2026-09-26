// The only bridge between the database and the sales tax engine: reads one
// month's inputs for ONE account (every query scoped on accountId) and hands
// back plain data. Nothing here changes a record.

import { prisma } from "@/lib/db";
import { SALES_TAX_BASES, type SalesTaxBasis } from "@/lib/domain";
import { computeSalesTax } from "./engine";
import type { EngineInput, EngineResult, InvoiceIn } from "./types";

function monthRange(period: string): { start: Date; end: Date } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

export function asBasis(v: string | null | undefined): SalesTaxBasis | null {
  return v && (SALES_TAX_BASES as readonly string[]).includes(v) ? (v as SalesTaxBasis) : null;
}

const invoiceInclude = {
  lines: { orderBy: { sortOrder: "asc" as const } },
  payments: { orderBy: { date: "asc" as const } },
  customer: { select: { name: true, taxTreatment: true, taxExemptReason: true } },
};

export async function loadSalesTaxInput(
  accountId: string,
  period: string,
  generatedAt: Date = new Date(),
): Promise<EngineInput> {
  const { start, end } = monthRange(period);
  const inMonth = { gte: start, lt: end };

  const [profile, authorities, rates, locations, rules] = await Promise.all([
    prisma.businessProfile.findFirst({
      where: { accountId },
      select: { salesTaxBasis: true, salesTaxBasisApprovedBy: true },
    }),
    prisma.taxAuthority.findMany({ where: { accountId }, orderBy: { name: "asc" } }),
    prisma.taxRate.findMany({ where: { accountId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.taxLocation.findMany({ where: { accountId }, orderBy: { name: "asc" } }),
    prisma.salesTaxRule.findMany({ where: { accountId } }),
  ]);
  const basis = asBasis(profile?.salesTaxBasis);

  // Invoices that can land in (or be excluded from) this month under either
  // basis: issued in it, paid in it, or — on the payment basis — still unpaid.
  let invoices = await prisma.invoice.findMany({
    where: {
      accountId,
      kind: "INVOICE",
      OR: [
        { issueDate: inMonth },
        { payments: { some: { date: inMonth } } },
        ...(basis === "PAYMENT_DATE"
          ? [{ issueDate: { lt: end }, status: "SENT", payments: { none: {} } }]
          : []),
      ],
    },
    include: invoiceInclude,
    orderBy: { issueDate: "asc" },
  });

  // A refund is reported against its original sale (its treatment, place and
  // rate), so the invoices holding those originals come along too.
  const haveLines = new Set(invoices.flatMap((i) => i.lines.map((l) => l.id)));
  const wanted = [
    ...new Set(
      invoices.flatMap((i) =>
        i.lines.map((l) => l.originalLineId).filter((id): id is string => !!id),
      ),
    ),
  ].filter((id) => !haveLines.has(id));
  if (wanted.length > 0) {
    const originals = await prisma.invoice.findMany({
      where: { accountId, lines: { some: { id: { in: wanted } } } },
      include: invoiceInclude,
    });
    const have = new Set(invoices.map((i) => i.id));
    invoices = [...invoices, ...originals.filter((o) => !have.has(o.id))];
  }

  const sales = await prisma.livestockSale.findMany({
    where: { accountId, date: inMonth },
    orderBy: { date: "asc" },
  });

  const customerIds = [
    ...new Set([
      ...invoices.map((i) => i.customerId),
      ...sales.map((s) => s.customerId).filter((id): id is string => !!id),
    ]),
  ];
  const animalIds = [...new Set(sales.map((s) => s.animalId).filter((id): id is string => !!id))];
  const evidenceIds = [
    ...new Set(
      invoices.flatMap((i) =>
        i.lines.map((l) => l.evidenceDocumentId).filter((id): id is string => !!id),
      ),
    ),
  ];

  const [customerDocs, animalDocs, evidenceDocs, saleCustomers, animals, incomes] =
    await Promise.all([
      prisma.document.findMany({
        where: { accountId, ownerType: "CUSTOMER", ownerId: { in: customerIds } },
        select: { id: true, ownerId: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.document.findMany({
        where: { accountId, ownerType: "ANIMAL", ownerId: { in: animalIds } },
        select: { id: true, ownerId: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.document.findMany({
        where: { accountId, id: { in: evidenceIds } },
        select: { id: true },
      }),
      prisma.customer.findMany({
        where: { accountId, id: { in: customerIds } },
        select: { id: true, name: true },
      }),
      prisma.animal.findMany({
        where: { accountId, id: { in: animalIds } },
        select: { id: true, tagNumber: true, name: true },
      }),
      prisma.income.findMany({
        where: { accountId, date: inMonth },
        select: {
          id: true,
          date: true,
          amountCents: true,
          description: true,
          source: true,
          category: true,
        },
      }),
    ]);

  // Income the app posted itself (from an invoice payment or a livestock
  // sale) is not a separate sale — only independent entries are checked for
  // double counting.
  const incomeIds = incomes.map((i) => i.id);
  const [linkedPayments, linkedSales] = await Promise.all([
    prisma.payment.findMany({
      where: { accountId, incomeId: { in: incomeIds } },
      select: { incomeId: true },
    }),
    prisma.livestockSale.findMany({
      where: { accountId, incomeId: { in: incomeIds } },
      select: { incomeId: true },
    }),
  ]);
  const linked = new Set([...linkedPayments, ...linkedSales].map((x) => x.incomeId));

  const docsBy = (docs: { id: string; ownerId: string }[]) => {
    const m = new Map<string, string[]>();
    for (const d of docs) m.set(d.ownerId, [...(m.get(d.ownerId) ?? []), d.id]);
    return m;
  };
  const customerDocIds = docsBy(customerDocs);
  const animalDocIds = docsBy(animalDocs);
  const liveEvidence = new Set(evidenceDocs.map((d) => d.id));
  const customerName = new Map(saleCustomers.map((c) => [c.id, c.name]));
  const animalById = new Map(animals.map((a) => [a.id, a]));

  return {
    period,
    basis,
    basisApprovedBy: profile?.salesTaxBasisApprovedBy ?? null,
    authorities: authorities.map((a) => ({
      id: a.id,
      name: a.name,
      level: a.level,
      jurisdictionCode: a.jurisdictionCode,
      taxType: a.taxType,
    })),
    rates: rates.map((r) => ({
      id: r.id,
      authorityId: r.authorityId,
      rateClass: r.rateClass,
      rateTypeCode: r.rateTypeCode,
      ratePpm: r.ratePpm,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      source: r.source,
      confirmedAt: r.confirmedAt,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      city: l.city,
      county: l.county,
      state: l.state,
      postalCode: l.postalCode,
      insideCity: l.insideCity,
      policeJurisdiction: l.policeJurisdiction,
      authorityIds: splitIds(l.authorityIdsCsv),
    })),
    rules: rules.map((r) => ({
      productType: r.productType,
      treatment: r.treatment,
      rateClass: r.rateClass,
      exemptionReason: r.exemptionReason,
      requiresEvidence: r.requiresEvidence,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
    })),
    invoices: invoices.map(
      (i): InvoiceIn => ({
        id: i.id,
        number: i.number,
        kind: i.kind,
        status: i.status,
        division: i.division,
        issueDate: i.issueDate,
        customerId: i.customerId,
        customerName: i.customer.name,
        customerTaxTreatment: i.customer.taxTreatment,
        customerExemptReason: i.customer.taxExemptReason,
        customerDocumentIds: customerDocIds.get(i.customerId) ?? [],
        taxLocationId: i.taxLocationId,
        subtotalCents: i.subtotalCents,
        salesTaxCents: i.salesTaxCents,
        totalCents: i.totalCents,
        lines: i.lines.map((l) => ({
          id: l.id,
          sortOrder: l.sortOrder,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
          taxable: l.taxable,
          productType: l.productType,
          taxTreatmentOverride: l.taxTreatmentOverride,
          exemptionReason: l.exemptionReason,
          // A deleted document is no evidence at all.
          evidenceDocumentId:
            l.evidenceDocumentId && liveEvidence.has(l.evidenceDocumentId)
              ? l.evidenceDocumentId
              : null,
          originalLineId: l.originalLineId,
        })),
        payments: i.payments.map((p) => ({
          id: p.id,
          date: p.date,
          amountCents: p.amountCents,
          incomeId: p.incomeId,
        })),
      }),
    ),
    livestockSales: sales.map((s) => {
      const animal = s.animalId ? animalById.get(s.animalId) : undefined;
      return {
        id: s.id,
        date: s.date,
        salePriceCents: s.salePriceCents,
        buyerName: s.buyerName,
        customerId: s.customerId,
        customerName: s.customerId ? (customerName.get(s.customerId) ?? null) : null,
        animalLabel: animal ? `#${animal.tagNumber}${animal.name ? ` ${animal.name}` : ""}` : null,
        animalDocumentIds: s.animalId ? (animalDocIds.get(s.animalId) ?? []) : [],
        taxLocationId: s.taxLocationId,
        taxTreatmentOverride: s.taxTreatmentOverride,
        exemptionReason: s.exemptionReason,
        incomeId: s.incomeId,
      };
    }),
    incomes: incomes
      .filter((i) => !linked.has(i.id))
      .map((i) => ({
        id: i.id,
        date: i.date,
        amountCents: i.amountCents,
        description: i.description,
        source: i.source,
        category: i.category,
      })),
    generatedAt,
  };
}

export function splitIds(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function computeMonth(
  accountId: string,
  period: string,
  generatedAt: Date = new Date(),
): Promise<EngineResult> {
  return computeSalesTax(await loadSalesTaxInput(accountId, period, generatedAt));
}

/**
 * What a close commits to: every figure and row, but not when it was
 * computed. Two results with the same fingerprint file the same return.
 */
export function fingerprint(r: EngineResult): string {
  return JSON.stringify({
    basis: r.basis,
    salesLines: r.salesLines,
    components: r.components,
    summary: r.summary,
    totals: r.totals,
    excluded: r.excluded,
  });
}
