import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import InvoiceForm from "../../InvoiceForm";
import { updateInvoice } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) notFound();
  if (invoice.status !== "DRAFT") redirect(`/invoices/${invoice.id}`);

  const [customers, profile] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        company: true,
        taxTreatment: true,
        taxRatePercent: true,
        taxExemptReason: true,
      },
    }),
    getBusinessProfile(),
  ]);

  return (
    <div>
      <PageHeader title="Edit draft" sub={invoice.number} />
      <Card>
        <InvoiceForm
          action={updateInvoice}
          submitLabel="Save changes"
          customers={customers}
          kind={invoice.kind === "QUOTE" ? "QUOTE" : "INVOICE"}
          defaultTaxRatePercent={profile.defaultTaxRatePercent}
          defaults={{
            id: invoice.id,
            customerId: invoice.customerId,
            division: invoice.division,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            terms: invoice.terms,
            notes: invoice.notes,
            shipToAddress: invoice.shipToAddress,
            salesTaxCents: invoice.salesTaxCents,
            taxRatePercent: invoice.taxRatePercent,
            taxManualOverride: invoice.taxManualOverride,
            lines: invoice.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              taxable: l.taxable,
            })),
          }}
        />
      </Card>
    </div>
  );
}
