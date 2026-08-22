import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { Card, FormError, PageHeader } from "@/components/ui";
import PrintJobForm from "../../PrintJobForm";
import { loadJobFormOptions } from "../../job-options";
import { updateJob } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;

  const job = await prisma.printJob.findFirst({ where: { id, accountId } });
  if (!job) notFound();

  const options = await loadJobFormOptions(accountId, {
    assetId: job.printerAssetId,
    invoiceId: job.invoiceId,
  });

  return (
    <div>
      <PageHeader title="Edit print job" sub={`${job.jobNumber} · ${job.partName}`} />
      {error ? (
        <FormError>Give the job a Part name, then tap Save changes again.</FormError>
      ) : null}
      <Card>
        <PrintJobForm
          action={updateJob}
          submitLabel="Save changes"
          defaults={job}
          customers={options.customers}
          assets={options.assets}
          invoices={options.invoices}
        />
      </Card>
    </div>
  );
}
