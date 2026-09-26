// Shared helpers for the sales tax pages (not server actions).

import type { EngineResult, Issue } from "@/lib/sales-tax/types";

/** Where the operator goes to fix an issue — one tap from the message. */
export function fixHref(issue: Issue, r: EngineResult): string {
  const review = `/tax/sales/review?month=${r.period}`;
  const f = issue.fix;
  switch (f.kind) {
    case "SETUP":
      return "/tax/sales/setup";
    case "INVOICE": {
      // The fix lives on the payment itself.
      if (issue.code === "INCOME_INCLUDES_TAX") return `/invoices/${f.id}#payments`;
      if (issue.code === "NO_LOCATION" || issue.code === "LOCATION_GONE")
        return `${review}#inv-${f.id}`;
      if (issue.code === "CUSTOMER_NO_REASON" || issue.code === "CUSTOMER_NO_CERT") {
        const customerId = r.salesLines.find((l) => l.transactionId === f.id)?.customerId;
        if (customerId) return `/customers/${customerId}`;
      }
      return `/invoices/${f.id}`;
    }
    case "LINE":
      return `${review}#line-${f.id}`;
    case "LIVESTOCK":
      return `${review}#ls-${f.id}`;
    case "LOCATION":
      return `/tax/sales/setup#loc-${f.id}`;
    case "RATE":
      return `/tax/sales/setup#auth-${f.authorityId}`;
    case "RULE":
      return `/tax/sales/setup#rule-${f.productType}`;
    case "INCOME":
      return `/income/${f.id}`;
  }
}

export function exportHref(
  period: string,
  format: "xlsx" | "lines" | "components",
  snapshotId?: string,
): string {
  return `/api/tax/sales/export?period=${period}&format=${format}${snapshotId ? `&snapshot=${snapshotId}` : ""}`;
}
