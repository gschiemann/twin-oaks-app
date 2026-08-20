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
