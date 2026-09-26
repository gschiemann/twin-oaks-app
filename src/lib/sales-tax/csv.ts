// The two bookkeeping CSVs from the design document. These are PORTABLE
// TRANSACTION DATA for an accountant — they are NOT My Alabama Taxes upload
// files and must never be labelled as one.
//
// Column order: exactly the document's suggested columns first, then extra
// audit columns appended at the END, so anything reading by position still
// lines up. Dates ISO YYYY-MM-DD, month key YYYY-MM, decimal dollars with
// two places, rates as an unformatted fraction (0.04 — never 4).

import { csvCell } from "@/lib/csv";
import { centsToDecimal, ppmToDecimal } from "./format";
import type { EngineResult } from "./types";

export const SALES_LINES_COLUMNS = [
  "report_period",
  "line_id",
  "invoice_id",
  "sale_date",
  "payment_date",
  "division",
  "description",
  "product_type",
  "delivery_city",
  "delivery_county",
  "delivery_state",
  "pretax_amount",
  "invoice_tax_collected",
  "invoice_total",
  "status",
  "source_document_id",
  // appended audit columns
  "transaction_id",
  "original_line_id",
  "customer",
  "tax_location",
  "tax_treatment",
  "exemption_reason",
  "evidence_document_id",
  "review_status",
] as const;

export const TAX_COMPONENTS_COLUMNS = [
  "report_period",
  "component_id",
  "line_id",
  "authority",
  "jurisdiction_code",
  "tax_type",
  "rate_type",
  "gross_amount",
  "deduction_amount",
  "taxable_amount",
  "rate",
  "expected_tax",
  "collected_tax",
  "exemption_reason",
  "review_status",
  // appended audit columns
  "difference",
  "rate_effective_date",
  "rate_source",
  "tax_treatment",
  "evidence_document_id",
  "invoice_id",
  "over_collected",
] as const;

// A BOM so Excel opens the file as UTF-8 (customer names and descriptions
// can carry accents or dashes). Still plain UTF-8 for every other reader.
const BOM = "﻿";

function toCsv(header: readonly string[], rows: unknown[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function salesLinesCsv(r: EngineResult): string {
  return toCsv(
    SALES_LINES_COLUMNS,
    r.salesLines.map((l) => [
      l.reportPeriod,
      l.lineId,
      l.invoiceNumber,
      l.saleDate,
      l.paymentDate,
      l.division,
      l.description,
      l.productType,
      l.deliveryCity,
      l.deliveryCounty,
      l.deliveryState,
      centsToDecimal(l.pretaxCents),
      centsToDecimal(l.taxCollectedCents),
      centsToDecimal(l.totalCents),
      l.status,
      l.sourceDocumentId,
      l.transactionId,
      l.originalLineId,
      l.customerName,
      l.locationName,
      l.treatment,
      l.exemptionReason,
      l.evidenceDocumentId,
      l.reviewStatus,
    ]),
  );
}

export function taxComponentsCsv(r: EngineResult): string {
  return toCsv(
    TAX_COMPONENTS_COLUMNS,
    r.components.map((c) => [
      c.reportPeriod,
      c.componentId,
      c.lineId,
      c.authority,
      c.jurisdictionCode,
      c.taxType,
      c.rateType,
      centsToDecimal(c.grossCents),
      centsToDecimal(c.deductionCents),
      centsToDecimal(c.taxableCents),
      c.ratePpm === null ? "" : ppmToDecimal(c.ratePpm),
      centsToDecimal(c.expectedTaxCents),
      centsToDecimal(c.collectedTaxCents),
      c.exemptionReason,
      c.reviewStatus,
      centsToDecimal(c.differenceCents),
      c.rateEffectiveDate,
      c.rateSource,
      c.taxTreatment,
      c.evidenceDocumentId,
      c.invoiceNumber,
      centsToDecimal(c.overCollectedCents ?? 0),
    ]),
  );
}
