import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import IncomeForm from "../IncomeForm";
import { deleteIncome, updateIncome } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditIncomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const [income, profile] = await Promise.all([
    prisma.income.findFirst({ where: { id, accountId } }),
    getBusinessProfile(accountId),
  ]);
  if (!income) notFound();

  return (
    <div>
      <PageHeader title="Edit income" sub={income.description} />
      <Card>
        <IncomeForm action={updateIncome} submitLabel="Save changes" defaults={income} divisions={profile.divisions} />
      </Card>
      <form action={deleteIncome} className="mt-4 text-center">
        <input type="hidden" name="id" value={income.id} />
        <button
          type="submit"
          className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
        >
          Delete income record
        </button>
      </form>
    </div>
  );
}
