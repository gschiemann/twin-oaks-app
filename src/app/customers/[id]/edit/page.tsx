import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import CustomerForm from "../../CustomerForm";
import { updateCustomer } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const customer = await prisma.customer.findFirst({ where: { id, accountId } });
  if (!customer) notFound();

  return (
    <div>
      <PageHeader title="Edit customer" sub={customer.name} />
      <Card>
        <CustomerForm
          action={updateCustomer}
          submitLabel="Save changes"
          defaults={customer}
        />
      </Card>
    </div>
  );
}
