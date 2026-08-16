import Link from "next/link";
import { Card, PageHeader, btnSecondaryCls } from "@/components/ui";
import ReleaseChecklist from "@/components/ReleaseChecklist";

export const dynamic = "force-dynamic";

// FR-005 — the workflows to walk end-to-end before calling a version stable.
// Grouped the way the operator actually works, not by screen.
const GROUPS = [
  {
    title: "First full workflow test",
    hint: "One real transaction, start to finish. Watch for anything entered twice or calculated by hand.",
    items: [
      "Create a customer",
      "Create a quote and convert it to an invoice",
      "Add, edit and remove invoice line items",
      "Mark a line non-taxable and confirm the tax changes",
      "Verify subtotal, taxable amount, rate, tax and total",
      "Mark the invoice as sent",
      "Generate the packing list and print it",
      "Record a payment",
      "Confirm the payment appears in Income",
      "Find the transaction again from Search",
    ],
  },
  {
    title: "Purchases & receipts",
    items: [
      "Enter an expense by hand",
      "Snap a receipt and categorize it from the Inbox",
      "Forward an emailed receipt and confirm it arrives",
      "Attach a receipt to an existing expense",
      "Assign a purchase to a piece of equipment",
      "Confirm the original document opens from the expense",
    ],
  },
  {
    title: "Records & reporting",
    items: [
      "Log equipment maintenance and check cost-per-hour",
      "Log a mileage trip",
      "Check Tax Center totals against the transactions",
      "Download each accountant CSV and open it",
      "Search by word, by dollar amount and by date",
    ],
  },
  {
    title: "Documents",
    items: [
      "Business details correct on the invoice",
      "Business details correct on the packing list",
      "Print an invoice",
      "Save an invoice as PDF from the phone",
      "Confirm an already-sent invoice is unchanged after editing Settings",
    ],
  },
  {
    title: "Safety & devices",
    items: [
      "Back up now, then download the backup",
      "Sign out and sign back in with the password",
      "Sign in with Face ID",
      "Confirm a signed-out visitor is blocked from every page",
      "Open the app on each device you actually use",
    ],
  },
] as const;

export default function ChecklistPage() {
  return (
    <div>
      <PageHeader
        title="Release checklist"
        sub="Test whole workflows, not single screens. Progress is kept on this device."
      />

      <Card className="mb-4 border-stone-200 bg-stone-50 text-sm text-stone-600">
        Anything that feels slow, confusing, doubled-up or hand-calculated becomes a tracker
        item — log it as you go from{" "}
        <Link href="/tickets/new" className="font-medium text-oak-700 underline">
          New issue
        </Link>
        .
      </Card>

      <ReleaseChecklist groups={GROUPS.map((g) => ({ ...g, items: [...g.items] }))} />

      <Link href="/more" className={`${btnSecondaryCls} mt-4`}>
        Back to More
      </Link>
    </div>
  );
}
