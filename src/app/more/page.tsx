import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";
import InstallHint from "@/components/InstallHint";

// Grouped so the list stays scannable on a phone now that every version has
// shipped — one flat list of 22 links is a wall, three short ones is a menu.
const groups = [
  {
    heading: "Money",
    links: [
      { href: "/invoices", label: "Invoices", desc: "Bill customers and track what's owed" },
      { href: "/invoices?kind=QUOTE", label: "Quotes", desc: "Price a job first — convert to an invoice on yes" },
      { href: "/customers", label: "Customers", desc: "Profiles, revenue, and open balances" },
      { href: "/bills", label: "Regular bills", desc: "What's due and when — nothing is posted without you" },
      { href: "/banking", label: "Bank matching", desc: "Upload your bank's CSV — see what you haven't recorded" },
      { href: "/mileage", label: "Mileage", desc: "Business trips logged for tax time" },
      { href: "/household", label: "Household & budgets", desc: "Personal spending, kept out of the business books" },
    ],
  },
  {
    heading: "The farm",
    links: [
      { href: "/livestock", label: "Flock", desc: "Every sheep — tags, parents, health, weights" },
      { href: "/livestock/sales", label: "Livestock sales", desc: "Who bought what, and what it earned" },
    ],
  },
  {
    heading: "The shop",
    links: [
      { href: "/jobs", label: "Print jobs", desc: "Cost, sale price, and profit per part" },
      { href: "/filament", label: "Filament", desc: "Spools on hand, grams left, what's running low" },
      { href: "/assets", label: "Equipment & assets", desc: "Tractors, printers, trailers — profiles and maintenance" },
    ],
  },
  {
    heading: "Find & file",
    links: [
      { href: "/assistant", label: "Ask about your books", desc: "Plain questions, answered from your own records" },
      { href: "/search", label: "Search", desc: "Find any expense, receipt, or record in seconds" },
      { href: "/documents", label: "Documents", desc: "Photos, manuals, warranties and paperwork" },
      { href: "/tax", label: "Tax Center", desc: "Year totals, flagged items, and the accountant package" },
      { href: "/tax/sales", label: "Sales tax", desc: "Monthly Alabama state + local figures, ready to file" },
      { href: "/settings/email", label: "Email receipts", desc: "Forward a receipt from your inbox — it lands in the Inbox" },
    ],
  },
  {
    heading: "Settings",
    links: [
      { href: "/settings/business", label: "Business profile", desc: "Your details — used on every document" },
      { href: "/settings/passkeys", label: "Face ID sign-in", desc: "Skip the password on devices you trust" },
      { href: "/settings/backups", label: "Backups", desc: "Automatic daily copies — download any of them" },
      { href: "/settings/testing", label: "Try it with sample data", desc: "Practice safely, then remove it — your records stay put" },
      { href: "/tickets", label: "Issues & ideas", desc: "Log bugs and feature requests while you test" },
      { href: "/settings/checklist", label: "Release checklist", desc: "Walk the workflows before calling it stable" },
    ],
  },
] as const;

export default function MorePage() {
  return (
    <div>
      <PageHeader title="More" />
      <InstallHint />

      {groups.map((g) => (
        <div key={g.heading} className="mb-4">
          <h2 className="mb-1.5 px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
            {g.heading}
          </h2>
          <Card className="divide-y divide-stone-100 p-0">
            {g.links.map((l) => (
              <Link key={l.href} href={l.href} className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-stone-900">{l.label}</span>
                  <span className="block text-sm text-stone-500">{l.desc}</span>
                </span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
              </Link>
            ))}
            {g.heading === "Settings" ? (
              <a href="/api/export" className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-stone-900">Download backup now</span>
                  <span className="block text-sm text-stone-500">
                    Full JSON export of every record — keep more than one copy
                  </span>
                </span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
              </a>
            ) : null}
          </Card>
        </div>
      ))}
    </div>
  );
}
