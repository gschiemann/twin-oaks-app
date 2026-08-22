import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { startOfYear } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { partRollup, printerRollup, summarizeJobs } from "@/lib/manufacturing";
import { Card, Chip, EmptyState, PageHeader, StatCard, btnSecondaryCls } from "@/components/ui";

export const dynamic = "force-dynamic";

const chipCls = (active: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium ${
    active ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"
  }`;

function moneyCls(cents: number): string {
  return cents < 0 ? "font-semibold text-red-700" : "font-semibold text-oak-700";
}

export default async function JobsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const accountId = await requireAccountId();
  const { range: rangeParam } = await searchParams;
  const range = rangeParam === "all" ? "all" : "year";
  const yearStart = startOfYear();
  const thisYear = new Date().getFullYear();

  // Cancelled jobs never count — they didn't happen. A job belongs to the
  // period it was finished in, or the day it was written down if it isn't
  // finished yet.
  const [jobs, assets] = await Promise.all([
    prisma.printJob.findMany({
      where: {
        accountId,
        status: { not: "CANCELLED" },
        ...(range === "year"
          ? {
              OR: [
                { completedAt: { gte: yearStart } },
                { completedAt: null, createdAt: { gte: yearStart } },
              ],
            }
          : {}),
      },
      include: {
        filamentUses: {
          include: { spool: { select: { purchasePriceCents: true, totalGrams: true } } },
        },
      },
    }),
    prisma.asset.findMany({ where: { accountId }, select: { id: true, name: true } }),
  ]);

  const uses = jobs.flatMap((j) => j.filamentUses);
  const total = summarizeJobs(jobs, uses);
  const printers = printerRollup(jobs, uses);
  const parts = partRollup(jobs, uses);
  const assetNames = new Map(assets.map((a) => [a.id, a.name]));

  const best = parts.slice(0, 5);
  const losing = parts.filter((p) => p.profitCents < 0).reverse();

  return (
    <div>
      <PageHeader
        title="Production report"
        sub="Where your printer time and your filament actually go."
        action={
          <Link href="/jobs" className={btnSecondaryCls}>
            Back
          </Link>
        }
      />

      <div className="mb-4 flex gap-2">
        <Link href="/jobs/report" className={chipCls(range === "year")}>
          {thisYear}
        </Link>
        <Link href="/jobs/report?range=all" className={chipCls(range === "all")}>
          All time
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title={range === "year" ? `No print jobs in ${thisYear} yet.` : "No print jobs yet."}
          hint="Once you've recorded a job or two, this page tells you which printer and which part actually earn their keep."
          actionHref="/jobs/new"
          actionLabel="Add a print job"
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Jobs finished"
              value={String(total.jobsCompleted)}
              sub={`${total.jobs} in total`}
            />
            <StatCard label="Printer hours" value={`${total.printHours}`} />
            <StatCard label="Money in" value={formatCents(total.revenueCents)} />
            <StatCard
              label="Profit"
              value={formatCents(total.profitCents)}
              tone={total.profitCents < 0 ? "red" : "green"}
            />
          </div>

          <Card className="mb-4">
            <h2 className="mb-1 font-semibold text-stone-900">The short version</h2>
            <p className="text-base leading-relaxed text-stone-700">
              {range === "year" ? `So far in ${thisYear} you` : "All told you"} ran{" "}
              <strong>{total.jobs}</strong> print {total.jobs === 1 ? "job" : "jobs"} and made{" "}
              <strong>{total.parts}</strong> good {total.parts === 1 ? "part" : "parts"} — about{" "}
              <strong>{total.printHours}</strong> hours on the printers and{" "}
              <strong>{total.gramsUsed} g</strong> of filament. Customers paid{" "}
              <strong>{formatCents(total.revenueCents)}</strong>, the work cost{" "}
              <strong>{formatCents(total.costCents)}</strong>, so you kept{" "}
              <span className={moneyCls(total.profitCents)}>{formatCents(total.profitCents)}</span>
              {total.parts > 0 ? (
                <>
                  {" "}
                  — <strong>{formatCents(total.profitPerPartCents)}</strong> per part on average
                </>
              ) : null}
              .
            </p>
            {total.failedParts > 0 ? (
              <p className="mt-2 text-base leading-relaxed text-stone-700">
                <strong>{total.failedParts}</strong>{" "}
                {total.failedParts === 1 ? "print" : "prints"} failed along the way, which is about{" "}
                <span className="font-semibold text-red-700">
                  {formatCents(total.failedCostCents)}
                </span>{" "}
                of filament and machine time that produced nothing you could sell.
              </p>
            ) : (
              <p className="mt-2 text-base leading-relaxed text-stone-700">
                No failed prints recorded — nothing wasted.
              </p>
            )}
          </Card>

          <Card className="mb-4">
            <h2 className="mb-1 font-semibold text-stone-900">Printer by printer</h2>
            <p className="mb-3 text-sm text-stone-500">Best earner first.</p>
            <div className="divide-y divide-stone-100">
              {printers.map((p) => {
                const name = p.printerAssetId
                  ? (assetNames.get(p.printerAssetId) ?? "Printer no longer on file")
                  : "No printer recorded";
                return (
                  <div key={p.printerAssetId ?? "none"} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-900">{name}</div>
                        <p className="mt-0.5 text-sm leading-relaxed text-stone-600">
                          {p.jobsCompleted} of {p.jobs} {p.jobs === 1 ? "job" : "jobs"} finished ·{" "}
                          {p.printHours} printer {p.printHours === 1 ? "hour" : "hours"} ·{" "}
                          {formatCents(p.revenueCents)} in, {formatCents(p.costCents)} of cost
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`tabular-nums ${moneyCls(p.profitCents)}`}>
                          {formatCents(p.profitCents)}
                        </div>
                        <div className="text-xs text-stone-500">profit</div>
                      </div>
                    </div>
                    {p.printerAssetId ? (
                      <Link
                        href={`/assets/${p.printerAssetId}`}
                        className="mt-1 inline-block text-sm font-medium text-oak-700"
                      >
                        See this machine
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="mb-4">
            <h2 className="mb-1 font-semibold text-stone-900">Parts worth printing</h2>
            <p className="mb-3 text-sm text-stone-500">
              Your best earners, most profitable first.
            </p>
            <div className="divide-y divide-stone-100">
              {best.map((p) => (
                <div key={p.partName} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-stone-900">{p.partName}</div>
                    <div className="text-sm text-stone-500">
                      {p.jobs} {p.jobs === 1 ? "job" : "jobs"} · {p.parts}{" "}
                      {p.parts === 1 ? "part" : "parts"} ·{" "}
                      {p.parts > 0 ? `${formatCents(p.profitPerPartCents)} each` : "no parts yet"}
                    </div>
                  </div>
                  <div className={`shrink-0 tabular-nums ${moneyCls(p.profitCents)}`}>
                    {formatCents(p.profitCents)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-stone-900">Parts losing you money</h2>
            {losing.length === 0 ? (
              <p className="text-base text-stone-700">
                Nothing is losing money{total.revenueCents === 0 ? " yet" : ""}. Every part you
                priced came out ahead.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-stone-500">
                  Worst first — raise the price, cut the print time, or stop printing these.
                </p>
                <div className="divide-y divide-stone-100">
                  {losing.map((p) => (
                    <div key={p.partName} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-stone-900">{p.partName}</div>
                        <div className="text-sm text-stone-500">
                          {formatCents(p.revenueCents)} in, {formatCents(p.costCents)} of cost
                          {p.revenueCents === 0 ? (
                            <>
                              {" "}
                              <Chip tone="amber">no price set</Chip>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 tabular-nums font-semibold text-red-700">
                        {formatCents(p.profitCents)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
