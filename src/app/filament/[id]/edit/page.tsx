import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { Card, FormError, PageHeader } from "@/components/ui";
import SpoolForm from "../../SpoolForm";
import { spoolName, spoolSaveError } from "../../spool-bits";
import { updateSpool } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditSpoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;
  const [spool, assets] = await Promise.all([
    prisma.filamentSpool.findFirst({ where: { id, accountId } }),
    prisma.asset.findMany({
      where: { accountId },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!spool) notFound();

  const message = spoolSaveError(error, "Save changes");

  return (
    <div>
      <PageHeader title="Edit spool" sub={spoolName(spool)} />
      {message ? <FormError>{message}</FormError> : null}
      <Card>
        <SpoolForm
          action={updateSpool}
          submitLabel="Save changes"
          defaults={spool}
          assets={assets}
        />
      </Card>
    </div>
  );
}
