import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { getBusinessProfile } from "@/lib/business";
import { Card, FormError, PageHeader } from "@/components/ui";
import IncomeForm from "../IncomeForm";
import { createIncome } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewIncomePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    // Prefill carried over from a bank line at /banking.
    d?: string;
    v?: string;
    a?: string;
    date?: string;
    fromBankTxn?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const { error, d, v, a, date, fromBankTxn } = await searchParams;
  const profile = await getBusinessProfile(accountId);
  return (
    <div>
      <PageHeader title="Add income" sub="Record money coming in — sales, jobs, services." />
      {error ? (
        <FormError>
          The Amount needs to be numbers only (like 250.00) and the Description can&apos;t be blank.
          Fill those in and tap Save income again.
        </FormError>
      ) : null}
      <Card>
        <IncomeForm
          action={createIncome}
          submitLabel="Save income"
          divisions={profile.divisions}
          fromBankTxnId={fromBankTxn}
          defaults={{
            description: d,
            source: v,
            amountRaw: a,
            date: parseDateInput(date ?? null) ?? undefined,
          }}
        />
      </Card>
    </div>
  );
}
