import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PRINT_JOB_STATUS_LABELS, type PrintJobStatus } from "@/lib/domain";
import {
  failedPrintCostCents,
  filamentUseCostCents,
  jobCostBreakdown,
  jobProfit,
  totalGramsUsed,
} from "@/lib/manufacturing";
import {
  Card,
  Chip,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { formatMinutes, jobStatusTone, spoolLabel } from "../job-bits";
import { addFilamentUse, deleteFilamentUse, deleteJob, setJobStatus } from "../actions";
import DocumentsCard from "@/components/DocumentsCard";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

// One line of the cost table: plain words on the left, money on the right.
function MoneyRow({
  label,
  hint,
  cents,
  strong = false,
  tone = "stone",
}: {
  label: string;
  hint?: string;
  cents: number;
  strong?: boolean;
  tone?: "stone" | "green" | "red";
}) {
  const valueCls =
    tone === "green" ? "text-oak-700" : tone === "red" ? "text-red-700" : "text-stone-900";
  return (
    <div
      className={`flex items-start justify-between gap-4 py-2.5 ${
        strong ? "border-t-2 border-stone-300" : "border-b border-stone-100"
      }`}
    >
      <span className="min-w-0">
        <span className={`block ${strong ? "font-semibold text-stone-900" : "text-stone-600"}`}>
          {label}
        </span>
        {hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
      </span>
      <span
        className={`shrink-0 tabular-nums ${strong ? "text-lg font-bold" : "font-medium"} ${valueCls}`}
      >
        {formatCents(cents)}
      </span>
    </div>
  );
}

const ERRORS: Record<string, string> = {
  grams: "Type how many grams you used — a number bigger than zero — and pick a spool.",
  spool: "That spool isn't on your shelf. Pick one from the list and try again.",
};

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const { saved, error } = await searchParams;

  const job = await prisma.printJob.findFirst({
    where: { id, accountId },
    include: {
      filamentUses: {
        orderBy: { createdAt: "desc" },
        include: { spool: true },
      },
    },
  });
  if (!job) notFound();

  // PrintJob keeps plain id columns (no Prisma relations), so the customer,
  // the printer and the invoice are looked up here — each scoped to this
  // account, so a stale id can never leak another shop's record.
  const [customer, printer, invoice, spools] = await Promise.all([
    job.customerId
      ? prisma.customer.findFirst({
          where: { id: job.customerId, accountId },
          select: { id: true, name: true, company: true },
        })
      : null,
    job.printerAssetId
      ? prisma.asset.findFirst({
          where: { id: job.printerAssetId, accountId },
          select: { id: true, name: true },
        })
      : null,
    job.invoiceId
      ? prisma.invoice.findFirst({
          where: { id: job.invoiceId, accountId },
          select: { id: true, number: true, totalCents: true, status: true },
        })
      : null,
    prisma.filamentSpool.findMany({
      where: { accountId, status: { not: "RETIRED" } },
      orderBy: [{ status: "asc" }, { material: "asc" }],
    }),
  ]);

  const uses = job.filamentUses;
  const breakdown = jobCostBreakdown(job, uses);
  const money = jobProfit(job, uses);
  const priced = job.salePriceCents != null;
  const failedCost = failedPrintCostCents(job, uses);
  const grams = totalGramsUsed(uses);
  const profitPositive = money.profitCents >= 0;

  return (
    <div>
      <PageHeader
        title={job.partName}
        sub={`${job.jobNumber}${job.partNumber ? ` · part ${job.partNumber}` : ""}`}
        action={
          <Link href={`/jobs/${job.id}/edit`} className={btnSecondaryCls}>
            Edit
          </Link>
        }
      />

      {saved === "filament" ? (
        <SavedBanner
          title="Filament recorded."
          hint="The grams came off that spool and the job's cost went up to match."
        />
      ) : null}
      {saved === "filament-removed" ? (
        <SavedBanner title="Filament entry removed." hint="Those grams went back on the spool." />
      ) : null}
      {saved === "status" ? <SavedBanner title="Job updated." /> : null}
      {error ? <FormError>{ERRORS[error] ?? "Check the boxes below and try again."}</FormError> : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={jobStatusTone(job.status)}>
          {PRINT_JOB_STATUS_LABELS[job.status as PrintJobStatus] ?? job.status}
        </Chip>
        <Chip>{job.quantity} good</Chip>
        {job.failedCount > 0 ? <Chip tone="red">{job.failedCount} failed</Chip> : null}
        {printer ? <Chip tone="blue">{printer.name}</Chip> : null}
      </div>

      {/* The point of the whole feature: did this job make money? */}
      {priced ? (
        <Card
          className={`mb-4 border-2 ${
            profitPositive ? "border-oak-500 bg-oak-50" : "border-red-300 bg-red-50"
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
            {profitPositive ? "You made" : "You lost"}
          </div>
          <div
            className={`display-serif text-4xl font-bold tabular-nums ${
              profitPositive ? "text-oak-800" : "text-red-800"
            }`}
          >
            {formatCents(Math.abs(money.profitCents))}
          </div>
          <p className="mt-1 text-sm text-stone-700">
            {formatCents(money.profitPerPartCents)} per part on {job.quantity}{" "}
            {job.quantity === 1 ? "part" : "parts"} · {money.marginPercent}% of the sale price.
          </p>
        </Card>
      ) : (
        <Card className="mb-4 border-2 border-stone-300 bg-stone-50">
          <p className="text-base font-semibold text-stone-900">No sale price yet.</p>
          <p className="mt-1 text-sm text-stone-600">
            This job has cost you {formatCents(breakdown.totalCents)} so far. Add what you&apos;re
            charging and the profit shows up here.
          </p>
          <Link href={`/jobs/${job.id}/edit`} className={`${btnPrimaryCls} mt-3`}>
            Add the price
          </Link>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Total cost" value={formatCents(breakdown.totalCents)} />
        <StatCard label="Sale price" value={priced ? formatCents(money.salePriceCents) : "—"} />
        <StatCard
          label="Profit"
          value={priced ? formatCents(money.profitCents) : "—"}
          tone={!priced ? "stone" : profitPositive ? "green" : "red"}
        />
        <StatCard
          label="Profit per part"
          value={priced ? formatCents(money.profitPerPartCents) : "—"}
          sub={`${job.quantity} sellable`}
        />
      </div>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">What this job cost</h2>
        <p className="mb-2 text-sm text-stone-500">
          Every dollar that went into it — filament, machine, and your own time.
        </p>
        <MoneyRow
          label="Material (filament)"
          hint={grams > 0 ? `${Math.round(grams)} g off your spools, waste included` : "none recorded yet"}
          cents={breakdown.materialCents}
        />
        <MoneyRow
          label="Printer time"
          hint={`${formatMinutes(job.printMinutes)} on the machine`}
          cents={breakdown.machineCents}
        />
        <MoneyRow
          label="Your labor"
          hint={`${formatMinutes(job.laborMinutes)} of your time`}
          cents={breakdown.laborCents}
        />
        <MoneyRow label="Packaging" cents={breakdown.packagingCents} />
        <MoneyRow label="Shipping" cents={breakdown.shippingCents} />
        <MoneyRow label="Anything else" cents={breakdown.otherCents} />
        <MoneyRow label="Total cost" cents={breakdown.totalCents} strong />
        <MoneyRow
          label="Sale price"
          hint={priced ? undefined : "not set yet"}
          cents={money.salePriceCents}
        />
        <MoneyRow
          label="Profit"
          cents={money.profitCents}
          strong
          tone={!priced ? "stone" : profitPositive ? "green" : "red"}
        />
        <MoneyRow
          label="Profit per part"
          hint={`split over ${job.quantity} ${job.quantity === 1 ? "part" : "parts"} you can sell`}
          cents={money.profitPerPartCents}
          tone={!priced ? "stone" : profitPositive ? "green" : "red"}
        />
      </Card>

      {job.failedCount > 0 ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-amber-900">
            {job.failedCount} print{job.failedCount === 1 ? "" : "s"} failed on this job
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            About {formatCents(failedCost)} of the cost above went into parts you can&apos;t sell.
            That money is still counted — it just gets carried by the {job.quantity} good{" "}
            {job.quantity === 1 ? "part" : "parts"}.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Record filament used</h2>
        {spools.length === 0 ? (
          <p className="text-sm text-stone-500">
            No spools on the shelf yet. Add a spool in Filament first, then come back and record
            what this job used.
          </p>
        ) : (
          <form action={addFilamentUse} className="space-y-3">
            <input type="hidden" name="printJobId" value={job.id} />
            <div>
              <label className={labelCls} htmlFor="spoolId">
                Which spool? *
              </label>
              <select id="spoolId" name="spoolId" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  Choose…
                </option>
                {spools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {spoolLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="grams">
                  Grams used *
                </label>
                <input
                  id="grams"
                  name="grams"
                  inputMode="decimal"
                  required
                  placeholder="120"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="wasteGrams">
                  Wasted grams
                </label>
                <input
                  id="wasteGrams"
                  name="wasteGrams"
                  inputMode="decimal"
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            </div>
            <p className="text-xs text-stone-500">
              Purge, brim, a clog — waste came off the same spool, so it costs the same money.
            </p>
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Take it off the spool
            </button>
          </form>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">Filament on this job ({uses.length})</h2>
        {uses.length === 0 ? (
          <p className="text-sm text-stone-500">
            Nothing recorded yet — add the grams above and the material cost fills itself in.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {uses.map((use) => (
              <div key={use.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-stone-900">
                    {Math.round(use.grams)} g
                    {use.wasteGrams > 0 ? ` + ${Math.round(use.wasteGrams)} g wasted` : ""}
                  </div>
                  <div className="truncate text-sm text-stone-500">{spoolLabel(use.spool)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums text-stone-900">
                    {formatCents(filamentUseCostCents(use))}
                  </span>
                  <form action={deleteFilamentUse}>
                    <input type="hidden" name="id" value={use.id} />
                    <input type="hidden" name="printJobId" value={job.id} />
                    <button type="submit" className="text-xs text-red-500">
                      remove
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">The job</h2>
        <Row label="What it is" value={job.description} />
        <Row
          label="Customer"
          value={
            customer ? (
              <Link href={`/customers/${customer.id}`} className="text-oak-700">
                {customer.name}
                {customer.company ? ` — ${customer.company}` : ""}
              </Link>
            ) : null
          }
        />
        <Row
          label="Printer"
          value={
            printer ? (
              <Link href={`/assets/${printer.id}`} className="text-oak-700">
                {printer.name}
              </Link>
            ) : null
          }
        />
        <Row label="Printer time" value={formatMinutes(job.printMinutes)} />
        <Row label="Your time" value={formatMinutes(job.laborMinutes)} />
        <Row label="Started" value={job.startedAt ? formatDate(job.startedAt) : null} />
        <Row label="Finished" value={job.completedAt ? formatDate(job.completedAt) : null} />
        <Row
          label="Invoice"
          value={
            invoice ? (
              <Link href={`/invoices/${invoice.id}`} className="text-oak-700">
                {invoice.number} — {formatCents(invoice.totalCents)}
              </Link>
            ) : null
          }
        />
        <Row label="Notes" value={job.notes} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Move this job along</h2>
        <div className="flex flex-wrap gap-2">
          {job.status !== "PRINTING" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="to" value="PRINTING" />
              <button type="submit" className={btnSecondaryCls}>
                Start printing
              </button>
            </form>
          ) : null}
          {job.status !== "DONE" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="to" value="DONE" />
              <button type="submit" className={btnPrimaryCls}>
                Mark done
              </button>
            </form>
          ) : null}
          {job.status !== "SHIPPED" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="to" value="SHIPPED" />
              <button type="submit" className={btnSecondaryCls}>
                Mark shipped
              </button>
            </form>
          ) : null}
          {job.status !== "CANCELLED" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="to" value="CANCELLED" />
              <button type="submit" className={btnSecondaryCls}>
                Cancel job
              </button>
            </form>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-stone-900">Delete this job</h2>
        <p className="mt-1 text-sm text-stone-500">
          Gone for good. Any filament recorded here goes back on its spool.
        </p>
        <form action={deleteJob} className="mt-3">
          <input type="hidden" name="id" value={job.id} />
          <button type="submit" className="text-sm font-medium text-red-600">
            Delete job {job.jobNumber}
          </button>
        </form>
      </Card>

      <DocumentsCard ownerType="PRINT_JOB" ownerId={job.id} title="CAD files & photos" />
    </div>
  );
}
