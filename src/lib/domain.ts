// Twin Oaks OS — domain constants (single source of truth for enum-like
// string fields in the Prisma schema; SQLite has no native enums).
// Sourced from the Master Build Specification (docs/SPEC.md §§5–11, 25, 27).

// Twin Oaks' own division set. Other accounts (multi-user, 2026-08) carry
// their own list on BusinessProfile.divisionsCsv — most get just GENERAL,
// which hides the division picker entirely. ALL_DIVISIONS is the validation
// superset; DIVISIONS stays the legacy/owner default so nothing changes for
// the original books.
export const DIVISIONS = ["FARM", "TECH", "SHARED"] as const;
export const ALL_DIVISIONS = ["FARM", "TECH", "SHARED", "GENERAL"] as const;
export type Division = (typeof ALL_DIVISIONS)[number];

export const DIVISION_LABELS: Record<Division, string> = {
  FARM: "Farm",
  TECH: "Tech",
  SHARED: "Shared",
  GENERAL: "General",
};

// Household (personal) spending categories — the budgeting side of the app.
// Deliberately everyday language, not tax language.
export const HOUSEHOLD_CATEGORIES = [
  "Groceries",
  "Rent / mortgage",
  "Utilities",
  "Phone & internet",
  "Car & gas",
  "Insurance",
  "Health",
  "Kids & school",
  "Clothing",
  "Household supplies",
  "Dining out",
  "Entertainment",
  "Subscriptions",
  "Gifts",
  "Savings",
  "Other",
] as const;
export type HouseholdCategory = (typeof HOUSEHOLD_CATEGORIES)[number];

// Money coming INTO the household (kind INCOME on HouseholdExpense).
export const HOUSEHOLD_INCOME_CATEGORIES = [
  "Paycheck",
  "Business income",
  "Benefits",
  "Gifts received",
  "Other income",
] as const;

// Accounting categories — bookkeeping/tax preparation level (SPEC §6).
export const ACCOUNTING_CATEGORIES = [
  "Repairs & maintenance",
  "Supplies",
  "Feed",
  "Veterinary",
  "Advertising",
  "Professional services",
  "Insurance",
  "Utilities",
  "Equipment",
  "Depreciable assets",
  "Vehicle expense",
  "Office expense",
  "Software & subscriptions",
  "Shipping & postage",
  "Meals (tax treatment varies)",
  "Taxes & licenses",
  "Other",
] as const;

// Management-category drill-down suggestions (SPEC §§6–8, 11). Free-form
// "A > B > C" paths; these seed the datalist so daily entry stays fast.
export const MANAGEMENT_CATEGORY_SUGGESTIONS = [
  "Livestock > Feed",
  "Livestock > Hay",
  "Livestock > Minerals & supplements",
  "Livestock > Veterinary care",
  "Livestock > Medications & vaccines",
  "Livestock > Bedding",
  "Livestock > Supplies & ear tags",
  "Farm Equipment > Tractor #1",
  "Farm Equipment > Mower",
  "Farm Equipment > Trailer",
  "Property > Main barn",
  "Property > Fencing & gates",
  "Property > Water system",
  "Property > Driveways & drainage",
  "Property > Grounds & mowing",
  "Tech > Filament",
  "Tech > Printer parts & nozzles",
  "Tech > Printer maintenance",
  "Tech > Packaging & shipping",
  "Tech > Tools & measuring",
  "Tech > CAD software",
  "Tech > Computer equipment",
] as const;

export const INCOME_CATEGORIES = [
  "3D-printed product sales",
  "Design / CAD services",
  "Custom manufacturing",
  "Livestock sales",
  "Other farm income",
  "Other business income",
] as const;

export const PAYMENT_METHODS = [
  "Card",
  "Cash",
  "Check",
  "Bank transfer",
  "PayPal / Venmo",
  "Financing",
  "Other",
] as const;

// Receipt lifecycle (SPEC §§3–4).
export const RECEIPT_STATUSES = [
  "INBOX",
  "CATEGORIZED",
  "NEEDS_REVIEW",
  "TAX_UNCERTAIN",
  "SPLIT_PERSONAL",
  "REIMBURSABLE",
  "ARCHIVED",
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  INBOX: "Inbox — not categorized",
  CATEGORIZED: "Categorized",
  NEEDS_REVIEW: "Needs review",
  TAX_UNCERTAIN: "Tax treatment uncertain",
  SPLIT_PERSONAL: "Personal/business split",
  REIMBURSABLE: "Reimbursable",
  ARCHIVED: "Archived",
};

