import { requireAccountId } from "@/lib/auth";
import { Card, FormError, PageHeader } from "@/components/ui";
import PrintJobForm from "../PrintJobForm";
import { loadJobFormOptions } from "../job-options";
import { createJob } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error } = await searchParams;
  const options = await loadJobFormOptions(accountId);

  return (
    <div>
      <PageHeader
        title="Add a print job"
        sub="One job = one part run. Fill in what you know; you can add the rest later."
      />
      {error ? (
        <FormError>Give the job a Part name, then tap Save print job again.</FormError>
      ) : null}
      <Card>
        <PrintJobForm
          action={createJob}
          submitLabel="Save print job"
          customers={options.customers}
          assets={options.assets}
          invoices={options.invoices}
        />
      </Card>
    </div>
  );
}
