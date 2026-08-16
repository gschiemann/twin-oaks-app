import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { fileSrc } from "@/lib/storage";
import { Card, Chip, PageHeader, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import {
  KIND_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_STATUSES,
  kindTone,
  priorityTone,
  statusTone,
  type TicketKind,
  type TicketPriority,
  type TicketStatus,
} from "../ticket-bits";
import { deleteTicket, updateTicket } from "../actions";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) notFound();

  return (
    <div>
      <PageHeader title={ticket.ref} sub={ticket.title} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip tone={kindTone(ticket.kind)}>
          {KIND_LABELS[ticket.kind as TicketKind] ?? ticket.kind}
        </Chip>
        <Chip tone={statusTone(ticket.status)}>
          {STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
        </Chip>
        <Chip tone={priorityTone(ticket.priority)}>
          {PRIORITY_LABELS[ticket.priority as TicketPriority] ?? ticket.priority}
        </Chip>
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold text-stone-900">Ticket</h2>
        {error === "missing" ? (
          <p className="mb-3 text-sm font-medium text-amber-700">A title is required.</p>
        ) : null}
        <form action={updateTicket} className="space-y-3">
          <input type="hidden" name="id" value={ticket.id} />
          <div>
            <label className={labelCls} htmlFor="title">
              Title *
            </label>
            <input
              id="title"
              name="title"
              required
              defaultValue={ticket.title}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="description">
              What happened
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={ticket.description ?? ""}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="priority">
                Priority
              </label>
              <select
                id="priority"
                name="priority"
                defaultValue={ticket.priority}
                className={inputCls}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="status">
                Status
              </label>
              <select id="status" name="status" defaultValue={ticket.status} className={inputCls}>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="devNotes">
              Dev notes
            </label>
            <textarea
              id="devNotes"
              name="devNotes"
              rows={3}
              defaultValue={ticket.devNotes ?? ""}
              placeholder="What was changed, what still needs testing."
              className={inputCls}
            />
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save ticket
          </button>
        </form>
      </Card>

      {ticket.attachmentPath ? (
        <a
          href={fileSrc(ticket.attachmentPath)}
          target="_blank"
          rel="noreferrer"
          className="mb-4 block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileSrc(ticket.attachmentPath)}
            alt={`Screenshot for ${ticket.ref}`}
            className="max-h-96 w-full rounded-2xl border border-stone-200 bg-white object-contain"
          />
        </a>
      ) : null}

      <Card>
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2">
          <span className="text-sm text-stone-500">Logged</span>
          <span className="text-right text-sm font-medium text-stone-900">
            {formatDate(ticket.createdAt)}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4 py-2">
          <span className="text-sm text-stone-500">Last updated</span>
          <span className="text-right text-sm font-medium text-stone-900">
            {formatDate(ticket.updatedAt)}
          </span>
        </div>
      </Card>

      <form action={deleteTicket} className="mt-4 text-center">
        <input type="hidden" name="id" value={ticket.id} />
        <button
          type="submit"
          className="text-sm font-medium text-red-600 underline-offset-2 active:underline"
        >
          Delete ticket
        </button>
      </form>
    </div>
  );
}
