import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import {
  DEFAULT_LOGO_SRC,
  businessAddressLines,
  businessFromSnapshot,
  getBusinessProfile,
} from "@/lib/business";
import { fileSrc } from "@/lib/storage";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// FR-001 — Packing list. This sheet travels with the shipment and gets ticked
// with a pen, so it carries QUANTITIES and blank boxes only: no unit prices,
// no totals, no balance. Business details come from the invoice's frozen
// snapshot (falling back to the live profile) — never hardcoded.
export default async function PackingListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!invoice) notFound();

  const business = businessFromSnapshot(invoice.businessSnapshot, await getBusinessProfile());
  const businessLines = businessAddressLines(business);
  const businessContact = [business.email, business.website, business.phone]
    .filter(Boolean)
    .join(" · ");

  const { customer } = invoice;
  // The shipment goes wherever the invoice says, not necessarily where the
  // bill goes; the customer record is only the fallback.
  const shipTo = invoice.shipToAddress ?? customer.address;
  const customerContact = [customer.email, customer.phone].filter(Boolean).join(" · ");

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 print:hidden sm:flex-row sm:items-center">
        <PrintButton />
        <p className="text-sm text-stone-500">
          On iPhone: tap Print, then share the preview to save a PDF.
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 print:rounded-none print:border-0 print:p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={business.logoPath ? fileSrc(business.logoPath) : DEFAULT_LOGO_SRC}
              alt=""
              className="mb-2 h-16 w-auto"
            />
            <div className="display-serif text-xl font-bold tracking-tight text-stone-900">
              {business.name}
            </div>
            {businessLines.map((line, i) => (
              <div key={`${i}-${line}`} className="text-sm text-stone-700">
                {line}
              </div>
            ))}
            {businessContact ? (
              <div className="mt-1 text-sm text-stone-500">{businessContact}</div>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              PACKING LIST
            </div>
            <div className="text-lg font-bold text-stone-900">{invoice.number}</div>
            <div className="mt-1 text-sm text-stone-600">{formatDate(invoice.issueDate)}</div>
          </div>
        </div>

        {/* Ship to */}
        <div className="mt-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Ship to
          </div>
          <div className="mt-1 font-bold text-stone-900">{customer.name}</div>
          {customer.company ? (
            <div className="text-sm text-stone-700">{customer.company}</div>
          ) : null}
          {shipTo ? (
            <div className="whitespace-pre-line text-sm text-stone-700">{shipTo}</div>
          ) : (
            // Nothing on file — leave a box the packer can write the address into.
            <div className="mt-1 h-16 w-full max-w-xs border border-stone-400" />
          )}
          {customerContact ? (
            <div className="mt-1 text-sm text-stone-500">{customerContact}</div>
          ) : null}
        </div>

        {/* Items — quantities only, never prices */}
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-stone-300">
              <th className="w-16 py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                Packed
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                Description
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                Qty ordered
              </th>
              <th className="w-20 py-2 pl-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">
                Qty packed
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-stone-200">
                <td className="py-2.5 pr-3 align-middle">
                  {/* A printed checkbox, ticked with a pen — not an <input>. */}
                  <div className="h-4 w-4 border border-stone-400" />
                </td>
                <td className="px-3 py-2.5 text-stone-900">{line.description}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">
                  {line.quantity}
                </td>
                <td className="py-2.5 pl-3 align-middle">
                  <div className="ml-auto h-6 w-[60px] border border-stone-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Notes — printed note first, then room to write */}
        <div className="mt-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Notes</div>
          {invoice.notes ? (
            <p className="mt-1 whitespace-pre-line text-sm text-stone-500">{invoice.notes}</p>
          ) : null}
          <div className="mt-2 h-20 w-full border border-stone-400" />
        </div>

        {/* Footer */}
        <div className="mt-10 border-t border-stone-200 pt-4 text-xs text-stone-500">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>Packed by ________</span>
            <span>Date ________</span>
          </div>
          <div className="mt-2 text-stone-400">{business.name}</div>
        </div>
      </div>
    </div>
  );
}
