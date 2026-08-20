import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Card, PageHeader, inputCls } from "@/components/ui";
import { classifyTerm, type SearchTerm } from "./search-terms";

export const dynamic = "force-dynamic";

// Every model this page searches: which columns a text term may hit, which
// money columns an amount term may equal, and the one date column a date term
// filters on. A model with no money column (Mileage — miles are not money) or
// no date column (Customer) leaves the slot empty; see NO_MATCH below.
type SearchableFields = {
  text: readonly string[];
  money: readonly string[];
  date: string | null;
};

// Ids are cuids, so `id: ""` matches no row. This is how a model that CANNOT
// satisfy a term drops out of the results entirely: a term is never silently
// ignored, otherwise searching "$87.42" would list every asset.
const NO_MATCH = { id: "" };

// SPEC §29: "Tractor #1 hydraulic 2026" should find every relevant expense,
// service record, and receipt. Every word must match somewhere in the record
// (AND across terms, OR across fields) — and a word that reads as a dollar
// amount ("87.42", "$87") or a date ("8/9/2026") searches those columns
// instead of the text ones.
function whereFor(terms: SearchTerm[], fields: SearchableFields) {
  return {
    AND: terms.map((term) => {
      if (term.kind === "money") {
        return fields.money.length > 0
          ? { OR: fields.money.map((f) => ({ [f]: term.cents })) }
          : NO_MATCH;
      }
      if (term.kind === "date") {
        return fields.date ? { [fields.date]: term.range } : NO_MATCH;
      }
      return { OR: fields.text.map((f) => ({ [f]: { contains: term.raw } })) };
    }),
  };
}

const HOUSEHOLD_FIELDS: SearchableFields = {
  text: ["description", "category", "notes", "paymentMethod"],
  money: ["amountCents"],
  date: "date",
};

const EXPENSE_FIELDS: SearchableFields = {
  text: [
    "description",
    "vendorName",
    "accountingCategory",
    "managementCategory",
    "businessPurpose",
    "notes",
  ],
  money: ["amountCents", "salesTaxCents"],
  date: "date",
};

const RECEIPT_FIELDS: SearchableFields = {
  text: ["vendorName", "notes", "receiptNumber", "fileName"],
  money: ["totalCents", "salesTaxCents"],
  date: "receiptDate",
};

const ASSET_FIELDS: SearchableFields = {
  text: ["name", "manufacturer", "model", "serialNumber", "assetTag", "notes"],
  money: ["purchasePriceCents"],
  date: "purchaseDate",
};

const INCOME_FIELDS: SearchableFields = {
  text: ["description", "source", "category", "notes"],
  money: ["amountCents"],
  date: "date",
};

const MAINTENANCE_FIELDS: SearchableFields = {
  text: ["description", "category", "vendorName", "notes"],
  money: ["partsCostCents", "laborCostCents"],
  date: "date",
};

const CUSTOMER_FIELDS: SearchableFields = {
  text: ["name", "company", "email", "phone", "notes"],
  money: [],
  date: null,
};

const INVOICE_FIELDS: SearchableFields = {
  text: ["number", "notes", "terms"],
  money: ["totalCents"],
  date: "issueDate",
};

const MILEAGE_FIELDS: SearchableFields = {
  text: ["destination", "startLocation", "purpose", "customerName", "notes"],
  money: [], // miles are not money
  date: "date",
};

