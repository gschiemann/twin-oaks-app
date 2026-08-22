import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  ANIMAL_EVENT_LABELS,
  ANIMAL_SEX_LABELS,
  ANIMAL_STATUS_LABELS,
  BIRTH_TYPE_LABELS,
  PREGNANCY_RESULT_LABELS,
  type AnimalEventKind,
  type AnimalSex,
  type AnimalStatus,
  type BirthType,
} from "@/lib/domain";
import {
  activeWithdrawal,
  ageLabel,
  animalCostBreakdown,
  animalLabel,
  compareTags,
  saleProfitCents,
  sexShortLabel,
  sumCents,
} from "@/lib/livestock";
import {
  Card,
  Chip,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnSecondaryCls,
} from "@/components/ui";
import { addAnimalEvent, deleteAnimalEvent } from "../actions";
import { Row, animalStatusTone, eventErrorMessage } from "../livestock-bits";
import EventForm from "../EventForm";
import DocumentsCard from "@/components/DocumentsCard";

export const dynamic = "force-dynamic";

export default async function AnimalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const now = new Date();

  const [animal, flock, sale] = await Promise.all([
    prisma.animal.findFirst({
      where: { id, accountId },
      include: {
        events: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
        expenses: { orderBy: { date: "desc" } },
      },
    }),
    // The whole flock, once: parents, offspring, and the ram list for a
    // breeding all come out of it without four more round trips.
    prisma.animal.findMany({
      where: { accountId },
      select: { id: true, tagNumber: true, name: true, sex: true, sireId: true, damId: true },
    }),
    prisma.livestockSale.findFirst({
      where: { accountId, animalId: id },
      orderBy: { date: "desc" },
    }),
  ]);
  if (!animal) notFound();

  const buyer = sale?.customerId
    ? await prisma.customer.findFirst({
        where: { id: sale.customerId, accountId },
        select: { id: true, name: true },
      })
    : null;

  const byId = new Map(flock.map((a) => [a.id, a]));
  const sire = animal.sireId ? (byId.get(animal.sireId) ?? null) : null;
  const dam = animal.damId ? (byId.get(animal.damId) ?? null) : null;
  const offspring = flock
    .filter((a) => a.sireId === animal.id || a.damId === animal.id)
    .sort((a, b) => compareTags(a.tagNumber, b.tagNumber));
  const rams = flock
    .filter((a) => a.sex === "RAM" && a.id !== animal.id)
    .sort((a, b) => compareTags(a.tagNumber, b.tagNumber));

  const withdrawal = activeWithdrawal(animal.events, now);

  const cost = animalCostBreakdown({
    acquisitionCostCents: animal.acquisitionCostCents,
    expenseCents: sumCents(animal.expenses.map((e) => e.amountCents)),
    eventCostCents: sumCents(animal.events.map((e) => e.costCents)),
  });
  const profit = sale ? saleProfitCents(sale.salePriceCents, cost.totalCents) : null;

  return (
    <div>
      {withdrawal ? (
        <div
          role="alert"
          className="mb-4 rounded-2xl border-4 border-amber-500 bg-amber-50 p-4 shadow-sm"
        >
          <p className="display-serif text-xl font-bold text-amber-900">
            Do not sell for meat until {formatDate(withdrawal.until)}
          </p>
          <p className="mt-1 text-base text-amber-900">
            {withdrawal.productName
              ? `${withdrawal.productName} is still in withdrawal.`
              : "A treatment is still in withdrawal."}{" "}
            Selling this animal for meat before that date is against the law.
          </p>
        </div>
      ) : null}

      <PageHeader
        title={animalLabel(animal)}
        sub={[
          ANIMAL_SEX_LABELS[animal.sex as AnimalSex] ?? animal.sex,
          animal.breed,
          animal.species !== "Sheep" ? animal.species : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link href={`/livestock/${animal.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      {saved === "event" ? (
        <SavedBanner
          title="Added to this animal's record."
          hint="It's at the top of the history below."
        />
      ) : null}
      {error ? <FormError>{eventErrorMessage(error)}</FormError> : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={animalStatusTone(animal.status)}>
          {ANIMAL_STATUS_LABELS[animal.status as AnimalStatus] ?? animal.status}
        </Chip>
        <Chip>Tag #{animal.tagNumber}</Chip>
        {animal.birthType ? (
          <Chip>{BIRTH_TYPE_LABELS[animal.birthType as BirthType] ?? animal.birthType}</Chip>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Age"
          value={ageLabel(animal.birthDate, now)}
          sub={animal.birthDate ? `born ${formatDate(animal.birthDate)}` : "no birth date yet"}
        />
        <StatCard
          label="Weight"
          value={animal.currentWeightLbs != null ? `${animal.currentWeightLbs} lbs` : "—"}
          sub="last weigh-in"
        />
        <StatCard label="Cost so far" value={formatCents(cost.totalCents)} />
        {sale ? (
          <StatCard
            label={profit != null && profit < 0 ? "Lost on this one" : "Made on this one"}
            value={formatCents(Math.abs(profit ?? 0))}
            tone={profit != null && profit < 0 ? "red" : "green"}
            sub={`sold ${formatDate(sale.date)}`}
          />
        ) : (
          <StatCard label="Lambs" value={String(offspring.length)} sub="on the books" />
        )}
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Profile</h2>
        <Row label="Tag number" value={`#${animal.tagNumber}`} />
        <Row label="Name" value={animal.name} />
        <Row label="Sex" value={sexShortLabel(animal.sex)} />
        <Row label="Breed" value={animal.breed} />
        <Row label="Kind" value={animal.species} />
        <Row label="Born" value={animal.birthDate ? formatDate(animal.birthDate) : null} />
        <Row
          label="Born as"
          value={
            animal.birthType
              ? (BIRTH_TYPE_LABELS[animal.birthType as BirthType] ?? animal.birthType)
              : null
          }
        />
        <Row
          label="Bought on"
          value={animal.acquisitionDate ? formatDate(animal.acquisitionDate) : null}
        />
        <Row
          label="What you paid"
          value={
            animal.acquisitionCostCents != null ? formatCents(animal.acquisitionCostCents) : null
          }
        />
        <Row label="Notes" value={animal.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Family</h2>
        <Row
          label="Sire (father)"
          value={
            sire ? (
              <Link href={`/livestock/${sire.id}`} className="text-oak-700 underline">
                {animalLabel(sire)}
              </Link>
            ) : (
              "Unknown"
            )
          }
        />
        <Row
          label="Dam (mother)"
          value={
            dam ? (
              <Link href={`/livestock/${dam.id}`} className="text-oak-700 underline">
                {animalLabel(dam)}
              </Link>
            ) : (
              "Unknown"
            )
          }
        />
        <div className="pt-2">
          <p className="text-sm text-stone-500">
            {offspring.length === 0
              ? "No lambs out of this one yet. Add a lamb and set this animal as its sire or dam."
              : `${offspring.length} ${offspring.length === 1 ? "lamb" : "lambs"} out of this one:`}
          </p>
          {offspring.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {offspring.map((o) => (
                <Link
                  key={o.id}
                  href={`/livestock/${o.id}`}
                  className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700"
                >
                  {animalLabel(o)}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">What this animal has cost</h2>
        <Row
          label="Bought for"
          value={cost.acquisitionCents > 0 ? formatCents(cost.acquisitionCents) : null}
        />
        <Row
          label={`Expenses pinned to it (${animal.expenses.length})`}
          value={formatCents(cost.expenseCents)}
        />
        <Row label="Treatments, shearing, vet" value={formatCents(cost.eventCents)} />
        <Row label="Total cost so far" value={formatCents(cost.totalCents)} />
        {sale ? (
          <>
            <Row label="Sold for" value={formatCents(sale.salePriceCents)} />
            <Row
              label="Sold to"
              value={buyer?.name ?? sale.buyerName ?? "—"}
            />
          </>
        ) : null}
        <p className="mt-3 text-sm text-stone-600">
          {sale && profit != null
            ? profit >= 0
              ? `You made ${formatCents(profit)} on this one — it sold for ${formatCents(sale.salePriceCents)} and cost ${formatCents(cost.totalCents)} to get there.`
              : `This one came up ${formatCents(Math.abs(profit))} short — it sold for ${formatCents(sale.salePriceCents)} but cost ${formatCents(cost.totalCents)}.`
            : `So far this animal has cost ${formatCents(cost.totalCents)}. Sell it from the Sales page and the profit works itself out.`}
        </p>
        {animal.expenses.length > 0 ? (
          <div className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
            {animal.expenses.map((e) => (
              <Link key={e.id} href={`/expenses/${e.id}`} className="flex justify-between py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">
                    {e.description}
                  </span>
                  <span className="text-sm text-stone-500">{formatDate(e.date)}</span>
                </span>
                <span className="font-semibold tabular-nums text-stone-900">
                  {formatCents(e.amountCents)}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Log what happened</h2>
        <p className="mb-3 text-sm text-stone-500">
          Pick what happened and only the questions that matter will show up.
        </p>
        <EventForm
          action={addAnimalEvent}
          animalId={animal.id}
          rams={rams}
          today={toDateInputValue(now)}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-stone-900">History ({animal.events.length})</h2>
        {animal.events.length === 0 ? (
          <p className="text-sm text-stone-500">
            Nothing logged yet — every weigh-in, worming, and lambing belongs here.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {animal.events.map((e) => {
              const mate = e.mateAnimalId ? byId.get(e.mateAnimalId) : null;
              const details = [
                e.weightLbs != null ? `${e.weightLbs} lbs` : null,
                e.lambCount != null ? `${e.lambCount} ${e.lambCount === 1 ? "lamb" : "lambs"}` : null,
                mate ? `bred to ${animalLabel(mate)}` : null,
                e.dueDate ? `due ${formatDate(e.dueDate)}` : null,
                e.result ? (PREGNANCY_RESULT_LABELS[e.result] ?? e.result) : null,
                e.productName,
                e.dosage,
              ].filter(Boolean) as string[];
              return (
                <div key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium text-stone-900">
                      {ANIMAL_EVENT_LABELS[e.kind as AnimalEventKind] ?? e.kind}
                      {details.length > 0 ? (
                        <span className="font-normal text-stone-600"> — {details.join(" · ")}</span>
                      ) : null}
                    </div>
                    <div className="text-sm text-stone-500">{formatDate(e.date)}</div>
                    {e.description ? (
                      <div className="text-sm text-stone-600">{e.description}</div>
                    ) : null}
                    {e.withdrawalUntil ? (
                      <div
                        className={`mt-1 text-sm font-semibold ${
                          e.withdrawalUntil > now ? "text-amber-800" : "text-stone-500"
                        }`}
                      >
                        {e.withdrawalUntil > now
                          ? `Do not sell for meat until ${formatDate(e.withdrawalUntil)}`
                          : `Withdrawal ended ${formatDate(e.withdrawalUntil)}`}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {e.costCents != null ? (
                      <span className="font-semibold tabular-nums text-stone-900">
                        {formatCents(e.costCents)}
                      </span>
                    ) : null}
                    <form action={deleteAnimalEvent}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="animalId" value={animal.id} />
                      <button type="submit" className="text-xs text-red-500">
                        remove
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <DocumentsCard ownerType="ANIMAL" ownerId={animal.id} title="Photos & papers" />
    </div>
  );
}
