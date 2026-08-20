import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import { ReceiptThumb } from "../../receipts/receipt-bits";
import { formatCents } from "@/lib/money";
import ExpenseForm from "../ExpenseForm";
import { createExpense } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ fromReceipt?: string; assetId?: string }>;
}) {
  const accountId = await requireAccountId();
  const { fromReceipt, assetId } = await searchParams;

  const [vendors, assets, receipt, profile] = await Promise.all([
    prisma.vendor.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.asset.findMany({
      where: { accountId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    fromReceipt
      ? prisma.receipt.findFirst({ where: { id: fromReceipt, accountId } })
      : Promise.resolve(null),
    getBusinessProfile(accountId),
  ]);

  return (
    <div>
      <PageHeader
        title={receipt ? "Categorize receipt" : "Add expense"}
        sub="Every dollar out gets a record, a category, and (ideally) a receipt."
      />

      {receipt ? (
        <Card className="mb-4 flex items-center gap-3 border-oak-200 bg-oak-50">
          <ReceiptThumb filePath={receipt.filePath} mimeType={receipt.mimeType} />
          <div className="text-sm text-oak-900">
            <div className="font-semibold">Creating expense from receipt</div>
            <div>
              {receipt.vendorName ?? "Unknown vendor"} · {formatCents(receipt.totalCents)}
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <ExpenseForm
          action={createExpense}
          submitLabel="Save expense"
          vendors={vendors.map((v) => v.name)}
          assets={assets}
          divisions={profile.divisions}
          fromReceiptId={receipt?.id}
          defaults={{
            vendorName: receipt?.vendorName,
            amountCents: receipt?.totalCents,
            salesTaxCents: receipt?.salesTaxCents,
            paymentMethod: receipt?.paymentMethod,
            date: receipt?.receiptDate ?? undefined,
            assetId: assetId ?? undefined,
          }}
        />
      </Card>
    </div>
  );
}