// "text “hydraulic” · amount $87.42 · date Aug 9, 2026" — only the parts present.
function describeTerms(terms: SearchTerm[]): string {
  const texts = terms.flatMap((t) => (t.kind === "text" ? [`“${t.raw}”`] : []));
  const amounts = terms.flatMap((t) => (t.kind === "money" ? [formatCents(t.cents)] : []));
  const dates = terms.flatMap((t) => (t.kind === "date" ? [formatDate(t.range.gte)] : []));

  const parts: string[] = [];
  if (texts.length > 0) parts.push(`text ${texts.join(", ")}`);
  if (amounts.length > 0) parts.push(`amount ${amounts.join(", ")}`);
  if (dates.length > 0) parts.push(`date ${dates.join(", ")}`);
  return parts.join(" · ");
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const accountId = await requireAccountId();
  const { q } = await searchParams;
  const now = new Date();
  const terms = (q ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => classifyTerm(word, now));

  const [expenses, receipts, assets, incomes, maintenance, customers, invoices, trips, household] =
    terms.length === 0
      ? [[], [], [], [], [], [], [], [], []]
      : await Promise.all([
          prisma.expense.findMany({
            where: { AND: [{ accountId }, whereFor(terms, EXPENSE_FIELDS)] },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.receipt.findMany({
            where: { AND: [{ accountId }, whereFor(terms, RECEIPT_FIELDS)] },
            take: 25,
            orderBy: { createdAt: "desc" },
          }),
          prisma.asset.findMany({
            where: { AND: [{ accountId }, whereFor(terms, ASSET_FIELDS)] },
            take: 25,
          }),
          prisma.income.findMany({
            where: { AND: [{ accountId }, whereFor(terms, INCOME_FIELDS)] },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.maintenanceRecord.findMany({
            where: { AND: [{ accountId }, whereFor(terms, MAINTENANCE_FIELDS)] },
            include: { asset: { select: { id: true, name: true } } },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.customer.findMany({
            where: { AND: [{ accountId }, whereFor(terms, CUSTOMER_FIELDS)] },
            take: 25,
            orderBy: { name: "asc" },
          }),
          prisma.invoice.findMany({
            where: { AND: [{ accountId }, whereFor(terms, INVOICE_FIELDS)] },
            include: { customer: { select: { name: true } } },
            take: 25,
            orderBy: { issueDate: "desc" },
          }),
          prisma.mileageLog.findMany({
            where: { AND: [{ accountId }, whereFor(terms, MILEAGE_FIELDS)] },
            take: 25,
            orderBy: { date: "desc" },
          }),
          prisma.householdExpense.findMany({
            where: { AND: [{ accountId }, whereFor(terms, HOUSEHOLD_FIELDS)] },
            take: 25,
            orderBy: { date: "desc" },
          }),
        ]);

  const total =
    expenses.length +
    receipts.length +
    assets.length +
    incomes.length +
    maintenance.length +
    customers.length +
    invoices.length +
    trips.length +
    household.length;

  return (
    <div>
      <PageHeader title="Search" sub="Vendors, amounts, equipment, categories — everything." />

      <div className="mb-4">
        <form action="/search" method="GET">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder={'Try "Tractor #1 hydraulic" or "87.42"'}
            className={inputCls}
            autoFocus
          />
        </form>
        {terms.length > 0 ? (
          <p className="mt-1.5 text-xs text-stone-500">Matching: {describeTerms(terms)}</p>
        ) : null}
      </div>

      {terms.length === 0 ? (
        <p className="text-center text-sm text-stone-500">
          Type to search across expenses, receipts, income, equipment, and maintenance history.
        </p>
      ) : total === 0 ? (
        <p className="text-center text-sm text-stone-500">No matches for “{q}”.</p>
      ) : (
        <div className="space-y-4">
          {expenses.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Expenses
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {expenses.map((e) => (
                  <Link
                    key={e.id}
                    href={`/expenses/${e.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.description}</span>
                      <span className="text-sm text-stone-500">
                        {e.vendorName ?? "—"} · {formatDate(e.date)} · {e.accountingCategory}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {household.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Household
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {household.map((e) => (
                  <Link
                    key={e.id}
                    href={`/household/entry/${e.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {e.description ?? e.category}
                      </span>
                      <span className="text-sm text-stone-500">
                        {e.category} · {formatDate(e.date)}
                      </span>
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${e.kind === "INCOME" ? "text-emerald-700" : ""}`}
                    >
                      {e.kind === "INCOME" ? "+" : ""}
                      {formatCents(e.amountCents)}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {maintenance.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Maintenance
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {maintenance.map((m) => (
                  <Link
                    key={m.id}
                    href={`/assets/${m.asset.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.description}</span>
                      <span className="text-sm text-stone-500">
                        {m.asset.name} · {formatDate(m.date)} · {m.category}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCents((m.partsCostCents ?? 0) + (m.laborCostCents ?? 0))}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {receipts.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Receipts
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {receipts.map((r) => (
                  <Link
                    key={r.id}
                    href={`/receipts/${r.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {r.vendorName ?? "Unknown vendor"}
                      </span>
                      <span className="text-sm text-stone-500">
                        {formatDate(r.receiptDate)} · {r.status}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(r.totalCents)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {incomes.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Income
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {incomes.map((i) => (
                  <Link
                    key={i.id}
                    href={`/income/${i.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.description}</span>
                      <span className="text-sm text-stone-500">
                        {i.source ?? "—"} · {formatDate(i.date)}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-oak-700">
                      +{formatCents(i.amountCents)}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {invoices.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Invoices
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {invoices.map((i) => (
                  <Link
                    key={i.id}
                    href={`/invoices/${i.id}`}
                    className="flex justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {i.number} · {i.customer.name}
                      </span>
                      <span className="text-sm text-stone-500">{formatDate(i.issueDate)}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatCents(i.totalCents)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {customers.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Customers
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {customers.map((c) => (
                  <Link key={c.id} href={`/customers/${c.id}`} className="block px-4 py-3">
                    <span className="block font-medium">{c.name}</span>
                    <span className="text-sm text-stone-500">
                      {[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {trips.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Mileage
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {trips.map((t) => (
                  <Link key={t.id} href="/mileage" className="flex justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.destination}</span>
                      <span className="text-sm text-stone-500">
                        {formatDate(t.date)} · {t.purpose}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {t.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {assets.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Equipment
              </h2>
              <Card className="divide-y divide-stone-100 p-0">
                {assets.map((a) => (
                  <Link key={a.id} href={`/assets/${a.id}`} className="block px-4 py-3">
                    <span className="block font-medium">{a.name}</span>
                    <span className="text-sm text-stone-500">
                      {[a.manufacturer, a.model, a.serialNumber].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
