import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate, startOfYear } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { animalCostBreakdown, animalLabel, saleProfitCents } from "@/lib/livestock";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
} from "@/components/ui";
import { deleteLivestockSale } from "../actions";

export const dynamic = "force-dynamic";

export default async function LivestockSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const accountId = await requireAccountId();
  const { saved } = await searchParams;
  const now = new Date();
  const yearStart = startOfYear(now);

  const sales = await prisma.livestockSale.findMany({
    where: { accountId },
    orderBy: { date: "desc" },
  });

  const animalIds = [...new Set(sales.map((s) => s.animalId).filter((v): v is string => !!v))];
  const customerIds = [...new Set(sales.map((s) => s.customerId).filter((v): v is string => !!v))];

  const [animals, customers, expenseSums, eventSums] = await Promise.all([
    prisma.animal.findMany({
      where: { accountId, id: { in: animalIds } },
      select: { id: true, tagNumber: true, name: true, acquisitionCostCents: true },
    }),
    prisma.customer.findMany({
      where: { accountId, id: { in: customerIds } },
      select: { id: true, name: true },
    }),
    prisma.expense.groupBy({
      by: ["animalId"],
      where: { accountId, animalId: { in: animalIds } },
      _sum: { amountCents: true },
    }),
    prisma.animalEvent.groupBy({
      by: ["animalId"],
      where: { accountId, animalId: { in: animalIds } },
      _sum: { costCents: true },
    }),
  ]);

  const animalById = new Map(animals.map((a) => [a.id, a]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const expenseByAnimal = new Map(expenseSums.map((r) => [r.animalId, r._sum.amountCents ?? 0]));
  const eventByAnimal = new Map(eventSums.map((r) => [r.animalId, r._sum.costCents ?? 0]));

  const thisYear = sales.filter((s) => s.date >= yearStart);
  const revenueThisYear = thisYear.reduce((sum, s) => sum + s.salePriceCents, 0);
  const averagePrice =
    thisYear.length > 0 ? Math.round(revenueThisYear / thisYear.length) : null;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Link
          href="/livestock"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Flock
        </Link>
        <span className="rounded-xl bg-oak-700 px-3 py-2 text-center font-semibold text-white">
          Sales
        </span>
        <Link
          href="/livestock/report"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Costs
        </Link>
      </div>

      <PageHeader
        title="Livestock sales"
        sub="Every animal sold — the money lands in your books by itself."
        action={
          <Link href="/livestock/sales/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Sale saved."
          hint="It's on the books as farm income under “Livestock sales,” and the animal is marked sold."
          actionHref="/livestock/sales/new"
          actionLabel="Record another sale"
        />
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label={`Sold in ${now.getFullYear()}`} value={String(thisYear.length)} />
        <StatCard
          label={`Money in ${now.getFullYear()}`}
          value={formatCents(revenueThisYear)}
          tone="green"
        />
        <StatCard
          label="Average price"
          value={averagePrice != null ? formatCents(averagePrice) : "—"}
          sub="this year"
        />
      </div>

      {sales.length === 0 ? (
        <EmptyState
          title="No livestock sales yet."
          hint="Record a sale here and the income posts itself to the farm books — no double entry."
          actionHref="/livestock/sales/new"
          actionLabel="Record a sale"
        />
      ) : (
        <div className="space-y-2">
          {sales.map((s) => {
            const animal = s.animalId ? animalById.get(s.animalId) : null;
            const buyer = s.customerId ? customerById.get(s.customerId)?.name : s.buyerName;
            const cost = animal
              ? animalCostBreakdown({
                  acquisitionCostCents: animal.acquisitionCostCents,
                  expenseCents: expenseByAnimal.get(animal.id) ?? 0,
                  eventCostCents: eventByAnimal.get(animal.id) ?? 0,
                })
              : null;
            const profit = cost ? saleProfitCents(s.salePriceCents, cost.totalCents) : null;

            return (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-900">
                      {animal ? (
                        <Link href={`/livestock/${animal.id}`} className="underline">
                          {animalLabel(animal)}
                        </Link>
                      ) : (
                        "Livestock (no particular animal)"
                      )}
                    </div>
                    <div className="text-sm text-stone-500">
                      {[buyer ?? "Buyer not recorded", formatDate(s.date)].join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold tabular-nums text-stone-900">
                      {formatCents(s.salePriceCents)}
                    </div>
                    {s.weightLbs != null ? (
                      <div className="text-xs text-stone-500">{s.weightLbs} lbs</div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.paymentMethod ? <Chip>{s.paymentMethod}</Chip> : null}
                  {s.incomeId ? <Chip tone="green">On the books</Chip> : null}
                </div>

                <p className="mt-2 text-sm text-stone-600">
                  {profit != null && cost != null
                    ? profit >= 0
                      ? `Made ${formatCents(profit)} on this one — sold for ${formatCents(s.salePriceCents)}, cost ${formatCents(cost.totalCents)} to raise.`
                      : `Came up ${formatCents(Math.abs(profit))} short — sold for ${formatCents(s.salePriceCents)}, cost ${formatCents(cost.totalCents)} to raise.`
                    : `Sold for ${formatCents(s.salePriceCents)}. Tie the sale to an animal to see what it cost to raise.`}
                </p>

                {s.processingNotes ? (
                  <p className="mt-1 text-sm text-stone-500">Processing: {s.processingNotes}</p>
                ) : null}
                {s.notes ? <p className="mt-1 text-sm text-stone-500">{s.notes}</p> : null}

                <form action={deleteLivestockSale} className="mt-2">
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs text-red-500">
                    remove this sale (takes the income back off the books)
                  </button>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
