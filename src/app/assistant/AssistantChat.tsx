"use client";

// FR-002 — the conversation. Client state only: no new tables, nothing
// stored, and it starts fresh on every visit (the owner asked for an
// assistant, not a filing cabinet of chat logs).

import { useRef, useState } from "react";
import { Card, btnPrimaryCls, btnSecondaryCls } from "@/components/ui";

type Turn = { role: "user" | "assistant"; content: string };

// The API always answers JSON. Anything else — an HTML sign-in page after
// the cookie expired, an empty body from a proxy — must not surface as a
// parser error. Name the real cause instead. (Same pattern as
// src/components/ReceiptUploader.tsx.)
async function readReply(res: Response): Promise<{ ok: boolean; answer?: string; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { ok: boolean; answer?: string; error?: string };
  } catch {
    if (res.redirected || res.status === 401 || res.status === 403 || /<html/i.test(text)) {
      return { ok: false, error: "Your sign-in expired — refresh this page, sign in, and ask again." };
    }
    return { ok: false, error: `The server answered with status ${res.status}. Try again.` };
  }
}

export default function AssistantChat({ examples }: { examples: readonly string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const asked = question.trim();
    if (!asked || busy) return;

    const history = turns.slice(-6);
    setTurns((prev) => [...prev, { role: "user", content: asked }]);
    setDraft("");
    setError(null);
    setBusy(true);
    // Let the question paint before the wait begins.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: asked, history }),
      });
      const reply = await readReply(res);
      const answer = reply.ok ? reply.answer : undefined;
      if (answer) {
        setTurns((prev) => [...prev, { role: "assistant", content: answer }]);
      } else {
        setError(reply.error ?? "The assistant couldn't answer that one. Try again.");
      }
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    }
  }

  return (
    <div>
      {turns.length > 0 ? (
        <div className="mb-4 space-y-3" aria-live="polite">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-oak-700 px-4 py-3 text-base font-medium text-white">
                  {t.content}
                </p>
              </div>
            ) : (
              <Card key={i} className="max-w-[95%]">
                <p className="whitespace-pre-wrap text-base leading-relaxed text-stone-800">
                  {t.content}
                </p>
              </Card>
            ),
          )}
          {busy ? (
            <Card className="max-w-[95%] bg-stone-50">
              <p className="text-base text-stone-500">Looking through your books…</p>
            </Card>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Card className="mb-4 border-2 border-red-300 bg-red-50">
          <p className="text-base text-red-900">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor="assistant-question" className="mb-2 block text-base font-semibold text-stone-800">
            Ask about your books
          </label>
          <textarea
            id="assistant-question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={3}
            maxLength={500}
            disabled={busy}
            placeholder="What did I spend on feed this year?"
            className="w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 py-3 text-lg text-stone-900 placeholder-stone-400 focus:border-oak-600 focus:outline-none focus:ring-2 focus:ring-oak-200 disabled:bg-stone-100"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || draft.trim().length < 2}
              className={`${btnPrimaryCls} flex-1 py-3.5 text-lg disabled:opacity-50`}
            >
              {busy ? "Looking…" : "Ask"}
            </button>
            {turns.length > 0 && !busy ? (
              <button
                type="button"
                onClick={() => {
                  setTurns([]);
                  setError(null);
                }}
                className={btnSecondaryCls}
              >
                Start over
              </button>
            ) : null}
          </div>
        </form>
      </Card>

      {turns.length === 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Or tap one of these
          </p>
          <div className="space-y-2">
            {examples.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => void ask(q)}
                className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-left text-base font-medium text-stone-700 shadow-sm active:bg-stone-100 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
