import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { compareTags } from "@/lib/livestock";
import { Card, FormError, PageHeader } from "@/components/ui";
import AnimalForm from "../AnimalForm";
import { createAnimal } from "../actions";
import { animalErrorMessage } from "../livestock-bits";

export const dynamic = "force-dynamic";

export default async function NewAnimalPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error } = await searchParams;

  const parents = await prisma.animal.findMany({
    where: { accountId, sex: { in: ["RAM", "EWE"] } },
    select: { id: true, tagNumber: true, name: true, sex: true },
  });
  const sorted = parents.sort((a, b) => compareTags(a.tagNumber, b.tagNumber));

  return (
    <div>
      <PageHeader
        title="Add an animal"
        sub="Tag number is all it takes to start — the rest can be filled in later."
      />
      {error ? <FormError>{animalErrorMessage(error)}</FormError> : null}
      <Card>
        <AnimalForm
          action={createAnimal}
          submitLabel="Save animal"
          rams={sorted.filter((a) => a.sex === "RAM")}
          ewes={sorted.filter((a) => a.sex === "EWE")}
        />
      </Card>
    </div>
  );
}
