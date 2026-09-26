// Self-healing database schema.
//
// The Vercel build applies the schema best-effort (scripts/vercel-build.sh);
// if that step was skipped or failed, the app would crash on its first query.
// Instead, the root layout calls ensureSchema() — memoized per server
// instance — which probes for the core table and, when missing, applies the
// exact DDL below (generated via `prisma migrate diff --from-empty
// --to-schema-datamodel prisma/schema.prisma --script`, made idempotent).
//
// KEEP IN SYNC: when prisma/schema.prisma changes, regenerate this DDL.

import { prisma } from "./db";

const DDL: string[] = [
  `CREATE SCHEMA IF NOT EXISTS "public"`,

  `CREATE TABLE IF NOT EXISTS "StoredFile" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Receipt" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INBOX',
    "filePath" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "vendorName" TEXT,
    "receiptDate" TIMESTAMP(3),
    "totalCents" INTEGER,
    "salesTaxCents" INTEGER,
    "paymentMethod" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "salesTaxCents" INTEGER,
    "paymentMethod" TEXT,
    "division" TEXT NOT NULL,
    "accountingCategory" TEXT NOT NULL,
    "managementCategory" TEXT,
    "businessPurpose" TEXT,
    "assetId" TEXT,
    "taxYear" INTEGER NOT NULL,
    "taxStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "isCapital" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Income" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "division" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetTag" TEXT,
    "kind" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "year" INTEGER,
    "purchaseDate" TIMESTAMP(3),
    "purchasePriceCents" INTEGER,
    "purchasedFrom" TEXT,
    "financingNotes" TEXT,
    "warrantyNotes" TEXT,
    "currentHours" DOUBLE PRECISION,
    "currentMileage" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hoursAtService" DOUBLE PRECISION,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partsCostCents" INTEGER,
    "laborCostCents" INTEGER,
    "vendorName" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_name_key" ON "Vendor"("name")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_status_idx" ON "Receipt"("status")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_expenseId_idx" ON "Receipt"("expenseId")`,
  `CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date")`,
  `CREATE INDEX IF NOT EXISTS "Expense_taxYear_division_idx" ON "Expense"("taxYear", "division")`,
  `CREATE INDEX IF NOT EXISTS "Expense_accountingCategory_idx" ON "Expense"("accountingCategory")`,
  `CREATE INDEX IF NOT EXISTS "Expense_taxStatus_idx" ON "Expense"("taxStatus")`,
  `CREATE INDEX IF NOT EXISTS "Expense_assetId_idx" ON "Expense"("assetId")`,
  `CREATE INDEX IF NOT EXISTS "Income_date_idx" ON "Income"("date")`,
  `CREATE INDEX IF NOT EXISTS "Income_taxYear_division_idx" ON "Income"("taxYear", "division")`,
  `CREATE INDEX IF NOT EXISTS "Asset_kind_idx" ON "Asset"("kind")`,
  `CREATE INDEX IF NOT EXISTS "Asset_division_idx" ON "Asset"("division")`,
  `CREATE INDEX IF NOT EXISTS "MaintenanceRecord_assetId_date_idx" ON "MaintenanceRecord"("assetId", "date")`,

  // ————— V2: revenue loop + mileage —————

  `CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "salesTaxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT,
    "checkNumber" TEXT,
    "notes" TEXT,
    "incomeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "MileageLog" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startLocation" TEXT,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "customerName" TEXT,
    "vehicleAssetId" TEXT,
    "startOdometer" DOUBLE PRECISION,
    "endOdometer" DOUBLE PRECISION,
    "miles" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MileageLog_pkey" PRIMARY KEY ("id")
)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_number_key" ON "Invoice"("number")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_customerId_idx" ON "Invoice"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_taxYear_idx" ON "Invoice"("taxYear")`,
  `CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId")`,
  `CREATE INDEX IF NOT EXISTS "MileageLog_date_idx" ON "MileageLog"("date")`,
  `CREATE INDEX IF NOT EXISTS "MileageLog_taxYear_idx" ON "MileageLog"("taxYear")`,

  `DO $$ BEGIN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MileageLog" ADD CONSTRAINT "MileageLog_vehicleAssetId_fkey" FOREIGN KEY ("vehicleAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ————— V2.1: quotes ride the Invoice table —————
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'INVOICE'`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "convertedToInvoiceId" TEXT`,

  // ————— V2.2: email-forwarded receipts —————
  `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'UPLOAD'`,
  `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "emailFrom" TEXT`,
  `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "emailSubject" TEXT`,

  // ————— V2.3: passkeys (Face ID / Touch ID sign-in) —————
  `CREATE TABLE IF NOT EXISTS "Passkey" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Passkey_credentialId_key" ON "Passkey"("credentialId")`,

  // ————— V3.0: business profile (FR-007), sales tax (BUG-001), tickets (FR-004) —————
  `CREATE TABLE IF NOT EXISTS "BusinessProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Twin Oaks Farm & Tech',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoPath" TEXT,
    "defaultTaxRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "devNotes" TEXT,
    "attachmentPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_ref_key" ON "Ticket"("ref")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_kind_number_idx" ON "Ticket"("kind", "number")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_status_idx" ON "Ticket"("status")`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxRatePercent" DOUBLE PRECISION`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxManualOverride" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "businessSnapshot" TEXT`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToAddress" TEXT`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT true`,

  // ————— V3.1: per-customer tax treatment —————
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "taxTreatment" TEXT NOT NULL DEFAULT 'DEFAULT'`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "taxRatePercent" DOUBLE PRECISION`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "taxExemptReason" TEXT`,

  // Foreign keys have no IF NOT EXISTS — swallow duplicate_object instead.
  `DO $$ BEGIN
    ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ————— V4.0: multi-user accounts —————
  // Every pre-existing row belongs to the fixed 'owner' account (the original
  // Twin Oaks books) — the DEFAULT on each ADD COLUMN does the backfill in
  // the same idempotent statement.
  `CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Account_email_key" ON "Account"("email")`,
  `INSERT INTO "Account" ("id", "email", "name", "passwordHash")
    VALUES ('owner', 'twinoaksfarmandtech@gmail.com', 'Twin Oaks Farm & Tech', '')
    ON CONFLICT ("id") DO NOTHING`,

  `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Income" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "MaintenanceRecord" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "StoredFile" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "divisionsCsv" TEXT`,
  `ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `ALTER TABLE "MileageLog" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,

  // Global uniques become per-account (a second business starts its own
  // INV-001 and its own vendor list).
  `DROP INDEX IF EXISTS "Vendor_name_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_accountId_name_key" ON "Vendor"("accountId", "name")`,
  `DROP INDEX IF EXISTS "Invoice_number_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_accountId_number_key" ON "Invoice"("accountId", "number")`,
  `DROP INDEX IF EXISTS "Ticket_ref_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_accountId_ref_key" ON "Ticket"("accountId", "ref")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BusinessProfile_accountId_key" ON "BusinessProfile"("accountId")`,

  `CREATE INDEX IF NOT EXISTS "Vendor_accountId_idx" ON "Vendor"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_accountId_idx" ON "Receipt"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Expense_accountId_idx" ON "Expense"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Income_accountId_idx" ON "Income"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Asset_accountId_idx" ON "Asset"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "MaintenanceRecord_accountId_idx" ON "MaintenanceRecord"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "StoredFile_accountId_idx" ON "StoredFile"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_accountId_idx" ON "Ticket"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Customer_accountId_idx" ON "Customer"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_accountId_idx" ON "Invoice"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Payment_accountId_idx" ON "Payment"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "MileageLog_accountId_idx" ON "MileageLog"("accountId")`,

  `ALTER TABLE "Passkey" ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'owner'`,
  `CREATE INDEX IF NOT EXISTS "Passkey_accountId_idx" ON "Passkey"("accountId")`,

  // ————— V4.1: household (personal) money — own tables, never the business books —————
  `CREATE TABLE IF NOT EXISTS "HouseholdExpense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseholdExpense_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "HouseholdExpense_accountId_date_idx" ON "HouseholdExpense"("accountId", "date")`,
  // LAST on purpose: the probe targets this table, so its presence proves
  // every earlier block (multi-user included) ran.
  `CREATE TABLE IF NOT EXISTS "HouseholdBudget" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    CONSTRAINT "HouseholdBudget_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdBudget_accountId_category_key" ON "HouseholdBudget"("accountId", "category")`,

  // ————— V4.2: full household budgeting —————
  `ALTER TABLE "HouseholdExpense" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'EXPENSE'`,
  `ALTER TABLE "HouseholdExpense" ADD COLUMN IF NOT EXISTS "recurringId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "HouseholdExpense_recurringId_idx" ON "HouseholdExpense"("recurringId")`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "householdCategoriesCsv" TEXT`,
  // LAST on purpose — the probe targets this table.
  `CREATE TABLE IF NOT EXISTS "RecurringHousehold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EXPENSE',
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringHousehold_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "RecurringHousehold_accountId_idx" ON "RecurringHousehold"("accountId")`,

  // ————— V5.0: V3 livestock, V4 manufacturing, banking, documents —————

  `CREATE TABLE IF NOT EXISTS "Animal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tagNumber" TEXT NOT NULL,
    "name" TEXT,
    "species" TEXT NOT NULL DEFAULT 'Sheep',
    "breed" TEXT,
    "sex" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "birthType" TEXT,
    "sireId" TEXT,
    "damId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" TIMESTAMP(3),
    "acquisitionCostCents" INTEGER,
    "currentWeightLbs" DOUBLE PRECISION,
    "photoPath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Animal_accountId_tagNumber_key" ON "Animal"("accountId", "tagNumber")`,
  `CREATE INDEX IF NOT EXISTS "Animal_accountId_idx" ON "Animal"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "Animal_accountId_status_idx" ON "Animal"("accountId", "status")`,

  `CREATE TABLE IF NOT EXISTS "AnimalEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "weightLbs" DOUBLE PRECISION,
    "productName" TEXT,
    "dosage" TEXT,
    "withdrawalUntil" TIMESTAMP(3),
    "mateAnimalId" TEXT,
    "dueDate" TIMESTAMP(3),
    "result" TEXT,
    "lambCount" INTEGER,
    "costCents" INTEGER,
    "expenseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnimalEvent_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "AnimalEvent_accountId_date_idx" ON "AnimalEvent"("accountId", "date")`,
  `CREATE INDEX IF NOT EXISTS "AnimalEvent_animalId_date_idx" ON "AnimalEvent"("animalId", "date")`,
  `CREATE INDEX IF NOT EXISTS "AnimalEvent_accountId_kind_idx" ON "AnimalEvent"("accountId", "kind")`,

  `CREATE TABLE IF NOT EXISTS "LivestockSale" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "animalId" TEXT,
    "customerId" TEXT,
    "buyerName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "salePriceCents" INTEGER NOT NULL,
    "weightLbs" DOUBLE PRECISION,
    "paymentMethod" TEXT,
    "incomeId" TEXT,
    "processingNotes" TEXT,
    "notes" TEXT,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LivestockSale_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "LivestockSale_accountId_date_idx" ON "LivestockSale"("accountId", "date")`,
  `CREATE INDEX IF NOT EXISTS "LivestockSale_animalId_idx" ON "LivestockSale"("animalId")`,
  `CREATE INDEX IF NOT EXISTS "LivestockSale_accountId_taxYear_idx" ON "LivestockSale"("accountId", "taxYear")`,

  `ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "animalId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Expense_animalId_idx" ON "Expense"("animalId")`,

  `CREATE TABLE IF NOT EXISTS "FilamentSpool" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "manufacturer" TEXT,
    "material" TEXT NOT NULL,
    "colorName" TEXT,
    "spoolTag" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePriceCents" INTEGER,
    "totalGrams" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "remainingGrams" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "wasteGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "printerAssetId" TEXT,
    "receiptId" TEXT,
    "expenseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FilamentSpool_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "FilamentSpool_accountId_idx" ON "FilamentSpool"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "FilamentSpool_accountId_status_idx" ON "FilamentSpool"("accountId", "status")`,

  `CREATE TABLE IF NOT EXISTS "PrintJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "partNumber" TEXT,
    "description" TEXT,
    "customerId" TEXT,
    "printerAssetId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "printMinutes" INTEGER,
    "laborMinutes" INTEGER,
    "machineRateCentsPerHour" INTEGER,
    "laborRateCentsPerHour" INTEGER,
    "packagingCostCents" INTEGER,
    "shippingCostCents" INTEGER,
    "otherCostCents" INTEGER,
    "salePriceCents" INTEGER,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PrintJob_accountId_jobNumber_key" ON "PrintJob"("accountId", "jobNumber")`,
  `CREATE INDEX IF NOT EXISTS "PrintJob_accountId_idx" ON "PrintJob"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "PrintJob_accountId_status_idx" ON "PrintJob"("accountId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PrintJob_customerId_idx" ON "PrintJob"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "PrintJob_printerAssetId_idx" ON "PrintJob"("printerAssetId")`,

  `CREATE TABLE IF NOT EXISTS "FilamentUse" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "printJobId" TEXT NOT NULL,
    "spoolId" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "wasteGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FilamentUse_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "FilamentUse_printJobId_idx" ON "FilamentUse"("printJobId")`,
  `CREATE INDEX IF NOT EXISTS "FilamentUse_spoolId_idx" ON "FilamentUse"("spoolId")`,
  `CREATE INDEX IF NOT EXISTS "FilamentUse_accountId_idx" ON "FilamentUse"("accountId")`,

  `CREATE TABLE IF NOT EXISTS "BankTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT,
    "importBatchId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceCents" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedExpenseId" TEXT,
    "matchedIncomeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_accountId_fingerprint_key" ON "BankTransaction"("accountId", "fingerprint")`,
  `CREATE INDEX IF NOT EXISTS "BankTransaction_accountId_status_idx" ON "BankTransaction"("accountId", "status")`,
  `CREATE INDEX IF NOT EXISTS "BankTransaction_accountId_date_idx" ON "BankTransaction"("accountId", "date")`,

  `CREATE TABLE IF NOT EXISTS "BankImportProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankImportProfile_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BankImportProfile_accountId_bankName_key" ON "BankImportProfile"("accountId", "bankName")`,
  `CREATE INDEX IF NOT EXISTS "BankImportProfile_accountId_idx" ON "BankImportProfile"("accountId")`,

  `CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "Document_accountId_ownerType_ownerId_idx" ON "Document"("accountId", "ownerType", "ownerId")`,
  `CREATE INDEX IF NOT EXISTS "Document_accountId_idx" ON "Document"("accountId")`,

  `CREATE TABLE IF NOT EXISTS "ReceiptLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "accountingCategory" TEXT,
    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "ReceiptLine_receiptId_idx" ON "ReceiptLine"("receiptId")`,
  `CREATE INDEX IF NOT EXISTS "ReceiptLine_accountId_idx" ON "ReceiptLine"("accountId")`,

  // Foreign keys for the V5 tables (no IF NOT EXISTS — swallow duplicates).
  `DO $$ BEGIN
    ALTER TABLE "Animal" ADD CONSTRAINT "Animal_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Animal" ADD CONSTRAINT "Animal_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "AnimalEvent" ADD CONSTRAINT "AnimalEvent_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "FilamentUse" ADD CONSTRAINT "FilamentUse_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "FilamentUse" ADD CONSTRAINT "FilamentUse_spoolId_fkey" FOREIGN KEY ("spoolId") REFERENCES "FilamentSpool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // LAST on purpose — the probe targets this table, so its presence proves
  // every earlier V5 statement ran.
  `CREATE TABLE IF NOT EXISTS "RecurringBill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "division" TEXT NOT NULL,
    "accountingCategory" TEXT NOT NULL,
    "vendorName" TEXT,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "RecurringBill_accountId_idx" ON "RecurringBill"("accountId")`,

  // ————— V6.0: sales tax (Alabama state + local) —————
  // Columns first: they are additive and nullable/defaulted, so existing
  // invoices keep working and historic lines land as UNCLASSIFIED (review).
  `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxLocationId" TEXT`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "productType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED'`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "taxTreatmentOverride" TEXT`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "exemptionReason" TEXT`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "evidenceDocumentId" TEXT`,
  `ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "originalLineId" TEXT`,
  `ALTER TABLE "LivestockSale" ADD COLUMN IF NOT EXISTS "taxLocationId" TEXT`,
  `ALTER TABLE "LivestockSale" ADD COLUMN IF NOT EXISTS "taxTreatmentOverride" TEXT`,
  `ALTER TABLE "LivestockSale" ADD COLUMN IF NOT EXISTS "exemptionReason" TEXT`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "salesTaxBasis" TEXT`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "salesTaxBasisApprovedBy" TEXT`,
  `ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "salesTaxBasisApprovedAt" TIMESTAMP(3)`,

  `CREATE TABLE IF NOT EXISTS "TaxAuthority" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "jurisdictionCode" TEXT NOT NULL DEFAULT '',
    "taxType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxAuthority_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "TaxAuthority_accountId_idx" ON "TaxAuthority"("accountId")`,

  `CREATE TABLE IF NOT EXISTS "TaxRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "rateClass" TEXT NOT NULL,
    "rateTypeCode" TEXT NOT NULL,
    "ratePpm" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "TaxRate_accountId_authorityId_idx" ON "TaxRate"("accountId", "authorityId")`,
  `DO $$ BEGIN
    ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "TaxAuthority"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `CREATE TABLE IF NOT EXISTS "TaxLocation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT NOT NULL DEFAULT 'AL',
    "postalCode" TEXT,
    "insideCity" BOOLEAN NOT NULL DEFAULT false,
    "policeJurisdiction" TEXT,
    "authorityIdsCsv" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxLocation_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "TaxLocation_accountId_idx" ON "TaxLocation"("accountId")`,

  `CREATE TABLE IF NOT EXISTS "SalesTaxRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "rateClass" TEXT NOT NULL DEFAULT 'GENERAL',
    "exemptionReason" TEXT,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesTaxRule_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "SalesTaxRule_accountId_idx" ON "SalesTaxRule"("accountId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SalesTaxRule_accountId_productType_key" ON "SalesTaxRule"("accountId", "productType")`,

  `CREATE TABLE IF NOT EXISTS "SalesTaxSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "note" TEXT,
    "grossSalesCents" INTEGER NOT NULL,
    "taxableCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesTaxSnapshot_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "SalesTaxSnapshot_accountId_period_idx" ON "SalesTaxSnapshot"("accountId", "period")`,

  // LAST on purpose — the probe targets this table, so its presence proves
  // every earlier V6 statement ran.
  `CREATE TABLE IF NOT EXISTS "SalesTaxFiling" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "snapshotId" TEXT,
    "filedOn" TIMESTAMP(3) NOT NULL,
    "confirmationNumber" TEXT,
    "amountPaidCents" INTEGER,
    "filedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesTaxFiling_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "SalesTaxFiling_accountId_period_idx" ON "SalesTaxFiling"("accountId", "period")`,
];

export type DbStatus =
  | { ok: true }
  | { ok: false; reason: string; detail?: string; envNames: string[] };

function dbEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /DATABASE|POSTGRES|NEON|^PG/.test(k))
    .sort();
}

