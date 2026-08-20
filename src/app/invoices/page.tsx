import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Card, Chip, EmptyState, PageHeader, StatCard, btnPrimaryCls } from "@/components/ui";
import {
  INVOICE_STATUS_LABELS,
  deriveInvoiceStatus,
  invoiceStatusTone,
  paidCentsOf,
} from "./invoice-bits";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const accountId = await requireAccountId();
  const { kind: kindParam } = await searchParams;
  const kind = kindParam === "QUOTE" ? "QUOTE" : "INVOICE";
  const isQuotes = kind === "QUOTE";

  const invoices = await prisma.invoice.findMany({
    where: { accountId, kind },
    orderBy: { createdAt: "desc" },
    include: { customer: true, payments: { select: { amountCents: true } } },
  });

  let outstanding = 0;
  let awaiting = 0;
  for (const i of invoices) {
    const st = deriveInvoiceStatus(i, paidCentsOf(i.payments));
    if (st === "SENT" || st === "PARTIAL" || st === "OVERDUE") {
      outstanding += Math.max(0, i.totalCents - paidCentsOf(i.payments));
      awaiting++;
    }
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link
          href="/invoices"
          className={
            !isQuotes
              ? "rounded-xl bg-oak-700 px-4 py-2 text-center font-semibold text-white"
              : "rounded-xl border border-stone-300 bg-white px-4 py-2 text-center font-medium text-stone-600"
          }
        >
          Invoices
        </Link>
        <Link
          href="/invoices?kind=QUOTE"
          className={
            isQuotes
              ? "rounded-xl bg-oak-700 px-4 py-2 text-center font-semibold text-white"
              : "rounded-xl border border-stone-300 bg-white px-4 py-2 text-center font-medium text-stone-600"
          }
        >
          Quotes
        </Link>
      </div>

      <PageHeader
        title={isQuotes ? "Quotes" : "Invoices"}
        sub={
          isQuotes
            ? "Price it first — one tap turns a yes into an invoice."
            : "Bill it, send it, get paid — payments land in your books automatically."
        }
        action={
          <Link href={isQuotes ? "/invoices/new?kind=QUOTE" : "/invoices/new"} className={btnPrimaryCls}>
            New
          </Link>
        }
      />

      {!isQuotes ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <StatCard
            label="Awaiting payment"
            value={String(awaiting)}
            sub={awaiting === 1 ? "invoice" : "invoices"}
          />
          <StatCard
            label="Outstanding"
            value={formatCents(outstanding)}
            tone={outstanding > 0 ? "red" : "stone"}
          />
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <EmptyState
          title={isQuotes ? "No quotes yet." : "No invoices yet."}
          hint={
            isQuotes
              ? "Price a job before committing — when the customer says yes, one tap converts it to an invoice."
              : "Create your first invoice — add a customer, list what they owe, and mark payments as they come in."
          }
          actionHref={isQuotes ? "/invoices/new?kind=QUOTE" : "/invoices/new"}
          actionLabel={isQuotes ? "New quote" : "New invoice"}
        />
      ) : (
        <div className="space-y-2">
          {invoices.map((i) => {
            const paid = paidCentsOf(i.payments);
            const st = deriveInvoiceStatus(i, paid);
            const balance = Math.max(0, i.totalCents - paid);
            return (
              <Link key={i.id} href={`/invoices/${i.id}`} className="block">
                <Card className="active:bg-stone-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-900">
                        {i.number}{" "}
                        <span className="font-normal text-stone-500">· {i.customer.name}</span>
                      </div>
                      <div className="text-sm text-stone-500">
                        {formatDate(i.issueDate)}
                        {i.dueDate ? ` · due ${formatDate(i.dueDate)}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold tabular-nums text-stone-900">
                        {formatCents(i.totalCents)}
                      </div>
                      {!isQuotes && balance > 0 && st !== "DRAFT" && st !== "CANCELLED" ? (
                        <div className="text-xs tabular-nums text-red-600">
                          {formatCents(balance)} due
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2">
                    <Chip tone={invoiceStatusTone(st)}>{INVOICE_STATUS_LABELS[st]}</Chip>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
