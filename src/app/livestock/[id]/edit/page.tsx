import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { animalLabel, compareTags } from "@/lib/livestock";
import { Card, FormError, PageHeader } from "@/components/ui";
import AnimalForm from "../../AnimalForm";
import { updateAnimal } from "../../actions";
import { animalErrorMessage } from "../../livestock-bits";

export const dynamic = "force-dynamic";

export default async function EditAnimalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;

  const [animal, parents] = await Promise.all([
    prisma.animal.findFirst({ where: { id, accountId } }),
    prisma.animal.findMany({
      where: { accountId, sex: { in: ["RAM", "EWE"] } },
      select: { id: true, tagNumber: true, name: true, sex: true },
    }),
  ]);
  if (!animal) notFound();

  // An animal can't be its own parent.
  const sorted = parents
    .filter((p) => p.id !== animal.id)
    .sort((a, b) => compareTags(a.tagNumber, b.tagNumber));

  return (
    <div>
      <PageHeader title="Edit animal" sub={animalLabel(animal)} />
      {error ? <FormError>{animalErrorMessage(error)}</FormError> : null}
      <Card>
        <AnimalForm
          action={updateAnimal}
          submitLabel="Save changes"
          defaults={animal}
          rams={sorted.filter((a) => a.sex === "RAM")}
          ewes={sorted.filter((a) => a.sex === "EWE")}
        />
      </Card>
    </div>
  );
}
