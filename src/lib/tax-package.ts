// The accountant's ZIP — SPEC §28 "Tax-Time Document Package".
//
// One download per tax year containing everything a tax preparer needs:
// the six per-year CSV reports, every receipt original named so it can be
// found from the index without opening it, a receipt index that ties each
// expense to its file, and a plain-English README.
//
// ─────────────────────────────────────────────────────────────────────────
// DUPLICATION NOTE (please de-duplicate later)
// ─────────────────────────────────────────────────────────────────────────
// The six CSV builders below are copied from src/app/api/export/csv/[report]/
// route.ts, where they live inline inside the GET handler and cannot be
// imported. They are byte-for-byte the same columns and the same queries —
// only the FILE NAMES differ (the package uses the short, self-describing
// `expenses-2026.csv` form). The right fix is to lift those builders out of
// the route into this module (or a shared src/lib/reports.ts) and have the
// route call them, so the package and the individual downloads can never
// drift apart. That edit touches a file owned by another engineer, so it is
// deliberately NOT done here.

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { prisma } from "@/lib/db";
import { dollars, toCsv } from "@/lib/csv";
import { isOwnBlobUrl, readUpload } from "@/lib/storage";

// ─────────────────────────────────────────────────────────────────────────
// Budgets — why this endpoint has them
// ─────────────────────────────────────────────────────────────────────────
// The zip is STREAMED (see createTaxPackageStream): at most one receipt is
// ever resident in memory, so a 300 MB package does not mean a 300 MB
// serverless function. What streaming does NOT solve is WALL CLOCK — every
// blob-backed original is a separate network round trip, and a Vercel
// function is killed at `maxDuration` mid-response, which hands the farmer a
// truncated, unopenable zip. So there are two budgets, and whichever trips
// first stops us adding ORIGINALS only:
//
//   * the CSVs, the receipt index and the README are always written, and
//   * every original left out is named in the index with the reason, and
//     counted in the README.
//
// A package missing three big PDFs that says so beats a request that dies.
export const PACKAGE_MAX_RECEIPT_BYTES = Number(process.env.TAX_PACKAGE_MAX_BYTES) || 200 * 1024 * 1024;
// Leaves headroom under the route's maxDuration=60 for the index, the README
// and flushing the central directory.
export const PACKAGE_TIME_BUDGET_MS = Number(process.env.TAX_PACKAGE_TIME_BUDGET_MS) || 45_000;
// One pathological file must not eat the whole budget by itself.
export const PACKAGE_MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

const RECEIPTS_DIR = "receipts/";

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────
// The six per-year CSVs (copied — see DUPLICATION NOTE above)
// ─────────────────────────────────────────────────────────────────────────

export type PackageCsv = { name: string; csv: string };

