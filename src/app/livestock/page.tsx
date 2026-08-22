import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { ANIMAL_STATUS_LABELS, type AnimalStatus } from "@/lib/domain";
import {
  ageLabel,
  compareTags,
  flockStats,
  matchesAnimalSearch,
  sexShortLabel,
} from "@/lib/livestock";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  inputCls,
} from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";
import { animalStatusTone } from "./livestock-bits";

export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { key: "ACTIVE", label: "In the flock" },
  { key: "SOLD", label: "Sold" },
  { key: "DECEASED", label: "Died" },
  { key: "ALL", label: "All" },
] as const;

export default async function LivestockPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; q?: string; status?: string }>;
}) {
  const accountId = await requireAccountId();
  const { saved, q, status = "ACTIVE" } = await searchParams;
  const now = new Date();

  const [animals, withdrawals] = await Promise.all([
    prisma.animal.findMany({ where: { accountId } }),
    // Any treatment whose withdrawal date hasn't passed — the one flag that
    // must be visible without opening the animal.
    prisma.animalEvent.findMany({
      where: { accountId, withdrawalUntil: { gt: now } },
      select: { animalId: true, withdrawalUntil: true, productName: true },
    }),
  ]);

  const stats = flockStats(animals, now);
  const withdrawalByAnimal = new Map<string, Date>();
  for (const w of withdrawals) {
    const seen = withdrawalByAnimal.get(w.animalId);
    if (w.withdrawalUntil && (!seen || w.withdrawalUntil > seen)) {
      withdrawalByAnimal.set(w.animalId, w.withdrawalUntil);
    }
  }

  const shown = animals
    .filter((a) => (status === "ALL" ? true : a.status === status))
    .filter((a) => matchesAnimalSearch(a, q))
    .sort((a, b) => compareTags(a.tagNumber, b.tagNumber));

  const tabHref = (key: string) =>
    `/livestock?status=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <span className="rounded-xl bg-oak-700 px-3 py-2 text-center font-semibold text-white">
          Flock
        </span>
        <Link
          href="/livestock/sales"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Sales
        </Link>
        <Link
          href="/livestock/report"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-medium text-stone-600"
        >
          Costs
        </Link>
      </div>

      <PageHeader
        title="The flock"
        sub="Every animal, its history, and what it has cost you."
        action={
          <Link href="/livestock/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Animal saved."
          hint="Tap its tag number below any time to weigh it, treat it, or log a lambing."
          actionHref="/livestock/new"
          actionLabel="Add another animal"
        />
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Head in flock" value={String(stats.inFlock)} />
        <StatCard label="Ewes" value={String(stats.ewes)} />
        <StatCard
          label="Rams"
          value={String(stats.rams)}
          sub={stats.wethers > 0 ? `plus ${stats.wethers} wethers` : undefined}
        />
        <StatCard
          label={`Lambs born ${now.getFullYear()}`}
          value={String(stats.lambsThisYear)}
          tone="green"
        />
      </div>

      <div className="mb-3">
        <form action="/livestock" method="GET">
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search a tag number or name"
            className={inputCls}
          />
        </form>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              status === t.key
                ? "bg-oak-700 text-white"
                : "border border-stone-300 bg-white text-stone-600"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {animals.length === 0 ? (
        <EmptyState
          title="No animals yet."
          hint="Add your first ewe or ram and you can start logging weights, treatments, and lambs."
          actionHref="/livestock/new"
          actionLabel="Add an animal"
        />
      ) : shown.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="font-medium text-stone-700">Nothing matches that.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {q ? `No animal with “${q}” in its tag number or name` : "No animals"} under “
            {STATUS_TABS.find((t) => t.key === status)?.label ?? status}”.
          </p>
          <Link href="/livestock?status=ALL" className={`${btnPrimaryCls} mt-4`}>
            Show every animal
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => {
            const withdrawalUntil = withdrawalByAnimal.get(a.id) ?? null;
            return (
              <Link key={a.id} href={`/livestock/${a.id}`} className="block">
                <Card className="flex items-center gap-3 active:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xl font-bold tracking-tight text-stone-900">
                        #{a.tagNumber}
                      </span>
                      {a.name ? (
                        <span className="truncate text-base text-stone-700">{a.name}</span>
                      ) : null}
                    </div>
                    <div className="truncate text-sm text-stone-500">
                      {[sexShortLabel(a.sex), a.breed, ageLabel(a.birthDate, now)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {a.status !== "ACTIVE" ? (
                        <Chip tone={animalStatusTone(a.status)}>
                          {ANIMAL_STATUS_LABELS[a.status as AnimalStatus] ?? a.status}
                        </Chip>
                      ) : null}
                      {withdrawalUntil ? (
                        <Chip tone="amber">Do not sell until {formatDate(withdrawalUntil)}</Chip>
                      ) : null}
                      {a.currentWeightLbs != null ? (
                        <Chip tone="stone">{a.currentWeightLbs} lbs</Chip>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {shown.length > 0 ? (
        <p className="mt-3 text-center text-xs text-stone-400">
          {shown.length} {shown.length === 1 ? "animal" : "animals"} shown
          {q ? ` for “${q}”` : ""} · tap one to open its record
        </p>
      ) : null}
    </div>
  );
}
