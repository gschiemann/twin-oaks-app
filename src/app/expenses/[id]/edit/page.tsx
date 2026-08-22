import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, FormError, PageHeader } from "@/components/ui";
import ExpenseForm from "../../ExpenseForm";
import { updateExpense } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;
  const [expense, vendors, assets, profile] = await Promise.all([
    prisma.expense.findFirst({ where: { id, accountId } }),
    prisma.vendor.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.asset.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getBusinessProfile(accountId),
  ]);
  if (!expense) notFound();

  return (
    <div>
      <PageHeader title="Edit expense" sub={expense.description} />

      {/* The other half of the save rule: updateExpense bounces here with
          ?error=missing, so this page has to say why rather than look like
          nothing happened. */}
      {error ? (
        <FormError>
          The Amount needs to be numbers only (like 42.75) and the Description can&apos;t be blank.
          Nothing was changed — fix those two and tap Save changes again.
        </FormError>
      ) : null}

      <Card>
        <ExpenseForm
          action={updateExpense}
          submitLabel="Save changes"
          vendors={vendors.map((v) => v.name)}
          assets={assets}
          divisions={profile.divisions}
          defaults={expense}
        />
      </Card>
    </div>
  );
}
