// Sample data so the app renders with life on first run.
// Run: pnpm db:seed (wipes and re-creates — dev only).

import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

// 1×1 gray PNG — stands in for a receipt photo in dev.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  // Wipe (dev only) — order matters for relations.
  await prisma.maintenanceRecord.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.income.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.vendor.deleteMany();

  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "var/uploads");
  await mkdir(uploadDir, { recursive: true });
  for (const name of ["seed-receipt-1.png", "seed-receipt-2.png", "seed-receipt-3.png"]) {
    await writeFile(path.join(uploadDir, name), PLACEHOLDER_PNG);
  }

  const vendorNames = [
    "Tractor Supply Co",
    "Rural King",
    "Bambu Lab",
    "Valley Veterinary Clinic",
    "Miller Farm & Fleet",
    "Amazon",
  ];
  const vendors: Record<string, string> = {};
  for (const name of vendorNames) {
    const v = await prisma.vendor.create({ data: { name } });
    vendors[name] = v.id;
  }

  const tractor = await prisma.asset.create({
    data: {
      name: "Tractor #1",
      assetTag: "TO-EQ-001",
      kind: "Tractor",
      division: "FARM",
      manufacturer: "Kubota",
      model: "L3902",
      year: 2024,
      purchaseDate: new Date(2024, 3, 12, 12),
      purchasePriceCents: 3249900,
      purchasedFrom: "Miller Farm & Fleet",
      financingNotes: "0% for 60 months",
      warrantyNotes: "2-year full / 6-year powertrain",
      currentHours: 412,
      notes: "Primary loader tractor.",
    },
  });

  const printer = await prisma.asset.create({
    data: {
      name: "Bambu H2D #1",
      assetTag: "TO-EQ-010",
      kind: "3D printer",
      division: "TECH",
      manufacturer: "Bambu Lab",
      model: "H2D",
      year: 2026,
      purchaseDate: new Date(2026, 1, 3, 12),
      purchasePriceCents: 219900,
      purchasedFrom: "Bambu Lab",
      currentHours: 640,
      notes: "Main production printer.",
    },
  });

  await prisma.asset.create({
    data: {
      name: "Stock Trailer",
      assetTag: "TO-EQ-002",
      kind: "Trailer",
      division: "FARM",
      manufacturer: "W-W",
      year: 2019,
      currentMileage: 18400,
    },
  });

  // --- Expenses -----------------------------------------------------------
  // SPEC §26's canonical example: 2026 → Farm → Repairs & Maintenance →
  // Tractor #1 → Hydraulic hose → $87.42 → View receipt.
  const hydraulicHose = await prisma.expense.create({
    data: {
      date: new Date(2026, 6, 18, 12),
      taxYear: 2026,
      vendorId: vendors["Tractor Supply Co"],
      vendorName: "Tractor Supply Co",
      description: "Hydraulic hose",
      amountCents: 8742,
      salesTaxCents: 612,
      paymentMethod: "Card",
      division: "FARM",
      accountingCategory: "Repairs & maintenance",
      managementCategory: "Farm Equipment > Tractor #1 > Hydraulic system",
      businessPurpose: "Repair loader hydraulics on primary tractor",
      assetId: tractor.id,
      taxStatus: "LIKELY_BUSINESS",
    },
  });

  await prisma.receipt.create({
    data: {
      status: "CATEGORIZED",
      filePath: "seed-receipt-1.png",
      fileName: "tractor-supply-hose.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      vendorName: "Tractor Supply Co",
      receiptDate: new Date(2026, 6, 18, 12),
      totalCents: 8742,
      salesTaxCents: 612,
      paymentMethod: "Card",
      expenseId: hydraulicHose.id,
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: tractor.id,
      date: new Date(2026, 6, 18, 12),
      hoursAtService: 408,
      category: "Hydraulic components",
      description: "Replaced cracked loader hydraulic hose, topped off fluid",
      partsCostCents: 8742,
      vendorName: "Self",
      expenseId: hydraulicHose.id,
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: tractor.id,
      date: new Date(2026, 4, 2, 12),
      hoursAtService: 380,
      category: "Oil & filters",
      description: "50-hour service — oil, oil filter, grease all zerks",
      partsCostCents: 5418,
      vendorName: "Self",
    },
  });

  await prisma.maintenanceRecord.create({
    data: {
      assetId: printer.id,
      date: new Date(2026, 6, 30, 12),
      hoursAtService: 620,
      category: "Nozzles & hotends (printer)",
      description: "Swapped 0.4mm nozzle after clog",
      partsCostCents: 1499,
      vendorName: "Bambu Lab",
    },
  });

  const simpleExpenses: Array<{
    date: Date;
    vendor: string;
    description: string;
    amountCents: number;
    division: string;
    accountingCategory: string;
    managementCategory?: string;
    businessPurpose?: string;
    assetId?: string;
    taxStatus?: string;
    isCapital?: boolean;
  }> = [
    {
      date: new Date(2026, 7, 2, 12),
      vendor: "Rural King",
      description: "Sheep feed + mineral blocks",
      amountCents: 18650,
      division: "FARM",
      accountingCategory: "Feed",
      managementCategory: "Livestock > Feed",
      businessPurpose: "Flock feed",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 7, 5, 12),
      vendor: "Valley Veterinary Clinic",
      description: "Lamb checkup + dewormer",
      amountCents: 14200,
      division: "FARM",
      accountingCategory: "Veterinary",
      managementCategory: "Livestock > Veterinary care",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 7, 1, 12),
      vendor: "Bambu Lab",
      description: "PLA filament — 6 spools",
      amountCents: 11994,
      division: "TECH",
      accountingCategory: "Supplies",
      managementCategory: "Tech > Filament",
      businessPurpose: "Production stock for customer jobs",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 6, 25, 12),
      vendor: "Miller Farm & Fleet",
      description: "Fence posts + woven wire",
      amountCents: 32485,
      division: "FARM",
      accountingCategory: "Repairs & maintenance",
      managementCategory: "Property > Fencing & gates",
      businessPurpose: "East pasture fence repair",
      taxStatus: "LIKELY_BUSINESS",
    },
    {
      date: new Date(2026, 6, 10, 12),
      vendor: "Amazon",
      description: "Digital calipers",
      amountCents: 3299,
      division: "TECH",
      accountingCategory: "Supplies",
      managementCategory: "Tech > Tools & measuring",
      taxStatus: "NEEDS_REVIEW",
    },
    {
      date: new Date(2026, 1, 3, 12),
      vendor: "Bambu Lab",
      description: "Bambu H2D printer",
      amountCents: 219900,
      division: "TECH",
      accountingCategory: "Depreciable assets",
      managementCategory: "Tech > Printers",
      businessPurpose: "Production capacity",
      assetId: printer.id,
      taxStatus: "CAPITAL_ASSET",
      isCapital: true,
    },
  ];

  for (const e of simpleExpenses) {
    await prisma.expense.create({
      data: {
        date: e.date,
        taxYear: e.date.getFullYear(),
        vendorId: vendors[e.vendor],
        vendorName: e.vendor,
        description: e.description,
        amountCents: e.amountCents,
        division: e.division,
        accountingCategory: e.accountingCategory,
        managementCategory: e.managementCategory,
        businessPurpose: e.businessPurpose,
        assetId: e.assetId,
        taxStatus: e.taxStatus ?? "NEEDS_REVIEW",
        isCapital: e.isCapital ?? false,
      },
    });
  }

  // Two receipts waiting in the Inbox (the daily-driver flow).
  await prisma.receipt.create({
    data: {
      status: "INBOX",
      filePath: "seed-receipt-2.png",
      fileName: "rural-king-aug.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      vendorName: "Rural King",
      receiptDate: new Date(2026, 7, 8, 12),
      totalCents: 4327,
    },
  });
  await prisma.receipt.create({
    data: {
      status: "INBOX",
      filePath: "seed-receipt-3.png",
      fileName: "gas-station.png",
      mimeType: "image/png",
      fileSize: PLACEHOLDER_PNG.byteLength,
      notes: "Diesel for tractor — snap from the truck",
      receiptDate: new Date(2026, 7, 9, 12),
    },
  });

  // A receipt that arrived by forwarded email (no attachment — the message
  // body is the document, the way Amazon/Apple receipts arrive).
  await writeFile(
    path.join(uploadDir, "seed-email-receipt.html"),
    "<html><body><h2>Bambu Lab</h2><p>Order #BL-55129</p><p>PLA filament — 6 spools</p><p>Order Total: $119.94</p></body></html>",
  );
  await prisma.receipt.create({
    data: {
      status: "INBOX",
      source: "EMAIL",
      emailFrom: "greg@example.com",
      emailSubject: "Fwd: Your Bambu Lab order confirmation",
      filePath: "seed-email-receipt.html",
      fileName: "Fwd_ Your Bambu Lab order confirmation.html",
      mimeType: "text/html",
      vendorName: "Bambu Lab",
      receiptDate: new Date(2026, 7, 1, 12),
      totalCents: 11994,
      receiptNumber: "BL-55129",
      notes: "Forwarded email: Fwd: Your Bambu Lab order confirmation",
    },
  });

  // --- Income -------------------------------------------------------------
  await prisma.income.create({
    data: {
      date: new Date(2026, 7, 4, 12),
      taxYear: 2026,
      source: "Acme Fabrication",
      description: "20 custom mounting brackets",
      amountCents: 34000,
      division: "TECH",
      category: "3D-printed product sales",
      paymentMethod: "Bank transfer",
    },
  });
  await prisma.income.create({
    data: {
      date: new Date(2026, 6, 20, 12),
      taxYear: 2026,
      source: "Hartley family",
      description: "Two market lambs",
      amountCents: 67500,
      division: "FARM",
      category: "Livestock sales",
      paymentMethod: "Check",
    },
  });

  // --- V2: customers, invoices, payments, mileage -------------------------
  const acme = await prisma.customer.create({
    data: {
      name: "Dana Reyes",
      company: "Acme Fabrication",
      phone: "555-201-8890",
      email: "dana@acmefab.example",
      address: "412 Industrial Way\nSpringfield",
      notes: "Prefers PETG. Net-14 terms.",
    },
  });
  const hartley = await prisma.customer.create({
    data: { name: "Jane Hartley", phone: "555-330-1121", notes: "Buys market lambs each summer." },
  });

  const inv1 = await prisma.invoice.create({
    data: {
      number: "INV-001",
      customerId: acme.id,
      division: "TECH",
      status: "SENT",
      issueDate: new Date(2026, 7, 4, 12),
      dueDate: new Date(2026, 7, 18, 12),
      terms: "Due in 14 days",
      taxYear: 2026,
      subtotalCents: 34000,
      salesTaxCents: 0,
      totalCents: 34000,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Custom mounting brackets, PETG",
            quantity: 20,
            unitPriceCents: 1700,
            totalCents: 34000,
          },
        ],
      },
    },
  });
  const inv1Income = await prisma.income.create({
    data: {
      date: new Date(2026, 7, 6, 12),
      taxYear: 2026,
      source: "Acme Fabrication",
      description: "Invoice INV-001 — Acme Fabrication ($340.00)",
      amountCents: 34000,
      division: "TECH",
      category: "3D-printed product sales",
      paymentMethod: "Bank transfer",
    },
  });
  await prisma.payment.create({
    data: {
      invoiceId: inv1.id,
      customerId: acme.id,
      date: new Date(2026, 7, 6, 12),
      amountCents: 34000,
      method: "Bank transfer",
      incomeId: inv1Income.id,
    },
  });

  await prisma.invoice.create({
    data: {
      number: "INV-002",
      customerId: hartley.id,
      division: "FARM",
      status: "SENT",
      issueDate: new Date(2026, 7, 9, 12),
      dueDate: new Date(2026, 7, 23, 12),
      terms: "Due on pickup",
      taxYear: 2026,
      subtotalCents: 67500,
      salesTaxCents: 0,
      totalCents: 67500,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Market lambs (2)",
            quantity: 2,
            unitPriceCents: 33750,
            totalCents: 67500,
          },
        ],
      },
    },
  });

  await prisma.invoice.create({
    data: {
      number: "Q-001",
      kind: "QUOTE",
      customerId: acme.id,
      division: "TECH",
      status: "SENT",
      issueDate: new Date(2026, 7, 10, 12),
      dueDate: new Date(2026, 8, 10, 12),
      terms: "Valid for 30 days",
      taxYear: 2026,
      subtotalCents: 89500,
      salesTaxCents: 0,
      totalCents: 89500,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Jig fixture set, carbon-fiber nylon (design + print)",
            quantity: 5,
            unitPriceCents: 17900,
            totalCents: 89500,
          },
        ],
      },
    },
  });

  await prisma.mileageLog.create({
    data: {
      date: new Date(2026, 7, 2, 12),
      startLocation: "Farm",
      destination: "Rural King, Springfield",
      purpose: "Feed + mineral pickup",
      startOdometer: 48210,
      endOdometer: 48252,
      miles: 42,
      taxYear: 2026,
    },
  });
  await prisma.mileageLog.create({
    data: {
      date: new Date(2026, 7, 6, 12),
      destination: "Acme Fabrication",
      purpose: "Deliver bracket order",
      customerName: "Acme Fabrication",
      miles: 18.4,
      taxYear: 2026,
    },
  });

  // --- Business profile (FR-007) ------------------------------------------
  await prisma.businessProfile.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "Twin Oaks Farm & Tech",
      addressLine1: "7575 State Highway 134 East",
      city: "Columbia",
      state: "Alabama",
      postalCode: "36319",
      email: "twinoaksfarmandtech@gmail.com",
      website: "twinoaksfarmandtech.com",
      defaultTaxRatePercent: 0,
    },
    update: {},
  });

  // --- Tracker seeded with the real testing backlog (FR-004) --------------
  const tickets: {
    kind: string;
    number: number;
    title: string;
    description: string;
    priority: string;
    status: string;
    devNotes?: string;
  }[] = [
    {
      kind: "BUG",
      number: 1,
      title: "Automatic sales tax calculation",
      description:
        "Sales tax had to be calculated and typed by hand. Needs a default rate in Settings, automatic calculation on taxable lines, recalculation when anything changes, per-item taxable flag, a rate override, a clear subtotal/taxable/rate/tax/total breakdown, and the rate stored with the transaction. Future: rate by customer location and product type.",
      priority: "HIGH",
      status: "READY_FOR_TESTING",
      devNotes:
        "Default rate lives on the Business profile. Tax computed in src/lib/tax.ts, mirrored live in the line editor. Per-line 'Taxable' checkbox; manual override supported. taxRatePercent stored on each invoice so later rate changes never rewrite history. Location/product-based rates still open.",
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
        "At /invoices/<id>/packing, linked from the invoice. No prices shown. Ship-to falls back to the customer address; pen-friendly boxes for qty packed and notes. Scanning/partial shipments still open.",
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
      devNotes: "This tracker. Numbering is per kind. Screenshots attach via the camera.",
    },
    {
      kind: "FR",
      number: 5,
      title: "Release / test checklist",
      description:
        "Before calling a version stable, run the major workflows end to end: customers, invoices, tax, payments, receipts, packing lists, expenses, imports, search, reports, printing, PDF, backup/recovery, permissions, and the intended devices.",
      priority: "MEDIUM",
      status: "READY_FOR_TESTING",
      devNotes: "Interactive checklist at Settings → Release checklist; progress saves on the device.",
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
        "Done: upload (photo/PDF), forwarded-email import with vendor/date/total/tax/number extraction, original always stored, duplicate suppression on email, assign-to-asset on the expense. Open: line-item and shipping extraction, category suggestion from vendor history, drag-and-drop, bank CSV matching.",
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
        "Settings → Business profile, including the default tax rate and logo upload. Details are frozen onto an invoice when it is marked sent, so past documents never change.",
    },
  ];

  for (const t of tickets) {
    await prisma.ticket.create({
      data: {
        ref: `${t.kind}-${String(t.number).padStart(3, "0")}`,
        kind: t.kind,
        number: t.number,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        devNotes: t.devNotes ?? null,
      },
    });
  }

  console.log(
    "Seeded: 6 vendors, 3 assets, 7 expenses, 3 income, 3 receipts, 3 maintenance records, 2 customers, 2 invoices (1 paid), 2 mileage trips, business profile, 8 tracker items.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
