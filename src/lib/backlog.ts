// The canonical testing backlog (FR-004).
//
// This lives in code rather than only in prisma/seed.ts because the seed
// script runs against a LOCAL database — it never touches production. Any
// item defined here is created on the live site the first time the tracker
// is opened, matched by `ref`, so this list and the operator's real tracker
// stay in agreement without ever overwriting edits they have made.

import { prisma } from "@/lib/db";
import { OWNER_ACCOUNT_ID } from "@/lib/session";

export type BacklogItem = {
  kind: "BUG" | "FR" | "UI" | "TAX";
  number: number;
  title: string;
  description: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  status: "NEW" | "WORKING" | "READY_FOR_TESTING" | "TESTING" | "COMPLETE";
  devNotes?: string;
};

export const BACKLOG: BacklogItem[] = [
  {
    kind: "BUG",
    number: 1,
    title: "Automatic sales tax calculation",
    description:
      "Sales tax had to be calculated and typed by hand. Needs a default rate in Settings, automatic calculation on taxable lines, recalculation when anything changes, per-item taxable flag, a rate override, a clear subtotal/taxable/rate/tax/total breakdown, and the rate stored with the transaction. Future: rate by customer location and product type.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "Default rate on the Business profile. Tax computed in src/lib/tax.ts and mirrored live in the line editor. Per-line 'Taxable' checkbox, manual override, and the rate stored per invoice so later changes never rewrite history. Per-customer override shipped too (own rate / exempt with certificate). Location- and product-based rates still open — those need a rate service.",
  },
  {
    kind: "BUG",
    number: 2,
    title: "Receipt upload didn't work from mobile",
    description:
      "Files could not be uploaded from the phone. Two separate causes: (1) the file inputs carried capture=environment, which on iOS opens the camera and hides Photo Library and Browse Files, so an existing photo or an emailed PDF could not be chosen at all; (2) uploads went through a server action, and the hosting platform caps a request body at about 4.5 MB — less than a single 12-megapixel iPhone photo — so large captures would have failed regardless.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "Add-receipt now has two buttons: 'Take photo' (keeps capture) and 'Choose file' (no capture — reaches Photos/iCloud/Files and accepts PDFs). Attach-to-receipt and bug-screenshot inputs also dropped capture. Files go browser → blob storage directly via a token minted behind the login gate, so the body limit is out of the path; the multipart route remains for local dev. Photos are downscaled to 2000px JPEG on-device (4.2 MB → ~556 KB), which also normalizes iPhone HEIC. Preview, size, progress and real error messages added. REGRESSION FOUND ON iPad (PDF → \"didn't come through\"), fixed in v3.4: the file's bytes are now read the moment it is picked (an iCloud file handle can go stale by send time and the body leaves empty — photos were immune because shrinking re-encodes them, PDFs weren't), a failed direct-to-storage upload now falls back to the server route for small files, and every failure names its actual stage (unreadable body / empty file / storage not connected / sign-in expired) instead of one catch-all message. v3.6 closed the real root cause: the deployment's Blob store was never connected, so there was nowhere to put files at all — originals are now stored in the database automatically whenever no Blob store is connected (photos and PDFs up to ~4 MB), so uploads work with zero configuration; connecting the Blob store remains the upgrade path for bigger files.",
  },
  {
    kind: "FR",
    number: 1,
    title: "Packing list generator",
    description:
      "Generate a packing list from an order/invoice with business info, customer, shipping address, order number, date, item descriptions, quantities ordered and packed, checkboxes, notes, print and PDF. Future: QR/barcode scanning, partial shipments, backorders, tracking.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "At /invoices/<id>/packing, linked from the invoice. No prices shown. Ship-to falls back to the customer address; pen-friendly boxes for quantity packed and notes. Scanning, partial shipments and backorders still open.",
  },
  {
    kind: "FR",
    number: 2,
    title: "AI assistant integration",
    description:
      "Integrate an AI assistant through an API rather than giving unrestricted app access: analyze expenses, help categorize, review invoices, find missing information, analyze equipment and print-job costs, answer questions about stored records, help build reports, flag bookkeeping issues. Permission-based, limited to exposed data, with confirmation required before anything is changed, deleted, sent or finalized.",
    priority: "MEDIUM",
    status: "NEW",
  },
  {
    kind: "FR",
    number: 3,
    title: "AI / developer testing mode",
    description:
      "A QA mode that hands the AI the current screen name, its fields/buttons/actions and sample data, with an 'Analyze this screen' function returning UX suggestions, likely bugs, missing functions and test cases — plus exportable errors and whole-workflow analysis, without granting remote access to the machine.",
    priority: "MEDIUM",
    status: "NEW",
  },
  {
    kind: "FR",
    number: 4,
    title: "Internal bug & feature tracker",
    description:
      "A place inside the app to record issues and ideas found while testing, numbered BUG/FR/UI/TAX, each with description, priority, date, optional screenshot, status and developer notes.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "This tracker. Numbering is per kind; screenshots attach from the phone. The known backlog is defined in src/lib/backlog.ts and created on first visit, so the live tracker matches the written list.",
  },
  {
    kind: "FR",
    number: 5,
    title: "Release / test checklist",
    description:
      "Before calling a version stable, run the major workflows end to end: customers, invoices, tax, payments, receipts, packing lists, expenses, imports, search, reports, printing, PDF, backup/recovery, permissions, and the intended devices.",
    priority: "MEDIUM",
    status: "READY_FOR_TESTING",
    devNotes: "Settings → Release checklist; progress is kept on the device.",
  },
  {
    kind: "FR",
    number: 6,
    title: "Receipt & online purchase import",
    description:
      "Capture online business purchases: upload PDF/image receipts, drag-and-drop on PC, extract vendor, date, order number, line items, subtotal, tax, shipping and total, suggest a category, let the user correct before saving, keep the original attached, detect duplicates, and assign the purchase to equipment/job/property. Future: emailed receipts, Amazon history, bank CSV matching, category suggestions from vendor history.",
    priority: "HIGH",
    status: "WORKING",
    devNotes:
      "Done: photo/PDF upload (see BUG-002), forwarded-email import with vendor/date/total/tax/number extraction, original always stored, duplicate suppression on email, assign-to-asset on the expense. NEW in v3.5: picking a file on Add receipt reads it and pre-fills vendor/date/total/tax/receipt# for review — PDFs with a text layer are read for free on the spot; photos and scanned PDFs are read by AI once an Anthropic API key is added to the deployment (until then a note says so). Open: line-item and shipping extraction, category suggestion from vendor history, drag-and-drop on desktop, bank CSV import and matching.",
  },
  {
    kind: "FR",
    number: 8,
    title: "Multi-user accounts",
    description:
      "Let other people run their own business on the same app — sign up with email and password, keep every account's records fully separate, and generalize the interface (no Farm/Tech divisions for a service business). The original Twin Oaks password sign-in stays exactly as it was.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "Shipped in v4.0. Every table carries an accountId and every query filters on it; existing data belongs to the owner account, which the classic password (and existing sessions) still open. New accounts sign up at /signup, get their own business profile, invoice numbering (their own INV-001), vendors, tracker, and a single 'General' division so the Farm/Tech pickers disappear. Printed documents use their business name, with no Twin Oaks logo unless they upload one. Sign-ups can be closed later with ALLOW_SIGNUPS=false.",
  },
  {
    kind: "FR",
    number: 9,
    title: "Household expenses & budgets",
    description:
      "Track personal/household spending and monthly budgets alongside the business — groceries, rent, utilities, kids — with per-category budget targets and month-by-month tracking. Kept fully separate from business records so the Tax Center and business reports never see personal spending.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "Shipped in v4.1. Household lives at /household (More → Household & budgets): ten-second add form, month navigation, per-category spent-vs-budget bars (red when over), and a budgets editor (one monthly number per category, blank = untracked). Own database tables per account — by construction it cannot leak into business books, exports include it, and each account's household data is private to them. A dashboard card appears once the first entry or budget exists.",
  },
  {
    kind: "UI",
    number: 1,
    title: "Date and Total fields overlapped on iPhone",
    description:
      "On the Add receipt screen the Date box spilled into the Total box on an iPhone — iOS gives date inputs a minimum width that refuses to shrink inside a two-column row.",
    priority: "MEDIUM",
    status: "READY_FOR_TESTING",
    devNotes:
      "Two rounds: min-width:0 on every input helped desktop but iOS date fields kept their native intrinsic width and still overlapped (confirmed on iPhone and iPad). Real fix is appearance:none on date/time inputs (globals.css), which strips the native widget sizing so they obey their column. Applies app-wide — Expenses, Income, Invoices, Assets, Mileage share the pattern.",
  },
  {
    kind: "FR",
    number: 7,
    title: "Business information / company profile",
    description:
      "One Business Profile that populates invoices, packing lists, receipts, quotes and statements. Editable once in Settings, supports a logo, offers document preview, and leaves already-finalized documents unchanged.",
    priority: "HIGH",
    status: "READY_FOR_TESTING",
    devNotes:
      "Settings → Business profile, including the default tax rate and logo upload. Details are frozen onto an invoice when it is marked sent, so past documents never change. The printed brand lockup is the default document logo.",
  },
];

export function refOf(item: { kind: string; number: number }): string {
  return `${item.kind}-${String(item.number).padStart(3, "0")}`;
}

declare global {
  var __twinOaksBacklogSeeded: Promise<void> | undefined;
}

// Creates any backlog item the tracker doesn't have yet. Never updates an
// existing row — once an item is in the operator's tracker, their status and
// notes are theirs. Memoized per server instance; failures are swallowed so
// the tracker still renders if the database hiccups.
export function ensureBacklogTickets(): Promise<void> {
  if (!globalThis.__twinOaksBacklogSeeded) {
    globalThis.__twinOaksBacklogSeeded = (async () => {
      // The written backlog is the OWNER's dev tracker — other accounts start
      // with an empty tracker of their own.
      const existing = await prisma.ticket.findMany({
        where: { accountId: OWNER_ACCOUNT_ID },
        select: { ref: true },
      });
      const have = new Set(existing.map((t) => t.ref));
      const missing = BACKLOG.filter((item) => !have.has(refOf(item)));
      if (missing.length === 0) return;

      await prisma.ticket.createMany({
        data: missing.map((item) => ({
          accountId: OWNER_ACCOUNT_ID,
          ref: refOf(item),
          kind: item.kind,
          number: item.number,
          title: item.title,
          description: item.description,
          priority: item.priority,
          status: item.status,
          devNotes: item.devNotes ?? null,
        })),
      });
      console.log(`[backlog] added ${missing.length} tracker item(s)`);
    })().catch((e) => {
      console.error("[backlog] seeding failed:", e);
    });
  }
  return globalThis.__twinOaksBacklogSeeded;
}
