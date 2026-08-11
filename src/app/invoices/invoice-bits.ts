// Derived invoice/quote status — computed from payments + due date (and, for
// quotes, conversion state), never stored.

export type DerivedStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "ACCEPTED";

export function deriveInvoiceStatus(
  invoice: {
    status: string;
    totalCents: number;
    dueDate: Date | null;
    kind?: string;
    convertedToInvoiceId?: string | null;
  },
  paidCents: number,
): DerivedStatus {
  if (invoice.status === "CANCELLED") return "CANCELLED";
  if (invoice.kind === "QUOTE") {
    if (invoice.convertedToInvoiceId) return "ACCEPTED";
    return invoice.status === "DRAFT" ? "DRAFT" : "SENT";
  }
  if (invoice.status === "DRAFT") return "DRAFT";
  if (invoice.totalCents > 0 && paidCents >= invoice.totalCents) return "PAID";
  if (paidCents > 0) return "PARTIAL";
  if (invoice.dueDate && invoice.dueDate < new Date()) return "OVERDUE";
  return "SENT";
}

export const INVOICE_STATUS_LABELS: Record<DerivedStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  ACCEPTED: "Accepted → invoiced",
};

export function invoiceStatusTone(status: DerivedStatus): string {
  switch (status) {
    case "PAID":
    case "ACCEPTED":
      return "green";
    case "PARTIAL":
      return "blue";
    case "OVERDUE":
      return "red";
    case "SENT":
      return "amber";
    default:
      return "stone";
  }
}

// Money a customer still owes on a document: only real, live invoices count —
// quotes, drafts, and cancellations never show up as "due".
export function outstandingCentsOf(
  invoice: {
    status: string;
    totalCents: number;
    dueDate: Date | null;
    kind?: string;
    convertedToInvoiceId?: string | null;
  },
  paidCents: number,
): number {
  if (invoice.kind === "QUOTE") return 0;
  const st = deriveInvoiceStatus(invoice, paidCents);
  if (st === "DRAFT" || st === "CANCELLED") return 0;
  return Math.max(0, invoice.totalCents - paidCents);
}

// Income category used when an invoice payment lands on the books (SPEC §25).
export function incomeCategoryForDivision(division: string): string {
  switch (division) {
    case "TECH":
      return "3D-printed product sales";
    case "FARM":
      return "Other farm income";
    default:
      return "Other business income";
  }
}

export function paidCentsOf(payments: { amountCents: number }[]): number {
  return payments.reduce((s, p) => s + p.amountCents, 0);
}
