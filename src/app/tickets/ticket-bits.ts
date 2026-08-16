// Internal bug / feature tracker (FR-004) — shared constants + Chip tones.
// Page files export only Next-recognized fields, so the ticket vocabulary
// lives here (same pattern as expense-bits / invoice-bits). Values mirror the
// string pseudo-enums on the Ticket model.

export const TICKET_KINDS = ["BUG", "FR", "UI", "TAX"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const KIND_LABELS: Record<TicketKind, string> = {
  BUG: "Bug",
  FR: "Feature request",
  UI: "UI / workflow",
  TAX: "Accounting / tax",
};

// Workflow order — a ticket walks this list left to right.
export const TICKET_STATUSES = [
  "NEW",
  "WORKING",
  "READY_FOR_TESTING",
  "TESTING",
  "COMPLETE",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: "New",
  WORKING: "Working",
  READY_FOR_TESTING: "Ready for testing",
  TESTING: "Testing",
  COMPLETE: "Complete",
};

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type TicketPriority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export function kindTone(kind: string): string {
  switch (kind) {
    case "BUG":
      return "red";
    case "FR":
      return "blue";
    case "UI":
      return "indigo";
    case "TAX":
      return "amber";
    default:
      return "stone";
  }
}

export function statusTone(status: string): string {
  switch (status) {
    case "COMPLETE":
      return "green";
    case "TESTING":
    case "READY_FOR_TESTING":
      return "blue";
    case "WORKING":
      return "amber";
    default:
      return "stone";
  }
}

export function priorityTone(priority: string): string {
  switch (priority) {
    case "HIGH":
      return "red";
    case "MEDIUM":
      return "amber";
    default:
      return "stone";
  }
}
