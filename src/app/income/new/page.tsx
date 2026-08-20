import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import IncomeForm from "../IncomeForm";
import { createIncome } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewIncomePage() {
  const accountId = await requireAccountId();
  const profile = await getBusinessProfile(accountId);
  return (
    <div>
      <PageHeader title="Add income" sub="Record money coming in — sales, jobs, services." />
      <Card>
        <IncomeForm action={createIncome} submitLabel="Save income" divisions={profile.divisions} />
      </Card>
    </div>
  );
}
