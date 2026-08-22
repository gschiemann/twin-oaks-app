import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, FormError, PageHeader } from "@/components/ui";
import BillForm from "../BillForm";
import { billErrorText } from "../bill-bits";
import { createBill } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error } = await searchParams;
  const profile = await getBusinessProfile(accountId);

  return (
    <div>
      <PageHeader
        title="Add a regular bill"
        sub="Something you pay every month — insurance, the feed account, internet."
      />

      {error ? <FormError>{billErrorText(error)}</FormError> : null}

      <Card>
        <BillForm action={createBill} submitLabel="Save bill" divisions={profile.divisions} />
      </Card>

      <p className="mt-3 text-center text-xs text-stone-500">
        Saving a bill only sets a reminder. Nothing is added to your books until you record the
        payment yourself.
      </p>
    </div>
  );
}