// Tax-review status (SPEC §27). The app organizes and flags — it never makes
// the final tax-law call. New expenses default to NEEDS_REVIEW.
export const TAX_STATUSES = [
  "LIKELY_BUSINESS",
  "CAPITAL_ASSET",
  "MIXED_PERSONAL",
  "NEEDS_REVIEW",
  "MISSING_DOCS",
  "NOT_DEDUCTIBLE",
] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

export const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  LIKELY_BUSINESS: "Likely business expense",
  CAPITAL_ASSET: "Capital asset",
  MIXED_PERSONAL: "Mixed personal/business",
  NEEDS_REVIEW: "Requires accountant review",
  MISSING_DOCS: "Missing documentation",
  NOT_DEDUCTIBLE: "Not deductible / personal",
};

export const ASSET_KINDS = [
  "Tractor",
  "Mower",
  "Trailer",
  "Vehicle",
  "Generator",
  "Farm implement",
  "3D printer",
  "Computer / tech",
  "Building / property",
  "Other",
] as const;

// Maintenance categories (SPEC §10).
export const MAINTENANCE_CATEGORIES = [
  "Fuel",
  "Oil & filters",
  "Fuel filters",
  "Air filters",
  "Hydraulic fluid",
  "Hydraulic components",
  "Tires",
  "Batteries",
  "Belts",
  "Bearings",
  "Electrical repairs",
  "Engine repairs",
  "Transmission repairs",
  "Preventive maintenance",
  "Dealer / service work",
  "Nozzles & hotends (printer)",
  "Build plates (printer)",
  "Miscellaneous repairs",
] as const;

export const ASSET_STATUSES = ["ACTIVE", "SOLD", "RETIRED"] as const;

// ———————————————————————————————————————————————————————————————————————
// V3 — livestock (SPEC §§22–24). The owner runs sheep; the vocabulary here
// is a shepherd's, not a database's.
// ———————————————————————————————————————————————————————————————————————

export const ANIMAL_SPECIES = ["Sheep", "Goat", "Cattle", "Poultry", "Other"] as const;

export const ANIMAL_SEXES = ["EWE", "RAM", "WETHER"] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];
export const ANIMAL_SEX_LABELS: Record<AnimalSex, string> = {
  EWE: "Ewe (female)",
  RAM: "Ram (intact male)",
  WETHER: "Wether (castrated male)",
};

export const BIRTH_TYPES = ["SINGLE", "TWIN", "TRIPLET", "QUAD"] as const;
export type BirthType = (typeof BIRTH_TYPES)[number];
export const BIRTH_TYPE_LABELS: Record<BirthType, string> = {
  SINGLE: "Single",
  TWIN: "Twin",
  TRIPLET: "Triplet",
  QUAD: "Quad",
};

export const ANIMAL_STATUSES = ["ACTIVE", "SOLD", "DECEASED", "TRANSFERRED"] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];
export const ANIMAL_STATUS_LABELS: Record<AnimalStatus, string> = {
  ACTIVE: "In the flock",
  SOLD: "Sold",
  DECEASED: "Died",
  TRANSFERRED: "Transferred out",
};

// Every event type in SPEC §23, on one screen.
export const ANIMAL_EVENT_KINDS = [
  "BIRTH",
  "BREEDING",
  "PREGNANCY_CHECK",
  "LAMBING",
  "WEIGHT",
  "VACCINATION",
  "MEDICATION",
  "DEWORMING",
  "SHEARING",
  "HOOF_TRIM",
  "INJURY",
  "VET_VISIT",
  "TRANSFER",
  "DEATH",
  "NOTE",
] as const;
export type AnimalEventKind = (typeof ANIMAL_EVENT_KINDS)[number];
export const ANIMAL_EVENT_LABELS: Record<AnimalEventKind, string> = {
  BIRTH: "Born",
  BREEDING: "Bred",
  PREGNANCY_CHECK: "Pregnancy check",
  LAMBING: "Lambed",
  WEIGHT: "Weighed",
  VACCINATION: "Vaccination",
  MEDICATION: "Medication",
  DEWORMING: "Dewormed",
  SHEARING: "Sheared",
  HOOF_TRIM: "Hoof trim",
  INJURY: "Injury",
  VET_VISIT: "Vet visit",
  TRANSFER: "Transferred",
  DEATH: "Died",
  NOTE: "Note",
};

