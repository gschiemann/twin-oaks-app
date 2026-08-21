import { Card, FormError, PageHeader } from "@/components/ui";
import CustomerForm from "../CustomerForm";
import { createCustomer } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { returnTo, error } = await searchParams;
  return (
    <div>
      <PageHeader title="Add customer" />
      {error ? (
        <FormError>Give the customer a Name, then tap Save customer again.</FormError>
      ) : null}
      <Card>
        <CustomerForm action={createCustomer} submitLabel="Save customer" returnTo={returnTo} />
      </Card>
    </div>
  );
}
