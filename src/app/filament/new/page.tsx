import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { Card, FormError, PageHeader } from "@/components/ui";
import SpoolForm from "../SpoolForm";
import { spoolSaveError } from "../spool-bits";
import { createSpool } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewSpoolPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error } = await searchParams;
  const assets = await prisma.asset.findMany({
    where: { accountId },
    select: { id: true, name: true, kind: true },
    orderBy: { name: "asc" },
  });
  const message = spoolSaveError(error, "Save spool");

  return (
    <div>
      <PageHeader
        title="Add a spool"
        sub="One record per spool — the app works out price per gram and what is left."
      />
      {message ? <FormError>{message}</FormError> : null}
      <Card>
        <SpoolForm action={createSpool} submitLabel="Save spool" assets={assets} />
      </Card>
    </div>
  );
}
