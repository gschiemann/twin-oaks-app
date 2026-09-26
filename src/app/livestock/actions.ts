"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import {
  ANIMAL_EVENT_KINDS,
  ANIMAL_SEXES,
  ANIMAL_SPECIES,
  ANIMAL_STATUSES,
  BIRTH_TYPES,
  PREGNANCY_RESULTS,
  type AnimalEventKind,
} from "@/lib/domain";
import { dueDateFrom, eventUsesField } from "@/lib/livestock";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// A parent has to be this account's animal AND the right sex — a ewe can't be
// a sire. Anything else is dropped rather than saved wrong.
async function verifiedParentId(
  accountId: string,
  id: string | null,
  sex: "RAM" | "EWE",
  selfId: string | null,
): Promise<string | null> {
  if (!id || id === selfId) return null;
  const parent = await prisma.animal.findFirst({
    where: { id, accountId, sex },
    select: { id: true },
  });
  return parent?.id ?? null;
}

type AnimalFormResult =
  | { ok: true; data: Awaited<ReturnType<typeof animalFields>> }
  | { ok: false; error: "tag" | "sex" };

async function animalFields(accountId: string, formData: FormData, selfId: string | null) {
  const species = str(formData.get("species"));
  const birthType = str(formData.get("birthType"));
  const status = str(formData.get("status"));
  const weight = num(formData.get("currentWeightLbs"));

  return {
    tagNumber: (str(formData.get("tagNumber")) ?? "") as string,
    name: str(formData.get("name")),
    species:
      species && (ANIMAL_SPECIES as readonly string[]).includes(species) ? species : "Sheep",
    breed: str(formData.get("breed")),
    sex: (str(formData.get("sex")) ?? "") as string,
    birthDate: parseDateInput(formData.get("birthDate")),
    birthType:
      birthType && (BIRTH_TYPES as readonly string[]).includes(birthType) ? birthType : null,
    sireId: await verifiedParentId(accountId, str(formData.get("sireId")), "RAM", selfId),
    damId: await verifiedParentId(accountId, str(formData.get("damId")), "EWE", selfId),
    status: status && (ANIMAL_STATUSES as readonly string[]).includes(status) ? status : "ACTIVE",
    acquisitionDate: parseDateInput(formData.get("acquisitionDate")),
    acquisitionCostCents: parseDollarsToCents(formData.get("acquisitionCost")),
    currentWeightLbs: weight,
    notes: str(formData.get("notes")),
  };
}

async function animalDataFromForm(
  accountId: string,
  formData: FormData,
  selfId: string | null,
): Promise<AnimalFormResult> {
  const tagNumber = str(formData.get("tagNumber"));
  if (!tagNumber) return { ok: false, error: "tag" };
  const sex = str(formData.get("sex"));
  if (!sex || !(ANIMAL_SEXES as readonly string[]).includes(sex)) return { ok: false, error: "sex" };
  return { ok: true, data: await animalFields(accountId, formData, selfId) };
}

// Tag numbers are unique per account. Catching the clash here is what turns a
// database crash into a sentence the owner can act on.
async function tagIsTaken(accountId: string, tagNumber: string, selfId: string | null) {
  const clash = await prisma.animal.findFirst({
    where: { accountId, tagNumber, ...(selfId ? { NOT: { id: selfId } } : {}) },
    select: { id: true },
  });
  return clash != null;
}

export async function createAnimal(formData: FormData) {
  const accountId = await requireAccountId();
  const parsed = await animalDataFromForm(accountId, formData, null);
  if (!parsed.ok) redirect(`/livestock/new?error=${parsed.error}`);
  if (await tagIsTaken(accountId, parsed.data.tagNumber, null)) {
    redirect("/livestock/new?error=duplicate");
  }

  // The unique index is the real referee — two saves at once can still race
  // past the check above, and that must read as "tag taken", not a 500.
  let saved = false;
  try {
    await prisma.animal.create({ data: { ...parsed.data, accountId } });
    saved = true;
  } catch {
    saved = false;
  }
  if (!saved) redirect("/livestock/new?error=duplicate");
  redirect("/livestock?saved=1");
}

