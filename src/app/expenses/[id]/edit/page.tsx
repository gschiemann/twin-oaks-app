import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import ExpenseForm from "../../ExpenseForm";
import { updateExpense } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
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
