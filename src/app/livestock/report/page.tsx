import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { startOfYear } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  costPerHeadCents,
  flockStats,
  formatLitter,
  lambingSummary,
} from "@/lib/livestock";
import { Card, PageHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FlockCostPage() {
  const accountId = await requireAccountId();
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = startOfYear(now);

  const [animals, pinned, unpinned, eventCosts, lambings, salesThisYear] = await Promise.all([
    prisma.animal.findMany({
      where: { accountId },
      select: { sex: true, status: true, birthDate: true },
    }),
    prisma.expense.aggregate({
      where: { accountId, division: "FARM", date: { gte: yearStart }, animalId: { not: null } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { accountId, division: "FARM", date: { gte: yearStart }, animalId: null },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.animalEvent.aggregate({
      where: { accountId, date: { gte: yearStart } },
      _sum: { costCents: true },
    }),
    prisma.animalEvent.findMany({
      where: { accountId, kind: "LAMBING" },
      select: { date: true, lambCount: true },
    }),
    prisma.livestockSale.aggregate({
      where: { accountId, date: { gte: yearStart } },
      _sum: { salePriceCents: true },
      _count: true,
    }),
  ]);

  const stats = flockStats(animals, now);
  const pinnedCents = pinned._sum.amountCents ?? 0;
  const unpinnedCents = unpinned._sum.amountCents ?? 0;
  const eventCents = eventCosts._sum.costCents ?? 0;
  const totalCostCents = pinnedCents + unpinnedCents + eventCents;
  const revenueCents = salesThisYear._sum.salePriceCents ?? 0;
  const perHead = costPerHeadCents(totalCostCents, stats.inFlock);
  const net = revenueCents - totalCostCents;
  const lambing = lambingSummary(lambings);
  const lambingThisYear = lambing.years.find((y) => y.year === year);

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Link
          href="/livestock"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Flock
        </Link>
        <Link
          href="/livestock/sales"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Sales
        </Link>
        <span className="rounded-xl bg-oak-700 px-3 py-2 text-center font-semibold text-white">
          Costs
        </span>
      </div>

      <PageHeader
        title={`What the flock costs · ${year}`}
        sub="Plain numbers on what the sheep are costing you and bringing in this year."
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Head in flock" value={String(stats.inFlock)} />
        <StatCard
          label="Cost per head"
          value={perHead != null ? formatCents(perHead) : "—"}
          sub={`so far in ${year}`}
        />
        <StatCard label={`Lambs born ${year}`} value={String(stats.lambsThisYear)} tone="green" />
        <StatCard
          label={`Sales ${year}`}
          value={formatCents(revenueCents)}
          tone="green"
          sub={`${salesThisYear._count} sold`}
        />
      </div>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">In plain words</h2>
        <div className="space-y-2 text-base text-stone-700">
          <p>
            You have <strong>{stats.inFlock}</strong>{" "}
            {stats.inFlock === 1 ? "animal" : "head"} in the flock right now —{" "}
            {stats.ewes} {stats.ewes === 1 ? "ewe" : "ewes"}, {stats.rams}{" "}
            {stats.rams === 1 ? "ram" : "rams"}
            {stats.wethers > 0 ? `, and ${stats.wethers} wethers` : ""}.
          </p>
          <p>
            Farm expenses so far in {year} come to{" "}
            <strong>{formatCents(pinnedCents + unpinnedCents)}</strong>.{" "}
            {formatCents(pinnedCents)} of that is pinned to a particular animal
            {pinned._count > 0 ? ` (${pinned._count} expenses)` : ""}, and{" "}
            {formatCents(unpinnedCents)} is general farm spending that isn&apos;t tied to anybody
            {unpinned._count > 0 ? ` (${unpinned._count} expenses)` : ""}.
          </p>
          <p>
            Treatments, shearing, and vet visits logged on animals this year add{" "}
            <strong>{formatCents(eventCents)}</strong> on top of that.
          </p>
          <p>
            {perHead != null ? (
              <>
                All together that is <strong>{formatCents(totalCostCents)}</strong> for the year —
                about <strong>{formatCents(perHead)}</strong> a head.
              </>
            ) : (
              <>
                All together that is <strong>{formatCents(totalCostCents)}</strong> for the year.
                Add an animal to the flock and this turns into a cost per head.
              </>
            )}
          </p>
          <p>
            <strong>{stats.lambsThisYear}</strong> {stats.lambsThisYear === 1 ? "lamb" : "lambs"}{" "}
            {stats.lambsThisYear === 1 ? "was" : "were"} born this year.
            {lambingThisYear
              ? ` Your lambing log shows ${lambingThisYear.lambs} lambs from ${lambingThisYear.lambings} ${
                  lambingThisYear.lambings === 1 ? "lambing" : "lambings"
                } — about ${formatLitter(lambingThisYear.averageLitter)} per ewe.`
              : " Nothing is logged in the lambing book for this year yet."}
          </p>
          <p>
            Livestock sales brought in <strong>{formatCents(revenueCents)}</strong> from{" "}
            {salesThisYear._count} {salesThisYear._count === 1 ? "sale" : "sales"} this year.
          </p>
          <p className="rounded-xl bg-stone-50 p-3 font-medium text-stone-900">
            {net >= 0
              ? `For ${year} the sheep are ahead by ${formatCents(net)} — that is sales minus everything above.`
              : `For ${year} the sheep are ${formatCents(Math.abs(net))} in the hole — that is sales minus everything above. Lambs still on the ground are not money yet.`}
          </p>
        </div>
      </Card>

      {lambing.years.length > 0 ? (
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold text-stone-900">Lambing, year by year</h2>
          <div className="divide-y divide-stone-100">
            {lambing.years.map((y) => (
              <div key={y.year} className="flex items-center justify-between py-2.5">
                <span className="font-medium text-stone-900">{y.year}</span>
                <span className="text-sm text-stone-600">
                  {y.lambs} {y.lambs === 1 ? "lamb" : "lambs"} from {y.lambings}{" "}
                  {y.lambings === 1 ? "lambing" : "lambings"} · {formatLitter(y.averageLitter)} per
                  ewe
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-stone-500">
            All time: {lambing.totalLambs} lambs from {lambing.totalLambings} lambings — average{" "}
            {formatLitter(lambing.averageLitter)} per ewe.
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 font-semibold text-stone-900">Getting the numbers sharper</h2>
        <p className="text-sm text-stone-600">
          The more feed, hay, and vet bills you pin to a particular animal, the closer cost-per-head
          gets to the truth. Everything not pinned still counts here as general flock spending — it
          just can&apos;t be traced to one ewe.
        </p>
      </Card>
    </div>
  );
}
