import { Card, PageHeader, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import {
  KIND_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_KINDS,
  type TicketKind,
} from "../ticket-bits";
import { createTicket } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; error?: string }>;
}) {
  const { kind: kindParam, error } = await searchParams;
  const selectedKind: TicketKind =
    kindParam && (TICKET_KINDS as readonly string[]).includes(kindParam)
      ? (kindParam as TicketKind)
      : "BUG";

  return (
    <div>
      <PageHeader
        title="Log a ticket"
        sub="Something broken, missing, or awkward — write it down now, sort it out later."
      />
      <Card>
        {error === "missing" ? (
          <p className="mb-3 text-sm font-medium text-amber-700">
            A kind and a title are required.
          </p>
        ) : null}
        <form action={createTicket} className="space-y-4">
          <div>
            <span className={labelCls}>Kind *</span>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_KINDS.map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-700 has-checked:border-oak-600 has-checked:bg-oak-50 has-checked:text-oak-800"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    defaultChecked={selectedKind === k}
                    className="accent-oak-700"
                  />
                  {KIND_LABELS[k]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="title">
              Title *
            </label>
            <input
              id="title"
              name="title"
              required
              placeholder="Receipt total saves as $0.00"
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
              placeholder="What you did, what you expected, what happened instead."
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="priority">
              Priority
            </label>
            <select id="priority" name="priority" defaultValue="MEDIUM" className={inputCls}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="attachment">
              Screenshot
            </label>
            <input
              id="attachment"
              name="attachment"
              type="file"
              accept="image/*"
              capture="environment"
              className="w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-oak-700 file:px-4 file:py-2 file:font-semibold file:text-white"
            />
            <p className="mt-1 text-xs text-stone-500">
              Optional — a screenshot of the problem usually explains it faster than words.
            </p>
          </div>

          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Log it
          </button>
        </form>
      </Card>
    </div>
  );
}
