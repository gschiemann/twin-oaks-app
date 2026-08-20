// Accountant package (SPEC §28, CSV slice): per-year reports a tax preparer
// can open directly in Excel. Behind the login gate like every other route.

import { prisma } from "@/lib/db";
import { currentAccountId } from "@/lib/auth";
import { csvResponse, dollars, toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const accountId = await currentAccountId();
  if (!accountId) return new Response("Sign in first.", { status: 401 });
  const { report } = await params;
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  if (report === "expenses") {
    const rows = await prisma.expense.findMany({
      where: { accountId, taxYear: year },
      orderBy: { date: "asc" },
      include: { asset: { select: { name: true } }, receipts: { select: { id: true } } },
    });
    return csvResponse(
      `twin-oaks-expenses-${year}.csv`,
      toCsv(
        [
          "Date", "Vendor", "Description", "Amount", "Sales tax", "Payment method",
          "Division", "Accounting category", "Management category", "Business purpose",
          "Asset", "Tax status", "Capital purchase", "Receipts attached", "Notes",
        ],
        rows.map((e) => [
          dateOnly(e.date), e.vendorName, e.description, dollars(e.amountCents),
          dollars(e.salesTaxCents), e.paymentMethod, e.division, e.accountingCategory,
          e.managementCategory, e.businessPurpose, e.asset?.name,
          e.taxStatus, e.isCapital ? "YES" : "", e.receipts.length, e.notes,
        ]),
      ),
    );
  }

  if (report === "income") {
    const rows = await prisma.income.findMany({
      where: { accountId, taxYear: year },
      orderBy: { date: "asc" },
    });
    return csvResponse(
      `twin-oaks-income-${year}.csv`,
      toCsv(
        ["Date", "Source", "Description", "Amount", "Division", "Category", "Payment method", "Notes"],
        rows.map((i) => [
          dateOnly(i.date), i.source, i.description, dollars(i.amountCents),
          i.division, i.category, i.paymentMethod, i.notes,
        ]),
      ),
    );
  }

  if (report === "mileage") {
    const rows = await prisma.mileageLog.findMany({
      where: { accountId, taxYear: year },
      orderBy: { date: "asc" },
      include: { vehicle: { select: { name: true } } },
    });
    return csvResponse(
      `twin-oaks-mileage-${year}.csv`,
      toCsv(
        ["Date", "From", "Destination", "Purpose", "Customer", "Vehicle", "Start odometer", "End odometer", "Miles", "Notes"],
        rows.map((m) => [
          dateOnly(m.date), m.startLocation, m.destination, m.purpose, m.customerName,
          m.vehicle?.name, m.startOdometer, m.endOdometer, m.miles, m.notes,
        ]),
      ),
    );
  }

  if (report === "assets") {
    const rows = await prisma.asset.findMany({ where: { accountId }, orderBy: [{ division: "asc" }, { name: "asc" }] });
    return csvResponse(
      `twin-oaks-assets.csv`,
      toCsv(
        [
          "Name", "Asset tag", "Type", "Division", "Manufacturer", "Model", "Serial number",
          "Year", "Purchase date", "Purchase price", "Purchased from", "Financing",
          "Status", "Current hours", "Current mileage", "Notes",
        ],
        rows.map((a) => [
          a.name, a.assetTag, a.kind, a.division, a.manufacturer, a.model, a.serialNumber,
          a.year, a.purchaseDate ? dateOnly(a.purchaseDate) : "", dollars(a.purchasePriceCents),
          a.purchasedFrom, a.financingNotes, a.status, a.currentHours, a.currentMileage, a.notes,
        ]),
      ),
    );
  }

  if (report === "category-totals") {
    const [exp, inc] = await Promise.all([
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
    ]);
    return csvResponse(
      `twin-oaks-category-totals-${year}.csv`,
      toCsv(
        ["Type", "Category", "Total", "Transactions"],
        [
          ...exp.map((e) => ["Expense", e.accountingCategory, dollars(e._sum.amountCents ?? 0), e._count]),
          ...inc.map((i) => ["Income", i.category, dollars(i._sum.amountCents ?? 0), i._count]),
        ],
      ),
    );
  }

  if (report === "pnl") {
    const divisions = ["FARM", "TECH", "SHARED"];
    const [expAll, incAll, expByDiv, incByDiv, miles] = await Promise.all([
      prisma.expense.aggregate({ where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.income.aggregate({ where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.expense.groupBy({ by: ["division"], where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.income.groupBy({ by: ["division"], where: { accountId, taxYear: year }, _sum: { amountCents: true } }),
      prisma.mileageLog.aggregate({ where: { accountId, taxYear: year }, _sum: { miles: true } }),
    ]);
    const revenue = incAll._sum.amountCents ?? 0;
    const expenses = expAll._sum.amountCents ?? 0;
    const expOf = (d: string) => expByDiv.find((x) => x.division === d)?._sum.amountCents ?? 0;
    const incOf = (d: string) => incByDiv.find((x) => x.division === d)?._sum.amountCents ?? 0;

    const rows: unknown[][] = [
      ["Revenue", "ALL", dollars(revenue)],
      ["Expenses", "ALL", dollars(expenses)],
      ["Net profit", "ALL", dollars(revenue - expenses)],
      ...divisions.flatMap((d) => [
        ["Revenue", d, dollars(incOf(d))],
        ["Expenses", d, dollars(expOf(d))],
        ["Net profit", d, dollars(incOf(d) - expOf(d))],
      ]),
      ["Business miles (rate applied by accountant)", "ALL", miles._sum.miles ?? 0],
    ];
    return csvResponse(
      `twin-oaks-pnl-${year}.csv`,
      toCsv(["Line", "Division", "Amount (USD / miles)"], rows),
    );
  }

  return new Response("Unknown report", { status: 404 });
}
