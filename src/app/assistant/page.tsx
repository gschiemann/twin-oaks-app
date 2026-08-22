// FR-002 — "Ask about your books".
//
// Two rules shape this page:
//   • It is never a dead end. With no AI key configured the page says so in
//     plain words and STILL shows the snapshot — the same numbers the
//     assistant would be reading — as a readable summary.
//   • It is honest about where answers come from. The snapshot is always on
//     the page, one tap away, so an answer can be checked against it.

import { requireAccountId } from "@/lib/auth";
import {
  ASSISTANT_EXAMPLE_QUESTIONS,
  assistantConfigured,
  buildSnapshot,
} from "@/lib/assistant";
import { formatCents } from "@/lib/money";
import { Card, PageHeader, StatCard } from "@/components/ui";
import AssistantChat from "./AssistantChat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AssistantPage() {
  const accountId = await requireAccountId();
  const snapshot = await buildSnapshot(accountId);
  const configured = assistantConfigured();
  const net = snapshot.headline.netYtdCents;

  return (
    <div>
      <PageHeader
        title="Ask about your books"
        sub="Plain questions, plain answers — from your own records."
      />

      {configured ? (
        <AssistantChat examples={ASSISTANT_EXAMPLE_QUESTIONS} />
      ) : (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <h2 className="text-base font-semibold text-amber-900">
            The assistant isn&apos;t switched on for this app yet.
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Nothing is wrong with your books. Answering questions out loud needs an AI key, and
            this app hasn&apos;t been given one. Whoever set the app up can add one.
          </p>
          <p className="mt-2 text-sm text-amber-900">
            In the meantime, here are your numbers, already added up — the same ones the
            assistant would be reading.
          </p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard
          label={`Revenue ${snapshot.year}`}
          value={formatCents(snapshot.headline.revenueYtdCents)}
          tone="green"
        />
        <StatCard
          label={`Expenses ${snapshot.year}`}
          value={formatCents(snapshot.headline.expensesYtdCents)}
        />
        <StatCard
          label={`Profit ${snapshot.year}`}
          value={formatCents(net)}
          tone={net >= 0 ? "green" : "red"}
        />
      </div>

      <details open={!configured} className="mb-4">
        <summary className="cursor-pointer rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-base font-semibold text-stone-800 shadow-sm">
          {configured ? "See the numbers it works from" : "Your numbers, added up"}
        </summary>

        <p className="mt-3 px-1 text-sm text-stone-500">
          Totals from your own records as of {snapshot.generatedAt}. These add-ups — and nothing
          else — are what the assistant is given. No receipts, no customer contact details, and
          no personal information leave this app.
        </p>

        <div className="mt-3 space-y-3">
          {snapshot.sections.map((s) => (
            <Card key={s.title}>
              <h3 className="font-semibold text-stone-900">{s.title}</h3>
              {s.note ? <p className="mt-0.5 text-xs text-stone-500">{s.note}</p> : null}
              <div className="mt-2 divide-y divide-stone-100">
                {s.rows.map((r) => (
                  <div
                    key={r.label}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm"
                  >
                    <span className="text-stone-600">{r.label}</span>
                    <span className="font-semibold tabular-nums text-stone-900">{r.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </details>

      <p className="px-2 text-center text-xs text-stone-400">
        Answers come from your own records in this app — nothing else, and nothing from other
        businesses using it. The assistant can read your numbers; it cannot change, send, or
        delete anything. It does not give tax advice: what counts as a deduction is your
        accountant&apos;s call.
      </p>
    </div>
  );
}
