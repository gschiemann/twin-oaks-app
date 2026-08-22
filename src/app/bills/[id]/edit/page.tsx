import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { dueInWords, daysUntil, nextDueDate } from "@/lib/bills";
import { Card, FormError, PageHeader, btnSecondaryCls } from "@/components/ui";
import BillForm from "../../BillForm";
import { billErrorText } from "../../bill-bits";
import { deleteBill, updateBill } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { error } = await searchParams;

  const [bill, profile] = await Promise.all([
    prisma.recurringBill.findFirst({ where: { id, accountId } }),
    getBusinessProfile(accountId),
  ]);
  if (!bill) notFound();

  const due = nextDueDate(bill.dayOfMonth);

  return (
    <div>
      <PageHeader title="Edit bill" sub={`${bill.description} · ${formatCents(bill.amountCents)}`} />

      {error ? <FormError>{billErrorText(error)}</FormError> : null}

      <Card className="mb-4 text-sm text-stone-600">
        {bill.active ? (
          <>
            Next time: <span className="font-medium text-stone-900">{formatDate(due)}</span> —{" "}
            {dueInWords(bill.dayOfMonth, daysUntil(due))}.
          </>
        ) : (
          <>Paused — it is not counted in your monthly total and will not show as coming up.</>
        )}
      </Card>

      <Card>
        <BillForm
          action={updateBill}
          submitLabel="Save changes"
          defaults={bill}
          divisions={profile.divisions}
        />
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold text-stone-900">Remove this bill</h2>
        <p className="mt-1 text-sm text-stone-600">
          This deletes the reminder only. Every payment you already recorded stays in your books —
          nothing in your expenses changes. If you might pay it again later, untick{" "}
          <span className="font-medium">Still paying this one</span> above instead.
        </p>
        <form action={deleteBill} className="mt-3">
          <input type="hidden" name="id" value={bill.id} />
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-xl border border-red-300 bg-white px-4 py-2.5 text-base font-semibold text-red-700 active:bg-red-50"
          >
            Remove bill
          </button>
        </form>
      </Card>

      <Link href="/bills" className={`${btnSecondaryCls} mt-4 w-full`}>
        Back to bills
      </Link>
    </div>
  );
}