// Which optional fields each event kind actually uses — the form shows only
// these, so logging a weight never asks about a withdrawal date.
export const ANIMAL_EVENT_FIELDS: Record<AnimalEventKind, readonly string[]> = {
  BIRTH: ["weightLbs"],
  BREEDING: ["mateAnimalId", "dueDate"],
  PREGNANCY_CHECK: ["result"],
  LAMBING: ["lambCount"],
  WEIGHT: ["weightLbs"],
  VACCINATION: ["productName", "dosage", "withdrawalUntil", "costCents"],
  MEDICATION: ["productName", "dosage", "withdrawalUntil", "costCents"],
  DEWORMING: ["productName", "dosage", "withdrawalUntil", "costCents"],
  SHEARING: ["costCents"],
  HOOF_TRIM: [],
  INJURY: [],
  VET_VISIT: ["productName", "costCents"],
  TRANSFER: [],
  DEATH: [],
  NOTE: [],
};

export const PREGNANCY_RESULTS = ["BRED", "OPEN", "UNSURE"] as const;
export const PREGNANCY_RESULT_LABELS: Record<string, string> = {
  BRED: "Bred (pregnant)",
  OPEN: "Open (not pregnant)",
  UNSURE: "Not sure yet",
};

// Sheep gestation — used to suggest a due date when a breeding is logged.
export const GESTATION_DAYS = 147;

// ———————————————————————————————————————————————————————————————————————
// V4 — manufacturing (SPEC §§12–13, 15)
// ———————————————————————————————————————————————————————————————————————

export const FILAMENT_MATERIALS = [
  "PLA",
  "PETG",
  "TPU",
  "ABS",
  "ASA",
  "Nylon",
  "PC",
  "Resin",
  "Other",
] as const;

export const SPOOL_STATUSES = ["IN_STOCK", "IN_USE", "EMPTY", "RETIRED"] as const;
export type SpoolStatus = (typeof SPOOL_STATUSES)[number];
export const SPOOL_STATUS_LABELS: Record<SpoolStatus, string> = {
  IN_STOCK: "In stock",
  IN_USE: "Loaded / in use",
  EMPTY: "Empty",
  RETIRED: "Retired",
};

export const PRINT_JOB_STATUSES = ["QUEUED", "PRINTING", "DONE", "SHIPPED", "CANCELLED"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];
export const PRINT_JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  QUEUED: "Queued",
  PRINTING: "Printing",
  DONE: "Done",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};

// Defaults used for a job's machine/labor cost estimate when the operator
// hasn't set their own rates. Deliberately conservative and editable.
export const DEFAULT_MACHINE_RATE_CENTS_PER_HOUR = 50; // $0.50/hr of printer time
export const DEFAULT_LABOR_RATE_CENTS_PER_HOUR = 2500; // $25/hr of hands-on time

// ———————————————————————————————————————————————————————————————————————
// Banking (SPEC §18)
// ———————————————————————————————————————————————————————————————————————

export const BANK_TXN_STATUSES = ["UNMATCHED", "MATCHED", "IGNORED"] as const;
export type BankTxnStatus = (typeof BANK_TXN_STATUSES)[number];
export const BANK_TXN_STATUS_LABELS: Record<BankTxnStatus, string> = {
  UNMATCHED: "Needs a match",
  MATCHED: "Matched",
  IGNORED: "Ignored / personal",
};

// ———————————————————————————————————————————————————————————————————————
// Documents (SPEC §31)
// ———————————————————————————————————————————————————————————————————————

export const DOCUMENT_OWNER_TYPES = [
  "ASSET",
  "CUSTOMER",
  "ANIMAL",
  "PRINT_JOB",
  "INVOICE",
  "EXPENSE",
] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

export const DOCUMENT_KINDS = [
  "PHOTO",
  "MANUAL",
  "WARRANTY",
  "PAPERWORK",
  "CAD",
  "DOCUMENT",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  PHOTO: "Photo",
  MANUAL: "Manual",
  WARRANTY: "Warranty",
  PAPERWORK: "Paperwork",
  CAD: "CAD / STL file",
  DOCUMENT: "Document",
};
