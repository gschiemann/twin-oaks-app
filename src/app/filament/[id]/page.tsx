import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  Card,
  Chip,
  PageHeader,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  LOW_GRAMS,
  RemainingBar,
  centsPerGramShort,
  formatGrams,
  isRunningLow,
  pricePerGramLabel,
  remainingPct,
  spoolName,
  statusLabel,
  statusTone,
  valueRemainingCents,
} from "../spool-bits";
import { deleteSpool, logSpoolUsage, setSpoolStatus } from "../actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

export default async function SpoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;

  const spool = await prisma.filamentSpool.findFirst({ where: { id, accountId } });
  if (!spool) notFound();

  // The jobs module owns print jobs — this reads the shared FilamentUse rows
  // and links out by URL only.
  const [uses, printer] = await Promise.all([
    prisma.filamentUse.findMany({
      where: { spoolId: spool.id, accountId },
      orderBy: { createdAt: "desc" },
      include: { printJob: { select: { id: true, jobNumber: true, partName: true } } },
    }),
    spool.printerAssetId
      ? prisma.asset.findFirst({
          where: { id: spool.printerAssetId, accountId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const low = isRunningLow(spool);
  const pct = Math.round(remainingPct(spool));
  const value = valueRemainingCents(spool);
  const usedSoFar = Math.max(0, spool.totalGrams - spool.remainingGrams);
  const jobGrams = uses.reduce((sum, u) => sum + u.grams, 0);
  const jobWaste = uses.reduce((sum, u) => sum + u.wasteGrams, 0);
  // The spool carries its own running waste total; jobs also record waste per
  // use. Take the larger of the two so waste is never double-counted no
  // matter which side wrote it.
  const totalWaste = Math.max(spool.wasteGrams, jobWaste);

  return (
    <div>
      <PageHeader
        title={spoolName(spool)}
        sub={[spool.manufacturer, spool.spoolTag].filter(Boolean).join(" · ") || undefined}
        action={
          <Link href={`/filament/${spool.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      {error === "has-jobs" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          This spool was used on print jobs, so it cannot be deleted — those jobs would lose what
          their filament cost. Mark it Retired instead.
        </Card>
      ) : null}
      {error === "usage" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          Type how many grams came off the spool, then tap Subtract from this spool again.
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={statusTone(spool.status)}>{statusLabel(spool.status)}</Chip>
        {spool.spoolTag ? <Chip>{spool.spoolTag}</Chip> : null}
        {low ? <Chip tone="red">Running low</Chip> : null}
      </div>

      <Card className="mb-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Filament left
            </div>
            <div
              className={`text-4xl font-bold tabular-nums ${low ? "text-red-700" : "text-stone-900"}`}
            >
              {formatGrams(spool.remainingGrams)}
            </div>
            <div className="text-sm text-stone-500">
              of a {formatGrams(spool.totalGrams)} spool · {pct}% left
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Worth</div>
            <div className="text-2xl font-bold tabular-nums text-oak-700">
              {value != null ? formatCents(value) : "—"}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <RemainingBar spool={spool} tall />
        </div>
        {low ? (
          <p className="mt-2 text-sm font-semibold text-red-700">
            Running low — under {LOW_GRAMS} g left. Time to order another one.
          </p>
        ) : null}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Price per gram"
          value={centsPerGramShort(spool)}
          sub={
            spool.purchasePriceCents != null
              ? `${formatCents(spool.purchasePriceCents)} a spool`
              : "add what it cost"
          }
        />
        <StatCard
          label="Value left"
          value={value != null ? formatCents(value) : "—"}
          tone="green"
        />
        <StatCard
          label="Used so far"
          value={formatGrams(usedSoFar)}
          sub={`${formatGrams(jobGrams)} on jobs`}
        />
        <StatCard label="Waste" value={formatGrams(totalWaste)} />
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Log usage</h2>
        <p className="mb-3 text-sm text-stone-500">
          For filament used outside a print job — purging, a test piece, a failed print. Job
          filament is recorded on the job itself.
        </p>
        <form action={logSpoolUsage} className="space-y-3">
          <input type="hidden" name="id" value={spool.id} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="u-grams">
                Grams used *
              </label>
              <input
                id="u-grams"
                name="grams"
                inputMode="decimal"
                required
                placeholder="25"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="u-waste">
                Wasted grams
              </label>
              <input
                id="u-waste"
                name="wasteGrams"
                inputMode="decimal"
                placeholder="0"
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-stone-500">
            Both come off the spool. It stops at 0 g and flips to Empty on its own.
          </p>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Subtract from this spool
          </button>
        </form>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-stone-100 pt-4">
          <form action={setSpoolStatus}>
            <input type="hidden" name="id" value={spool.id} />
            <input type="hidden" name="status" value="EMPTY" />
            <button type="submit" className={`${btnSecondaryCls} w-full`}>
              Mark empty
            </button>
          </form>
          <form action={setSpoolStatus}>
            <input type="hidden" name="id" value={spool.id} />
            <input type="hidden" name="status" value="RETIRED" />
            <button type="submit" className={`${btnSecondaryCls} w-full`}>
              Mark retired
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Mark empty sets what is left to 0 g. Retired keeps the leftover but takes the spool out of
          your on-hand totals.
        </p>
        {spool.status === "EMPTY" || spool.status === "RETIRED" ? (
          <form action={setSpoolStatus} className="mt-2">
            <input type="hidden" name="id" value={spool.id} />
            <input type="hidden" name="status" value="IN_STOCK" />
            <button type="submit" className={`${btnSecondaryCls} w-full`}>
              Put back in stock
            </button>
          </form>
        ) : null}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Spool details</h2>
        <Row label="Material" value={spool.material} />
        <Row label="Color" value={spool.colorName} />
        <Row label="Brand" value={spool.manufacturer} />
        <Row label="Your label" value={spool.spoolTag} />
        <Row label="Full spool" value={formatGrams(spool.totalGrams)} />
        <Row label="Price per gram" value={pricePerGramLabel(spool)} />
        <Row
          label="Purchased"
          value={spool.purchaseDate ? formatDate(spool.purchaseDate) : null}
        />
        <Row
          label="What it cost"
          value={spool.purchasePriceCents != null ? formatCents(spool.purchasePriceCents) : null}
        />
        <Row
          label="Printer"
          value={
            printer ? (
              <Link href={`/assets/${printer.id}`} className="text-oak-700 underline">
                {printer.name}
              </Link>
            ) : null
          }
        />
        <Row label="Notes" value={spool.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Jobs printed with this spool ({uses.length})</h2>
        {uses.length === 0 ? (
          <p className="text-sm text-stone-500">
            No print jobs have used this spool yet. Filament gets pinned to a spool when you record
            it on a job.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {uses.map((u) => (
              <Link
                key={u.id}
                href={`/jobs/${u.printJobId}`}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">
                    {u.printJob.jobNumber} · {u.printJob.partName}
                  </span>
                  {u.wasteGrams > 0 ? (
                    <span className="text-sm text-stone-500">
                      {formatGrams(u.wasteGrams)} wasted
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                  {formatGrams(u.grams)}
                </span>
              </Link>
            ))}
          </div>
        )}
        {uses.length > 0 ? (
          <p className="mt-2 border-t border-stone-100 pt-2 text-sm text-stone-600">
            {formatGrams(jobGrams)} used on jobs · {formatGrams(totalWaste)} wasted in total.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold text-stone-900">Delete this spool</h2>
        {uses.length > 0 ? (
          <p className="text-sm text-stone-600">
            This spool is on {uses.length} print {uses.length === 1 ? "job" : "jobs"}, so it cannot
            be deleted — those jobs would lose what their filament cost. Mark it Retired instead.
          </p>
        ) : (
          <form action={deleteSpool}>
            <input type="hidden" name="id" value={spool.id} />
            <p className="mb-3 text-sm text-stone-600">
              Nothing has been printed from this spool, so it can be removed.
            </p>
            <button type="submit" className="text-sm font-medium text-red-600">
              Delete spool
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
