import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { ensureBacklogTickets } from "@/lib/backlog";
import { formatDate } from "@/lib/dates";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
} from "@/components/ui";
import {
  KIND_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_KINDS,
  TICKET_STATUSES,
  kindTone,
  priorityTone,
  statusTone,
  type TicketKind,
  type TicketPriority,
  type TicketStatus,
} from "./ticket-bits";

export const dynamic = "force-dynamic";

const chipCls = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium ${
    active ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"
  }`;

function hrefFor(status: string, kind: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (kind !== "all") params.set("kind", kind);
  const q = params.toString();
  return q ? `/tickets?${q}` : "/tickets";
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; saved?: string }>;
}) {
  // The written backlog lives in code (src/lib/backlog.ts); anything missing
  // from this tracker is created here, since the seed script only ever runs
  // against a local database. Existing rows are never touched.
  const accountId = await requireAccountId();
  await ensureBacklogTickets();

  const { status: statusParam, kind: kindParam, saved } = await searchParams;
  const status =
    statusParam && (TICKET_STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : "all";
  const kind =
    kindParam && (TICKET_KINDS as readonly string[]).includes(kindParam) ? kindParam : "all";

  const where = {
    accountId,
    ...(status !== "all" ? { status } : {}),
    ...(kind !== "all" ? { kind } : {}),
  };

  // Counts are tracker-wide on purpose — they're the health of the backlog,
  // not of whatever filter happens to be on.
  const [tickets, openCount, completeCount] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.ticket.count({ where: { accountId, status: { not: "COMPLETE" } } }),
    prisma.ticket.count({ where: { accountId, status: "COMPLETE" } }),
  ]);

  // Newest first, but finished work sinks to the bottom.
  const ordered = [
    ...tickets.filter((t) => t.status !== "COMPLETE"),
    ...tickets.filter((t) => t.status === "COMPLETE"),
  ];

  return (
    <div>
      <PageHeader
        title="Tickets"
        sub="Bugs, ideas, and rough edges — log it the moment you hit it."
        action={
          <Link href="/tickets/new" className={btnPrimaryCls}>
            New
          </Link>
        }
      />

      {saved ? (
        <SavedBanner title="Ticket saved." hint="It's in the list below." />
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard
          label="Open"
          value={String(openCount)}
          sub={openCount === 1 ? "ticket" : "tickets"}
        />
        <StatCard label="Complete" value={String(completeCount)} tone="green" />
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Link href={hrefFor("all", kind)} className={chipCls(status === "all")}>
          All
        </Link>
        {TICKET_STATUSES.map((s) => (
          <Link key={s} href={hrefFor(s, kind)} className={chipCls(status === s)}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={hrefFor(status, "all")} className={chipCls(kind === "all")}>
          All kinds
        </Link>
        {TICKET_KINDS.map((k) => (
          <Link
            key={k}
            href={hrefFor(status, k)}
            title={KIND_LABELS[k]}
            className={chipCls(kind === k)}
          >
            {k}
          </Link>
        ))}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="Nothing here."
          hint={
            status === "all" && kind === "all"
              ? "Log the first bug or idea — takes about ten seconds, screenshot optional."
              : "No tickets match this filter. Clear it, or log a new one."
          }
          actionHref="/tickets/new"
          actionLabel="New ticket"
        />
      ) : (
        <div className="space-y-2">
          {ordered.map((t) => (
            <Link key={t.id} href={`/tickets/${t.id}`} className="block">
              <Card className="active:bg-stone-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-stone-900">{t.ref}</div>
                    <div className="mt-0.5 font-medium break-words text-stone-900">{t.title}</div>
                  </div>
                  <div className="shrink-0 text-xs text-stone-500">{formatDate(t.createdAt)}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tone={kindTone(t.kind)}>
                    {KIND_LABELS[t.kind as TicketKind] ?? t.kind}
                  </Chip>
                  <Chip tone={statusTone(t.status)}>
                    {STATUS_LABELS[t.status as TicketStatus] ?? t.status}
                  </Chip>
                  <Chip tone={priorityTone(t.priority)}>
                    {PRIORITY_LABELS[t.priority as TicketPriority] ?? t.priority}
                  </Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
