import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { FILAMENT_MATERIALS, SPOOL_STATUSES, SPOOL_STATUS_LABELS } from "@/lib/domain";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
} from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";
import {
  LOW_GRAMS,
  RemainingBar,
  formatGrams,
  isOnHand,
  isRunningLow,
  pricePerGramLabel,
  spoolName,
  statusLabel,
  statusTone,
  valueRemainingCents,
} from "./spool-bits";

export const dynamic = "force-dynamic";

// Status order the owner thinks in: what is loaded, what is on the shelf,
// then the dead ones.
const STATUS_RANK: Record<string, number> = { IN_USE: 0, IN_STOCK: 1, EMPTY: 2, RETIRED: 3 };

function filterHref(next: { status?: string; material?: string; low?: string }): string {
  const q = new URLSearchParams();
  if (next.status) q.set("status", next.status);
  if (next.material) q.set("material", next.material);
  if (next.low) q.set("low", next.low);
  const s = q.toString();
  return s ? `/filament?${s}` : "/filament";
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-oak-700 px-3.5 py-2 text-sm font-semibold text-white"
          : "rounded-full border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 active:bg-stone-100"
      }
    >
      {children}
    </Link>
  );
}

export default async function FilamentPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; status?: string; material?: string; low?: string }>;
}) {
  const accountId = await requireAccountId();
  const { saved, status: statusParam, material: materialParam, low: lowParam } = await searchParams;

  const status =
    statusParam && (SPOOL_STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : null;
  const material =
    materialParam && (FILAMENT_MATERIALS as readonly string[]).includes(materialParam)
      ? materialParam
      : null;
  const onlyLow = lowParam === "1";

  // Small list (dozens of spools) — one query, then filter in memory so the
  // header totals always describe ALL filament, not the current filter.
  const spools = await prisma.filamentSpool.findMany({
    where: { accountId },
    orderBy: [{ material: "asc" }, { colorName: "asc" }],
  });
  spools.sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.material.localeCompare(b.material) ||
      (a.colorName ?? "").localeCompare(b.colorName ?? ""),
  );

  const onHand = spools.filter((s) => isOnHand(s.status));
  const gramsOnHand = onHand.reduce((sum, s) => sum + s.remainingGrams, 0);
  const valueOnHand = onHand.reduce((sum, s) => sum + (valueRemainingCents(s) ?? 0), 0);
  const lowSpools = spools.filter(isRunningLow);

  const shown = spools.filter(
    (s) =>
      (status == null || s.status === status) &&
      (material == null || s.material === material) &&
      (!onlyLow || isRunningLow(s)),
  );

  // Only offer material filters for materials he actually owns.
  const ownedMaterials = FILAMENT_MATERIALS.filter((m) => spools.some((s) => s.material === m));
  const filtered = status != null || material != null || onlyLow;

  return (
    <div>
      <PageHeader
        title="Filament"
        sub="Every spool, what is left on it, and what it is worth."
        action={
          <Link href="/filament/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Spool saved."
          hint="Tap it below to log what you used or mark it empty."
          actionHref="/filament/new"
          actionLabel="Add another spool"
        />
      ) : null}

      {spools.length === 0 ? (
        <EmptyState
          title="No spools yet."
          hint="Add a spool and the app tracks what is left on it, what a gram costs, and what your filament shelf is worth."
          actionHref="/filament/new"
          actionLabel="Add a spool"
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Spools on hand"
              value={String(onHand.length)}
              sub={`${spools.length} total`}
            />
            <StatCard label="Grams on hand" value={formatGrams(gramsOnHand)} />
            <StatCard label="Value on hand" value={formatCents(valueOnHand)} tone="green" />
            {lowSpools.length > 0 ? (
              <Link href={filterHref({ low: "1" })} className="block rounded-2xl ring-2 ring-red-400">
                <StatCard
                  label="Running low"
                  value={String(lowSpools.length)}
                  sub={`under ${LOW_GRAMS} g — tap to see them`}
                  tone="red"
                />
              </Link>
            ) : (
              <StatCard label="Running low" value="0" sub={`nothing under ${LOW_GRAMS} g`} />
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            <FilterPill href={filterHref({ material: material ?? undefined })} active={!status && !onlyLow}>
              All spools
            </FilterPill>
            {SPOOL_STATUSES.map((s) => (
              <FilterPill
                key={s}
                href={filterHref({ status: s, material: material ?? undefined })}
                active={status === s && !onlyLow}
              >
                {SPOOL_STATUS_LABELS[s]}
              </FilterPill>
            ))}
            <FilterPill href={filterHref({ material: material ?? undefined, low: "1" })} active={onlyLow}>
              Running low
            </FilterPill>
          </div>

          {ownedMaterials.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <FilterPill
                href={filterHref({ status: status ?? undefined, low: onlyLow ? "1" : undefined })}
                active={!material}
              >
                Every material
              </FilterPill>
              {ownedMaterials.map((m) => (
                <FilterPill
                  key={m}
                  href={filterHref({
                    status: status ?? undefined,
                    material: m,
                    low: onlyLow ? "1" : undefined,
                  })}
                  active={material === m}
                >
                  {m}
                </FilterPill>
              ))}
            </div>
          ) : (
            <div className="mb-4" />
          )}

          {shown.length === 0 ? (
            <Card className="text-center">
              <p className="font-medium text-stone-700">No spools match that.</p>
              <Link href="/filament" className="mt-3 inline-block font-medium text-oak-700">
                Show all spools
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered ? (
                <p className="px-1 text-sm text-stone-500">
                  Showing {shown.length} of {spools.length} spools.{" "}
                  <Link href="/filament" className="font-medium text-oak-700">
                    Show all
                  </Link>
                </p>
              ) : null}

              {shown.map((s) => {
                const low = isRunningLow(s);
                const value = valueRemainingCents(s);
                return (
                  <Link key={s.id} href={`/filament/${s.id}`} className="block">
                    <Card className="active:bg-stone-50">
                      <div className="flex items-start gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-oak-100 px-1 text-center text-[11px] font-bold uppercase leading-tight text-oak-800">
                          {s.material}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-semibold text-stone-900">
                              {spoolName(s)}
                            </span>
                            <span
                              className={`shrink-0 font-bold tabular-nums ${low ? "text-red-700" : "text-stone-900"}`}
                            >
                              {formatGrams(s.remainingGrams)}
                            </span>
                          </div>
                          <div className="truncate text-sm text-stone-500">
                            {[s.manufacturer, `${formatGrams(s.totalGrams)} spool`]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          <div className="mt-2">
                            <RemainingBar spool={s} />
                          </div>
                          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-stone-500">
                            <span>{pricePerGramLabel(s)}</span>
                            <span className="tabular-nums">
                              {value != null ? `${formatCents(value)} left` : "no price yet"}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>
                            {s.spoolTag ? <Chip>{s.spoolTag}</Chip> : null}
                            {low ? <Chip tone="red">Running low</Chip> : null}
                          </div>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 shrink-0 self-center text-stone-400" />
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
