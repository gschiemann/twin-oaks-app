import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { startOfMonth } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PRINT_JOB_STATUSES, PRINT_JOB_STATUS_LABELS, type PrintJobStatus } from "@/lib/domain";
import { jobProfit, summarizeJobs } from "@/lib/manufacturing";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
} from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";
import { jobStatusTone } from "./job-bits";

export const dynamic = "force-dynamic";

// Every screen that costs a job needs the spool prices behind its filament.
const COSTING_INCLUDE = {
  filamentUses: {
    include: { spool: { select: { purchasePriceCents: true, totalGrams: true } } },
  },
} as const;

const chipCls = (active: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium ${
    active ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"
  }`;

function hrefFor(status: string, customerId: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (customerId !== "all") params.set("customerId", customerId);
  const q = params.toString();
  return q ? `/jobs?${q}` : "/jobs";
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; customerId?: string; saved?: string; deleted?: string }>;
}) {
  const accountId = await requireAccountId();
  const {
    status: statusParam,
    customerId: customerParam,
    saved,
    deleted,
  } = await searchParams;

  const status =
    statusParam && (PRINT_JOB_STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : "all";
  const customerId = customerParam && customerParam !== "all" ? customerParam : "all";

  const monthStart = startOfMonth();

  const [jobs, customers, monthJobs] = await Promise.all([
    prisma.printJob.findMany({
      where: {
        accountId,
        ...(status !== "all" ? { status } : {}),
        ...(customerId !== "all" ? { customerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: COSTING_INCLUDE,
    }),
    prisma.customer.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // The header numbers are always "this month, everything" — they don't
    // move when you change a filter, so they can be trusted at a glance.
    // A job counts in the month it was finished, or written down if it isn't.
    prisma.printJob.findMany({
      where: {
        accountId,
        status: { not: "CANCELLED" },
        OR: [
          { completedAt: { gte: monthStart } },
          { completedAt: null, createdAt: { gte: monthStart } },
        ],
      },
      include: COSTING_INCLUDE,
    }),
  ]);

  // PrintJob stores customerId as a plain column (no Prisma relation), so
  // names come from the customer list we already loaded for the filter.
  const customerNames = new Map(customers.map((c) => [c.id, c.name]));

  const month = summarizeJobs(
    monthJobs,
    monthJobs.flatMap((j) => j.filamentUses),
  );

  return (
    <div>
      <PageHeader
        title="Print jobs"
        sub="What you printed, what it cost you, and what you made on it."
        action={
          <Link href="/jobs/new" className={btnPrimaryCls}>
            Add
          </Link>
        }
      />

      {saved ? (
        <SavedBanner
          title="Print job saved."
          hint="Open it below to record the filament you used and see the profit."
          actionHref="/jobs/new"
          actionLabel="Add another job"
        />
      ) : null}

      {deleted ? (
        <SavedBanner
          title="Print job deleted."
          hint="Any filament it used was put back on the spool."
        />
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Jobs this month"
          value={String(month.jobs)}
          sub={`${month.parts} part${month.parts === 1 ? "" : "s"}`}
        />
        <StatCard label="Money in this month" value={formatCents(month.revenueCents)} />
        <StatCard
          label="Profit this month"
          value={formatCents(month.profitCents)}
          tone={month.profitCents < 0 ? "red" : "green"}
        />
        <StatCard
          label="Profit per part"
          value={month.parts > 0 ? formatCents(month.profitPerPartCents) : "—"}
          sub="average this month"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Link href={hrefFor("all", customerId)} className={chipCls(status === "all")}>
          All
        </Link>
        {PRINT_JOB_STATUSES.map((s) => (
          <Link key={s} href={hrefFor(s, customerId)} className={chipCls(status === s)}>
            {PRINT_JOB_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {customers.length > 0 ? (
        <form action="/jobs" className="mb-4 flex items-center gap-2">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <label className="sr-only" htmlFor="customer-filter">
            Show one customer
          </label>
          <select id="customer-filter" name="customerId" defaultValue={customerId} className={inputCls}>
            <option value="all">Everybody</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className={btnSecondaryCls}>
            Show
          </button>
        </form>
      ) : null}

      <div className="mb-4">
        <Link href="/jobs/report" className="text-sm font-medium text-oak-700">
          See the production report →
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title={
            status === "all" && customerId === "all"
              ? "No print jobs yet."
              : "No jobs match that filter."
          }
          hint={
            status === "all" && customerId === "all"
              ? "Add your first job — the part, the printer, the filament — and the app works out what it cost and what you made."
              : "Try 'All' above, or pick a different customer."
          }
          actionHref={status === "all" && customerId === "all" ? "/jobs/new" : "/jobs"}
          actionLabel={status === "all" && customerId === "all" ? "Add a print job" : "Show all jobs"}
        />
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const money = jobProfit(job, job.filamentUses);
            const priced = job.salePriceCents != null;
            return (
              <Link key={job.id} href={`/jobs/${job.id}`} className="block">
                <Card className="flex items-center gap-3 active:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-stone-900">
                      {job.jobNumber}{" "}
                      <span className="font-normal text-stone-500">· {job.partName}</span>
                    </div>
                    <div className="truncate text-sm text-stone-500">
                      {(job.customerId ? customerNames.get(job.customerId) : null) ??
                        "No customer"}{" "}
                      · {job.quantity} made
                      {job.failedCount > 0 ? ` · ${job.failedCount} failed` : ""}
                    </div>
                    <div className="mt-1">
                      <Chip tone={jobStatusTone(job.status)}>
                        {PRINT_JOB_STATUS_LABELS[job.status as PrintJobStatus] ?? job.status}
                      </Chip>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`font-bold tabular-nums ${
                        !priced
                          ? "text-stone-400"
                          : money.profitCents < 0
                            ? "text-red-700"
                            : "text-oak-700"
                      }`}
                    >
                      {priced ? formatCents(money.profitCents) : "—"}
                    </div>
                    <div className="text-xs text-stone-500">{priced ? "profit" : "no price yet"}</div>
                  </div>
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
