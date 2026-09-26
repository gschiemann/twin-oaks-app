"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { PRODUCT_TYPES, TAX_TREATMENTS_SALES } from "@/lib/domain";
import { isValidPeriod } from "@/lib/sales-tax/format";

// Classification is tax METADATA — which kind of sale a line is and, if it
// differs from its kind's rule, the person's decision for it. Amounts are
// never touched, so this works on sent invoices too (that's how historic
// lines get reviewed instead of being changed automatically).

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function oneOf<T extends string>(list: readonly T[], v: string | null): T | null {
  return v && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function back(formData: FormData, saved: string, anchor: string): never {
  const p = str(formData.get("period"));
  const all = formData.get("all") ? "&all=1" : "";
  const inv = str(formData.get("invoice"));
  const only = inv ? `&invoice=${encodeURIComponent(inv)}` : "";
  redirect(
    `/tax/sales/review?${isValidPeriod(p) ? `month=${p}&` : ""}saved=${saved}${all}${only}#${anchor}`,
  );
}

async function ownedDocument(accountId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const doc = await prisma.document.findFirst({ where: { id, accountId }, select: { id: true } });
  return doc?.id ?? null;
}

async function ownedLocation(accountId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const loc = await prisma.taxLocation.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
  return loc?.id ?? null;
}

export async function classifyLine(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("lineId"));
  const line = id
    ? await prisma.invoiceLine.findFirst({
        where: { id, invoice: { accountId } },
        select: { id: true },
      })
    : null;
  if (!line) back(formData, "missing", "top");

  const productType = oneOf(PRODUCT_TYPES, str(formData.get("productType"))) ?? "UNCLASSIFIED";
  const override = oneOf(TAX_TREATMENTS_SALES, str(formData.get("taxTreatmentOverride")));
  let originalLineId: string | null = null;
  const originalId = str(formData.get("originalLineId"));
  if (productType === "REFUND" && originalId && originalId !== line.id) {
    const original = await prisma.invoiceLine.findFirst({
      where: { id: originalId, invoice: { accountId } },
      select: { id: true, productType: true },
    });
    if (original && original.productType !== "REFUND") originalLineId = original.id;
  }

  await prisma.invoiceLine.update({
    where: { id: line.id },
    data: {
      productType,
      taxTreatmentOverride: override,
      exemptionReason: str(formData.get("exemptionReason")),
      evidenceDocumentId: await ownedDocument(accountId, str(formData.get("evidenceDocumentId"))),
      originalLineId,
    },
  });
  back(formData, "line", `line-${line.id}`);
}

// "Every unclassified line on this invoice is a …" — one tap for the common
// case of a historic invoice that only sold one kind of thing.
export async function classifyInvoiceLines(formData: FormData) {
  const accountId = await requireAccountId();
  const invoiceId = str(formData.get("invoiceId"));
  const productType = oneOf(PRODUCT_TYPES, str(formData.get("productType")));
  const invoice = invoiceId
    ? await prisma.invoice.findFirst({ where: { id: invoiceId, accountId }, select: { id: true } })
    : null;
  if (!invoice || !productType || productType === "UNCLASSIFIED") back(formData, "missing", "top");
  await prisma.invoiceLine.updateMany({
    where: { invoiceId: invoice.id, productType: "UNCLASSIFIED" },
    data: { productType },
  });
  back(formData, "lines", `inv-${invoice.id}`);
}

export async function setInvoiceLocation(formData: FormData) {
  const accountId = await requireAccountId();
  const invoiceId = str(formData.get("invoiceId"));
  const invoice = invoiceId
    ? await prisma.invoice.findFirst({ where: { id: invoiceId, accountId }, select: { id: true } })
    : null;
  if (!invoice) back(formData, "missing", "top");
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { taxLocationId: await ownedLocation(accountId, str(formData.get("taxLocationId"))) },
  });
  back(formData, "location", `inv-${invoice.id}`);
}

export async function classifyLivestockSale(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("saleId"));
  const sale = id
    ? await prisma.livestockSale.findFirst({ where: { id, accountId }, select: { id: true } })
    : null;
  if (!sale) back(formData, "missing", "top");
  await prisma.livestockSale.update({
    where: { id: sale.id },
    data: {
      taxLocationId: await ownedLocation(accountId, str(formData.get("taxLocationId"))),
      taxTreatmentOverride: oneOf(TAX_TREATMENTS_SALES, str(formData.get("taxTreatmentOverride"))),
      exemptionReason: str(formData.get("exemptionReason")),
    },
  });
  back(formData, "sale", `ls-${sale.id}`);
}