declare global {
  var __twinOaksSchemaEnsured: Promise<DbStatus> | undefined;
}

async function ensureSchemaOnce(): Promise<DbStatus> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      reason: "No DATABASE_URL environment variable is set.",
      envNames: dbEnvNames(),
    };
  }
  try {
    // Probe the NEWEST schema element (table OR column) — if an older
    // deploy's schema is present but anything newer is missing, the
    // idempotent DDL below fills the gap.
    await prisma.$queryRawUnsafe(`SELECT "accountId" FROM "SalesTaxFiling" LIMIT 1`);
    return { ok: true }; // schema already present
  } catch (probeErr) {
    // Something missing (or connection issue) — attempt to apply the schema.
    try {
      for (const stmt of DDL) {
        await prisma.$executeRawUnsafe(stmt);
      }
      await prisma.$queryRawUnsafe(`SELECT "accountId" FROM "SalesTaxFiling" LIMIT 1`);
      console.log("[twin-oaks] database schema applied by self-heal");
      return { ok: true };
    } catch (healErr) {
      const detail =
        healErr instanceof Error ? healErr.message : String(healErr ?? probeErr);
      console.error("[twin-oaks] schema self-heal failed:", detail);
      return {
        ok: false,
        reason: "Could not reach the database or apply the schema.",
        detail: detail.slice(0, 500),
        envNames: dbEnvNames(),
      };
    }
  }
}

// Memoized per server instance; never throws.
export function ensureSchema(): Promise<DbStatus> {
  if (!globalThis.__twinOaksSchemaEnsured) {
    globalThis.__twinOaksSchemaEnsured = ensureSchemaOnce().catch((e) => ({
      ok: false as const,
      reason: "Unexpected error while checking the database.",
      detail: e instanceof Error ? e.message.slice(0, 500) : String(e),
      envNames: dbEnvNames(),
    }));
  }
  return globalThis.__twinOaksSchemaEnsured;
}