export async function buildYearCsvs(accountId: string, year: number): Promise<PackageCsv[]> {
  const [expenses, income, mileage, assets, catExp, catInc, expAll, incAll, expByDiv, incByDiv, milesAgg] =
    await Promise.all([
      prisma.expense.findMany({
        where: { accountId, taxYear: year },
        orderBy: { date: "asc" },
        include: { asset: { select: { name: true } }, receipts: { select: { id: true } } },
      }),
      prisma.income.findMany({ where: { accountId, taxYear: year }, orderBy: { date: "asc" } }),
      prisma.mileageLog.findMany({
        where: { accountId, taxYear: year },
        orderBy: { date: "asc" },
        include: { vehicle: { select: { name: true } } },
      }),
      prisma.asset.findMany({ where: { accountId }, orderBy: [{ division: "asc" }, { name: "asc" }] }),
      prisma.expense.groupBy({
        by: ["accountingCategory"],
        where: { accountId, taxYear: year },
        _sum: { amountCents: true },
        _count: true,
        orderBy: { _sum: { amountCents: "desc" } },
      }),
      prisma.income.groupBy({
        by: ["category"],
        where: { accountId, taxYear: year },
        _sum: { amountCents: true },
        _count: true,
        orderBy: { _sum: { amountCents: "desc" } },
      }),
      prisma.expense.aggregate({ where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.income.aggregate({ where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.expense.groupBy({ by: ["division"], where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.income.groupBy({ by: ["division"], where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.mileageLog.aggregate({ where: { accountId, taxYear: year }, _sum: { miles: true } }),
    ]);

  const divisions = ["FARM", "TECH", "SHARED"];
  const revenue = incAll._sum.amountCents ?? 0;
  const expenseTotal = expAll._sum.amountCents ?? 0;
  const expOf = (d: string) => expByDiv.find((x) => x.division === d)?._sum.amountCents ?? 0;
  const incOf = (d: string) => incByDiv.find((x) => x.division === d)?._sum.amountCents ?? 0;

  return [
    {
      name: `expenses-${year}.csv`,
      csv: toCsv(
        [
          "Date", "Vendor", "Description", "Amount", "Sales tax", "Payment method",
          "Division", "Accounting category", "Management category", "Business purpose",
          "Asset", "Tax status", "Capital purchase", "Receipts attached", "Notes",
        ],
        expenses.map((e) => [
          dateOnly(e.date), e.vendorName, e.description, dollars(e.amountCents),
          dollars(e.salesTaxCents), e.paymentMethod, e.division, e.accountingCategory,
          e.managementCategory, e.businessPurpose, e.asset?.name,
          e.taxStatus, e.isCapital ? "YES" : "", e.receipts.length, e.notes,
        ]),
      ),
    },
    {
      name: `income-${year}.csv`,
      csv: toCsv(
        ["Date", "Source", "Description", "Amount", "Division", "Category", "Payment method", "Notes"],
        income.map((i) => [
          dateOnly(i.date), i.source, i.description, dollars(i.amountCents),
          i.division, i.category, i.paymentMethod, i.notes,
        ]),
      ),
    },
    {
      name: `profit-and-loss-${year}.csv`,
      csv: toCsv(
        ["Line", "Division", "Amount (USD / miles)"],
        [
          ["Revenue", "ALL", dollars(revenue)],
          ["Expenses", "ALL", dollars(expenseTotal)],
          ["Net profit", "ALL", dollars(revenue - expenseTotal)],
          ...divisions.flatMap((d) => [
            ["Revenue", d, dollars(incOf(d))],
            ["Expenses", d, dollars(expOf(d))],
            ["Net profit", d, dollars(incOf(d) - expOf(d))],
          ]),
          ["Business miles (rate applied by accountant)", "ALL", milesAgg._sum.miles ?? 0],
        ] as unknown[][],
      ),
    },
    {
      name: `category-totals-${year}.csv`,
      csv: toCsv(
        ["Type", "Category", "Total", "Transactions"],
        [
          ...catExp.map((e) => ["Expense", e.accountingCategory, dollars(e._sum.amountCents ?? 0), e._count]),
          ...catInc.map((i) => ["Income", i.category, dollars(i._sum.amountCents ?? 0), i._count]),
        ],
      ),
    },
    {
      name: `mileage-${year}.csv`,
      csv: toCsv(
        ["Date", "From", "Destination", "Purpose", "Customer", "Vehicle", "Start odometer", "End odometer", "Miles", "Notes"],
        mileage.map((m) => [
          dateOnly(m.date), m.startLocation, m.destination, m.purpose, m.customerName,
          m.vehicle?.name, m.startOdometer, m.endOdometer, m.miles, m.notes,
        ]),
      ),
    },
    {
      // NOTE: the asset register is deliberately NOT year-filtered — it is the
      // full equipment list as of today, which is what depreciation schedules
      // are built from. The README says so.
      name: `asset-register-${year}.csv`,
      csv: toCsv(
        [
          "Name", "Asset tag", "Type", "Division", "Manufacturer", "Model", "Serial number",
          "Year", "Purchase date", "Purchase price", "Purchased from", "Financing",
          "Status", "Current hours", "Current mileage", "Notes",
        ],
        assets.map((a) => [
          a.name, a.assetTag, a.kind, a.division, a.manufacturer, a.model, a.serialNumber,
          a.year, a.purchaseDate ? dateOnly(a.purchaseDate) : "", dollars(a.purchasePriceCents),
          a.purchasedFrom, a.financingNotes, a.status, a.currentHours, a.currentMileage, a.notes,
        ]),
      ),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Receipt file naming — "findable without opening it"
// ─────────────────────────────────────────────────────────────────────────
// YYYY-MM-DD_Vendor_Amount_<shortid>.<ext>, built from the EXPENSE's date,
// vendor and amount (not the receipt's own scanned values) so the name
// matches the receipt-index row it hangs off — the index is how a human
// finds the file, so the two must agree.

// Mirrors EXT_BY_MIME in src/lib/storage.ts.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/html": "html",
  "text/plain": "txt",
};

export function slugifyVendor(raw: string | null | undefined): string {
  const slug = (raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip diacritics
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, "-")    // everything unsafe becomes a hyphen
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "Unknown-Vendor";
}

function extensionFor(mimeType: string | null | undefined, fileName: string | null | undefined): string {
  const byMime = mimeType ? EXT_BY_MIME[mimeType.toLowerCase().split(";")[0].trim()] : undefined;
  if (byMime) return byMime;
  const dot = (fileName ?? "").lastIndexOf(".");
  const raw = dot > -1 ? (fileName ?? "").slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,10}$/.test(raw) ? raw : "bin";
}

/** The in-zip name for one receipt original. `taken` de-duplicates collisions. */
export function receiptEntryName(
  args: {
    date: Date;
    vendor: string | null | undefined;
    amountCents: number;
    receiptId: string;
    mimeType?: string | null;
    fileName?: string | null;
  },
  taken?: Set<string>,
): string {
  const shortId = args.receiptId.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "00000000";
  const amount = (args.amountCents / 100).toFixed(2);
  const base = `${dateOnly(args.date)}_${slugifyVendor(args.vendor)}_${amount}_${shortId}`;
  const ext = extensionFor(args.mimeType, args.fileName);
  let name = `${base}.${ext}`;
  if (taken) {
    let n = 2;
    while (taken.has(name)) name = `${base}-${n++}.${ext}`;
    taken.add(name);
  }
  return name;
}

// ─────────────────────────────────────────────────────────────────────────
// Reading a stored original — all three storage tiers
// ─────────────────────────────────────────────────────────────────────────
// Matches src/app/api/files/[...path]/route.ts and /api/files/remote:
//   * https://…vercel-storage.com  → Vercel Blob, fetched server-side. The
//     isOwnBlobUrl allowlist is what stops a poisoned filePath turning this
//     into an SSRF relay, exactly as in the proxy route.
//   * db:<id>                      → StoredFile row, SCOPED TO accountId so a
//                                    stale cross-account id can never leak.
//   * anything else                → local disk via readUpload(), which does
//                                    its own isSafeStorageKey traversal check.

type Original =
  | { kind: "stream"; body: ReadableStream<Uint8Array> }
  | { kind: "buffer"; bytes: Uint8Array };

export async function openReceiptOriginal(
  storageKey: string | null | undefined,
  accountId: string,
): Promise<Original | null> {
  if (!storageKey) return null;

  if (storageKey.startsWith("http")) {
    if (!isOwnBlobUrl(storageKey)) return null;
    const res = await fetch(storageKey, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res || !res.ok || !res.body) return null;
    return { kind: "stream", body: res.body };
  }

  if (storageKey.startsWith("db:")) {
    const id = storageKey.slice(3);
    if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;
    const row = await prisma.storedFile
      .findFirst({ where: { id, accountId }, select: { data: true } })
      .catch(() => null);
    return row ? { kind: "buffer", bytes: new Uint8Array(row.data) } : null;
  }

  const buf = await readUpload(storageKey);
  return buf ? { kind: "buffer", bytes: new Uint8Array(buf) } : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Preflight — cheap metadata-only answer for the UI
// ─────────────────────────────────────────────────────────────────────────

export type PackagePreflight = {
  year: number;
  fileCount: number;
  approxBytes: number;
  missingReceipts: number;
  /** Originals we expect to drop because they blow the byte budget. */
  overBudget: boolean;
};

export async function taxPackagePreflight(accountId: string, year: number): Promise<PackagePreflight> {
  const [expenses, incomeCount, mileageCount, assetCount, unfiled] = await Promise.all([
    prisma.expense.findMany({
      where: { accountId, taxYear: year },
      select: { id: true, receipts: { select: { filePath: true, fileSize: true } } },
    }),
    prisma.income.count({ where: { accountId, taxYear: year } }),
    prisma.mileageLog.count({ where: { accountId, taxYear: year } }),
    prisma.asset.count({ where: { accountId } }),
    unfiledReceiptCount(accountId, year),
  ]);

  let receiptFiles = 0;
  let receiptBytes = 0;
  let missingReceipts = 0;
  for (const e of expenses) {
    const withFile = e.receipts.filter((r) => !!r.filePath);
    if (withFile.length === 0) missingReceipts++;
    for (const r of withFile) {
      receiptFiles++;
      // Unknown size (older rows) — assume a shrunk phone photo.
      receiptBytes += r.fileSize ?? 500_000;
    }
  }

  // Rough CSV weight: rows × a typical line, plus the index and README.
  const csvBytes =
    expenses.length * 220 + incomeCount * 140 + mileageCount * 150 + assetCount * 200 +
    expenses.length * 200 + 3_000;

  return {
    year,
    // six CSVs + receipt-index.csv + README.txt + the originals
    fileCount: 8 + receiptFiles,
    approxBytes: receiptBytes + csvBytes,
    missingReceipts,
    overBudget: receiptBytes > PACKAGE_MAX_RECEIPT_BYTES,
  };
}

/** Receipts dated in `year` that are not attached to any expense — real
 *  paperwork that this package cannot include, because the index is keyed on
 *  expenses. Surfaced in the README so nothing is silently dropped. */
async function unfiledReceiptCount(accountId: string, year: number): Promise<number> {
  return prisma.receipt
    .count({
      where: {
        accountId,
        expenseId: null,
        filePath: { not: null },
        receiptDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
      },
    })
    .catch(() => 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Streaming zip
// ─────────────────────────────────────────────────────────────────────────
// fflate's `Zip` is push-based: it hands us output chunks through a callback
// as each entry is written. We bridge that into a Web ReadableStream so the
// bytes leave the function as they are produced — the response starts within
// a second and peak memory is one receipt, not the whole archive.
//
// Backpressure is real, not decorative: the producer awaits `ready()` before
// every entry and between every chunk, and `ready()` only resolves once the
// stream's queue has drained below the high-water mark (pull() releases it).
// Without that, a slow phone on LTE would let the queue grow to the full
// package size in RAM, defeating the point of streaming.

type Ready = () => Promise<void>;

/** Deflated text entry (CSV / README — text compresses ~5×). */
async function addTextEntry(
  zip: Zip, ready: Ready, name: string, text: string, mtime: Date,
): Promise<void> {
  await ready();
  const entry = new ZipDeflate(name, { level: 6 });
  entry.mtime = mtime;
  zip.add(entry);
  entry.push(new TextEncoder().encode(text), true);
}

/** Stored (uncompressed) entry for an original. JPEGs, PNGs and PDFs are
 *  already compressed — deflating them burns CPU we do not have for ~0 gain,
 *  and CPU is the budget that actually runs out here. Returns bytes written. */
async function addOriginalEntry(
  zip: Zip, ready: Ready, aborted: () => boolean,
  name: string, mtime: Date, source: Original,
): Promise<number> {
  await ready();
  const entry = new ZipPassThrough(name);
  entry.mtime = mtime;
  zip.add(entry);

  if (source.kind === "buffer") {
    entry.push(source.bytes, true);
    return source.bytes.byteLength;
  }

  let written = 0;
  const reader = source.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        written += value.byteLength;
        entry.push(value, false);
        await ready();
      }
      // The consumer hung up. Finalize the entry so the archive stays
      // structurally valid, then let the caller stop.
      if (aborted()) break;
    }
  } finally {
    entry.push(new Uint8Array(0), true);
    reader.releaseLock();
    await source.body.cancel().catch(() => {});
  }
  return written;
}

type ReceiptOutcome = { name: string } | { skipped: string };

type IndexRow = {
  date: Date;
  vendor: string;
  description: string;
  amountCents: number;
  category: string;
  division: string;
  taxStatus: string;
  outcomes: ReceiptOutcome[];
};

const NO_RECEIPT = "NO RECEIPT ON FILE";
const NOT_INCLUDED = "NOT IN THIS PACKAGE — see next column";

function indexCsv(rows: IndexRow[]): string {
  return toCsv(
    [
      "Date", "Vendor", "Description", "Amount", "Accounting category", "Division",
      "Tax status", "Receipt file in this package", "Receipt notes",
    ],
    rows.map((r) => {
      const included = r.outcomes.flatMap((o) => ("name" in o ? [o.name] : []));
      const skipped = r.outcomes.flatMap((o) => ("skipped" in o ? [o.skipped] : []));
      const fileCell =
        included.length > 0 ? included.join("; ")
        : r.outcomes.length === 0 ? NO_RECEIPT
        : NOT_INCLUDED;
      const note =
        r.outcomes.length === 0 ? "No receipt was ever attached to this expense."
        : skipped.length === 0 ? ""
        : skipped.join("; ");
      return [
        dateOnly(r.date), r.vendor, r.description, dollars(r.amountCents),
        r.category, r.division, r.taxStatus, fileCell, note,
      ];
    }),
  );
}

type Tally = {
  expenses: number;
  receiptsIncluded: number;
  receiptBytes: number;
  expensesWithNoReceipt: number;
  originalsMissing: number;
  droppedForSize: number;
  droppedForTime: number;
  unfiledReceipts: number;
  truncated: boolean;
};

function readme(year: number, generatedAt: Date, t: Tally): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const lines = [
    `TWIN OAKS FARM & TECH LLC — TAX PACKAGE FOR ${year}`,
    `Generated ${generatedAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}`,
    ``,
    `WHAT THIS IS`,
    `This is one year of business books, exported from Twin Oaks OS for your`,
    `tax preparer. Everything here covers tax year ${year} unless noted.`,
    ``,
    `WHAT IS IN THE ZIP`,
    `  expenses-${year}.csv           Every business expense, one row each.`,
    `  income-${year}.csv             Every business receipt of money, one row each.`,
    `  profit-and-loss-${year}.csv    Revenue, expenses and net profit — total and`,
    `                                 split by division (FARM / TECH / SHARED).`,
    `                                 Business miles are listed raw; the mileage`,
    `                                 RATE is applied by the preparer, not by us.`,
    `  category-totals-${year}.csv    Expense and income totals per category.`,
    `  mileage-${year}.csv            The mileage log, with odometer readings.`,
    `  asset-register-${year}.csv     The equipment list. NOTE: this is the full`,
    `                                 register as of today, not filtered to ${year},`,
    `                                 because depreciation schedules need the`,
    `                                 whole list.`,
    `  receipt-index.csv              One row per expense, tying it to its receipt`,
    `                                 file in this zip. Start here.`,
    `  receipts/                      The receipt originals — photos and PDFs.`,
    ``,
    `HOW TO FIND A RECEIPT`,
    `Open receipt-index.csv, find the expense, and read the "Receipt file in`,
    `this package" column. That is the exact filename inside receipts/.`,
    `Filenames are DATE_VENDOR_AMOUNT_ID, e.g. 2026-03-14_Tractor-Supply_128.44_a1b2c3d4.pdf,`,
    `so the folder can be scanned by eye without opening anything.`,
    ``,
    `COLUMNS IN receipt-index.csv`,
    `  Date / Vendor / Description / Amount   As recorded on the expense.`,
    `  Accounting category                    The bookkeeping category.`,
    `  Division                               FARM, TECH or SHARED.`,
    `  Tax status                             The owner's classification flag.`,
    `                                         NEEDS_REVIEW is the default and means`,
    `                                         exactly that — nobody has decided yet.`,
    `  Receipt file in this package           The filename in receipts/, or`,
    `                                         "${NO_RECEIPT}".`,
    `  Receipt notes                          Why a receipt is not here, if it is not.`,
    ``,
    `WHAT THIS PACKAGE CONTAINS, BY THE NUMBERS`,
    `  Expenses in ${year} .......................... ${t.expenses}`,
    `  Receipt originals included ................. ${t.receiptsIncluded} (${mb(t.receiptBytes)})`,
    `  Expenses with no receipt attached .......... ${t.expensesWithNoReceipt}`,
  ];

  if (t.originalsMissing > 0) {
    lines.push(
      `  Receipts whose original could not be read .. ${t.originalsMissing}`,
      `      These expenses have a receipt record but the stored file could not be`,
      `      retrieved. They are marked in receipt-index.csv.`,
    );
  }
  if (t.droppedForSize > 0 || t.droppedForTime > 0) {
    lines.push(
      `  Receipts left out of this download ......... ${t.droppedForSize + t.droppedForTime}`,
      ``,
      `  *** THIS PACKAGE IS INCOMPLETE ***`,
      `  ${t.droppedForSize} receipt original(s) were larger than the remaining size budget`,
      `  (${mb(PACKAGE_MAX_RECEIPT_BYTES)} of originals per download) and ${t.droppedForTime} were reached after the`,
      `  download had already run for ${Math.round(PACKAGE_TIME_BUDGET_MS / 1000)} seconds, which is as long as the`,
      `  server is allowed to spend building one zip. Every one of them is named`,
      `  in receipt-index.csv with the reason, so nothing is hidden. Those`,
      `  originals are still in the app — open the expense in Twin Oaks OS and`,
      `  download the receipt individually, or ask the owner to re-run this`,
      `  export for a narrower set of records.`,
    );
  }
  if (t.unfiledReceipts > 0) {
    lines.push(
      ``,
      `  ${t.unfiledReceipts} receipt(s) dated in ${year} are still uncategorized in the app's`,
      `  Inbox and are NOT in this package, because they are not attached to any`,
      `  expense yet. They may represent deductions that are not on these reports.`,
      `  The owner should file them in Twin Oaks OS and re-export.`,
    );
  }

  lines.push(
    ``,
    `A STANDING CAUTION`,
    `Twin Oaks OS organizes records. It does not decide tax treatment.`,
    `Nothing in this package is a determination that an expense is deductible,`,
    `capitalizable, or business rather than personal. Categories and tax-status`,
    `flags are the owner's bookkeeping labels, entered for your review — the`,
    `default for anything not yet looked at is NEEDS_REVIEW. Amounts are as`,
    `recorded by the owner and are not audited or reconciled to bank statements`,
    `by this app. All professional judgment is yours.`,
    ``,
    `Questions about how a number was produced: the underlying rows are in the`,
    `CSVs above, and a full JSON backup of every record is available from the`,
    `app under More -> Download backup.`,
    ``,
  );
  return lines.join("\r\n");
}

// ─────────────────────────────────────────────────────────────────────────
// The producer
// ─────────────────────────────────────────────────────────────────────────
// Order matters: the CSVs go first so the accountant gets the numbers even if
// the network dies mid-download, and receipt-index.csv + README.txt go LAST
// because only then do we know which originals actually made it in. Zip
// readers sort by name, so the tail position is invisible to the user.

async function writePackage(
  zip: Zip, ready: Ready, aborted: () => boolean, accountId: string, year: number,
): Promise<void> {
  const generatedAt = new Date();
  const deadline = Date.now() + PACKAGE_TIME_BUDGET_MS;

  for (const f of await buildYearCsvs(accountId, year)) {
    if (aborted()) return;
    await addTextEntry(zip, ready, f.name, f.csv, generatedAt);
  }

  const expenses = await prisma.expense.findMany({
    where: { accountId, taxYear: year },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true, date: true, vendorName: true, description: true, amountCents: true,
      accountingCategory: true, division: true, taxStatus: true,
      vendor: { select: { name: true } },
      receipts: {
        orderBy: { createdAt: "asc" },
        select: { id: true, filePath: true, fileName: true, mimeType: true, fileSize: true },
      },
    },
  });

  const tally: Tally = {
    expenses: expenses.length,
    receiptsIncluded: 0,
    receiptBytes: 0,
    expensesWithNoReceipt: 0,
    originalsMissing: 0,
    droppedForSize: 0,
    droppedForTime: 0,
    unfiledReceipts: await unfiledReceiptCount(accountId, year),
    truncated: false,
  };

  const rows: IndexRow[] = [];
  const taken = new Set<string>();

  for (const e of expenses) {
    const vendor = e.vendorName || e.vendor?.name || "";
    const row: IndexRow = {
      date: e.date,
      vendor,
      description: e.description,
      amountCents: e.amountCents,
      category: e.accountingCategory,
      division: e.division,
      taxStatus: e.taxStatus,
      outcomes: [],
    };
    rows.push(row);

    const withFile = e.receipts.filter((r) => !!r.filePath);
    if (withFile.length === 0) {
      tally.expensesWithNoReceipt++;
      continue;
    }

    for (const r of withFile) {
      if (aborted()) return;

      const name = receiptEntryName(
        { date: e.date, vendor, amountCents: e.amountCents, receiptId: r.id, mimeType: r.mimeType, fileName: r.fileName },
        taken,
      );
      const declared = r.fileSize ?? null;

      if (Date.now() > deadline) {
        row.outcomes.push({ skipped: `${name}: left out — this download hit its time limit` });
        tally.droppedForTime++;
        tally.truncated = true;
        continue;
      }
      if (declared != null && declared > PACKAGE_MAX_SINGLE_FILE_BYTES) {
        row.outcomes.push({ skipped: `${name}: left out — file is too large for a package download` });
        tally.droppedForSize++;
        tally.truncated = true;
        continue;
      }
      // Unknown size counts as a shrunk photo; the real total is corrected
      // below once the bytes are through, so at most ONE entry can overshoot.
      if (tally.receiptBytes + (declared ?? 500_000) > PACKAGE_MAX_RECEIPT_BYTES) {
        row.outcomes.push({ skipped: `${name}: left out — this download hit its size limit` });
        tally.droppedForSize++;
        tally.truncated = true;
        continue;
      }

      const source = await openReceiptOriginal(r.filePath, accountId).catch(() => null);
      if (!source) {
        row.outcomes.push({ skipped: `${name}: the stored original could not be read` });
        tally.originalsMissing++;
        continue;
      }

      const written = await addOriginalEntry(zip, ready, aborted, RECEIPTS_DIR + name, e.date, source);
      row.outcomes.push({ name });
      tally.receiptsIncluded++;
      tally.receiptBytes += written;
    }
  }

  if (aborted()) return;
  await addTextEntry(zip, ready, "receipt-index.csv", indexCsv(rows), generatedAt);
  await addTextEntry(zip, ready, "README.txt", readme(year, generatedAt, tally), generatedAt);
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

export function taxPackageFileName(year: number): string {
  return `twin-oaks-tax-package-${year}.zip`;
}

export function createTaxPackageStream(
  accountId: string,
  year: number,
): { stream: ReadableStream<Uint8Array>; filename: string } {
  let drain: (() => void) | null = null;
  let aborted = false;
  let finished = false;

  const release = () => {
    const d = drain;
    drain = null;
    d?.();
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const fail = (e: unknown) => {
          if (finished) return;
          finished = true;
          try { controller.error(e); } catch { /* already torn down */ }
        };

        const zip = new Zip((err, chunk, final) => {
          if (err) return fail(err);
          if (!finished && !aborted && chunk && chunk.length) {
            try { controller.enqueue(chunk); } catch { aborted = true; }
          }
          if (final && !finished) {
            finished = true;
            if (!aborted) {
              try { controller.close(); } catch { /* consumer already gone */ }
            }
          }
        });

        const ready: Ready = () => {
          if (aborted || finished) return Promise.resolve();
          if ((controller.desiredSize ?? 1) > 0) return Promise.resolve();
          return new Promise<void>((resolve) => { drain = resolve; });
        };

        void (async () => {
          try {
            await writePackage(zip, ready, () => aborted, accountId, year);
            zip.end();
          } catch (e) {
            console.error("[tax-package] build failed:", e);
            fail(e);
          } finally {
            release();
          }
        })();
      },
      pull: release,
      cancel() {
        aborted = true;
        release();
      },
    },
    // Byte-based high-water mark: buffer ~2 MB of finished zip output while
    // the client drinks it, rather than the default 1-CHUNK queue (which
    // would stall on every chunk) or an unbounded one (which would hold the
    // whole archive in memory).
    { highWaterMark: 2 * 1024 * 1024, size: (chunk) => chunk.byteLength },
  );

  return { stream, filename: taxPackageFileName(year) };
}