export async function updateAnimal(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/livestock");
  const parsed = await animalDataFromForm(accountId, formData, id);
  if (!parsed.ok) redirect(`/livestock/${id}/edit?error=${parsed.error}`);
  if (await tagIsTaken(accountId, parsed.data.tagNumber, id)) {
    redirect(`/livestock/${id}/edit?error=duplicate`);
  }

  let saved = false;
  try {
    await prisma.animal.updateMany({ where: { id, accountId }, data: parsed.data });
    saved = true;
  } catch {
    saved = false;
  }
  if (!saved) redirect(`/livestock/${id}/edit?error=duplicate`);
  redirect("/livestock?saved=1");
}

export async function addAnimalEvent(formData: FormData) {
  const accountId = await requireAccountId();
  const animalId = str(formData.get("animalId"));
  if (!animalId) redirect("/livestock");
  // The animal must be this account's — a forged id is a no-op.
  const owned = await prisma.animal.findFirst({
    where: { id: animalId, accountId },
    select: { id: true },
  });
  if (!owned) redirect("/livestock");

  const kindRaw = str(formData.get("kind"));
  if (!kindRaw || !(ANIMAL_EVENT_KINDS as readonly string[]).includes(kindRaw)) {
    redirect(`/livestock/${animalId}?error=kind`);
  }
  const kind = kindRaw as AnimalEventKind;
  const date = parseDateInput(formData.get("date")) ?? new Date();

  // Only the fields this kind actually uses are read, so a weigh-in can never
  // carry a dosage or a withdrawal date it was never asked for.
  const uses = (field: string) => eventUsesField(kind, field);
  const weightLbs = uses("weightLbs") ? num(formData.get("weightLbs")) : null;
  const lambCountRaw = uses("lambCount") ? num(formData.get("lambCount")) : null;
  const resultRaw = uses("result") ? str(formData.get("result")) : null;

  let mateAnimalId: string | null = null;
  if (uses("mateAnimalId")) {
    const mate = str(formData.get("mateAnimalId"));
    if (mate) {
      const mateOwned = await prisma.animal.findFirst({
        where: { id: mate, accountId },
        select: { id: true },
      });
      mateAnimalId = mateOwned?.id ?? null;
    }
  }

  // A breeding always gets a due date: if none was typed, the ewe's own clock
  // supplies it (147 days).
  let dueDate = uses("dueDate") ? parseDateInput(formData.get("dueDate")) : null;
  if (kind === "BREEDING" && dueDate == null) dueDate = dueDateFrom(date);

  const event = await prisma.animalEvent.create({
    data: {
      accountId,
      animalId,
      date,
      kind,
      description: str(formData.get("description")),
      weightLbs,
      productName: uses("productName") ? str(formData.get("productName")) : null,
      dosage: uses("dosage") ? str(formData.get("dosage")) : null,
      withdrawalUntil: uses("withdrawalUntil")
        ? parseDateInput(formData.get("withdrawalUntil"))
        : null,
      mateAnimalId,
      dueDate,
      result:
        resultRaw && (PREGNANCY_RESULTS as readonly string[]).includes(resultRaw)
          ? resultRaw
          : null,
      lambCount: lambCountRaw != null ? Math.max(0, Math.trunc(lambCountRaw)) : null,
      costCents: uses("costCents") ? parseDollarsToCents(formData.get("cost")) : null,
      notes: str(formData.get("notes")),
    },
  });

  // A weigh-in becomes the animal's current weight — but only when it IS the
  // newest one. Back-filling last spring's weight must not rewrite today's.
  if (kind === "WEIGHT" && weightLbs != null) {
    const newest = await prisma.animalEvent.findFirst({
      where: { accountId, animalId, kind: "WEIGHT", weightLbs: { not: null } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (newest?.id === event.id) {
      await prisma.animal.updateMany({
        where: { id: animalId, accountId },
        data: { currentWeightLbs: weightLbs },
      });
    }
  }

  // Logging a death is how an animal leaves the flock — no second step.
  if (kind === "DEATH") {
    await prisma.animal.updateMany({
      where: { id: animalId, accountId },
      data: { status: "DECEASED" },
    });
  }

  redirect(`/livestock/${animalId}?saved=event`);
}

export async function deleteAnimalEvent(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  const animalId = str(formData.get("animalId"));
  if (id) await prisma.animalEvent.deleteMany({ where: { id, accountId } });
  redirect(animalId ? `/livestock/${animalId}` : "/livestock");
}

// A sale is money, so it posts itself to the books: one Income row, farm
// division, "Livestock sales" — exactly the way a payment on an invoice does.
export async function createLivestockSale(formData: FormData) {
  const accountId = await requireAccountId();

  const salePriceCents = parseDollarsToCents(formData.get("salePrice"));
  if (salePriceCents == null || salePriceCents <= 0) redirect("/livestock/sales/new?error=price");

  const animalId = str(formData.get("animalId"));
  let animal: { id: string; tagNumber: string; name: string | null } | null = null;
  if (animalId) {
    animal = await prisma.animal.findFirst({
      where: { id: animalId, accountId },
      select: { id: true, tagNumber: true, name: true },
    });
    if (!animal) redirect("/livestock/sales/new?error=animal");
  }

  const customerId = str(formData.get("customerId"));
  let customer: { id: string; name: string } | null = null;
  if (customerId) {
    customer = await prisma.customer.findFirst({
      where: { id: customerId, accountId },
      select: { id: true, name: true },
    });
    if (!customer) redirect("/livestock/sales/new?error=buyer");
  }
  const buyerName = str(formData.get("buyerName"));
  const buyer = customer?.name ?? buyerName;
  if (!buyer) redirect("/livestock/sales/new?error=buyer");

  const date = parseDateInput(formData.get("date")) ?? new Date();
  const paymentMethod = str(formData.get("paymentMethod"));
  const notes = str(formData.get("notes"));
  const what = animal ? `tag #${animal.tagNumber}` : "livestock";
  // Sales tax: where the sale is taxed — only ever this account's location.
  const locationId = str(formData.get("taxLocationId"));
  const taxLocation = locationId
    ? await prisma.taxLocation.findFirst({ where: { id: locationId, accountId }, select: { id: true } })
    : null;

  const income = await prisma.income.create({
    data: {
      accountId,
      date,
      taxYear: taxYearOf(date),
      source: buyer,
      description: `Livestock sale — ${what} to ${buyer} (${formatCents(salePriceCents)})`,
      amountCents: salePriceCents,
      division: "FARM",
      category: "Livestock sales",
      paymentMethod,
      notes,
    },
  });

  await prisma.livestockSale.create({
    data: {
      accountId,
      animalId: animal?.id ?? null,
      customerId: customer?.id ?? null,
      buyerName: customer ? null : buyerName,
      date,
      taxYear: taxYearOf(date),
      salePriceCents,
      weightLbs: num(formData.get("weightLbs")),
      paymentMethod,
      incomeId: income.id,
      taxLocationId: taxLocation?.id ?? null,
      processingNotes: str(formData.get("processingNotes")),
      notes,
    },
  });

  // A sold animal is out of the flock.
  if (animal) {
    await prisma.animal.updateMany({
      where: { id: animal.id, accountId },
      data: { status: "SOLD" },
    });
  }

  redirect("/livestock/sales?saved=1");
}

// Undoing a sale undoes all three parts: the sale, the income it posted, and
// the animal's status. Otherwise the books keep money that never came in.
export async function deleteLivestockSale(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/livestock/sales");

  const sale = await prisma.livestockSale.findFirst({ where: { id, accountId } });
  if (sale) {
    await prisma.livestockSale.deleteMany({ where: { id, accountId } });
    if (sale.incomeId) {
      await prisma.income.deleteMany({ where: { id: sale.incomeId, accountId } }).catch(() => {});
    }
    if (sale.animalId) {
      await prisma.animal.updateMany({
        where: { id: sale.animalId, accountId, status: "SOLD" },
        data: { status: "ACTIVE" },
      });
    }
  }
  redirect("/livestock/sales");
}
