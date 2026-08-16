import { prisma } from "@/lib/db";
import { getBusinessProfile } from "@/lib/business";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import InvoiceForm from "../InvoiceForm";
import { createInvoice } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; kind?: string }>;
}) {
  const { customerId, kind: kindParam } = await searchParams;
  const isQuote = kindParam === "QUOTE";
  const noun = isQuote ? "quote" : "invoice";

  const [customers, profile] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    getBusinessProfile(),
  ]);

  if (customers.length === 0) {
    return (
      <div>
        <PageHeader title={`New ${noun}`} />
        <EmptyState
          title="Add a customer first."
          hint={`A ${noun} is addressed to a customer — create one and you'll come right back here.`}
          actionHref="/customers/new?returnTo=invoice"
          actionLabel="Add customer"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`New ${noun}`}
        sub={
          isQuote
            ? "Saved as a draft — send it when the price is right."
            : "Saved as a draft — you review it before it counts."
        }
      />
      <Card>
        <InvoiceForm
          action={createInvoice}
          submitLabel="Save draft"
          customers={customers}
          kind={isQuote ? "QUOTE" : "INVOICE"}
          defaultTaxRatePercent={profile.defaultTaxRatePercent}
          defaults={{ customerId }}
        />
      </Card>
    </div>
  );
}
