// FR-002 — POST /api/assistant. One question, one answer.
//
// The account comes from the SESSION COOKIE and nowhere else — the body
// carries a question and (optionally) the conversation so far, never an
// account id. That is what makes cross-account reads impossible here: the
// snapshot is built for whoever is signed in, full stop.
//
// Behind the login gate (middleware) and checked again here, because an API
// route that returns JSON must answer 401 rather than redirect to /login.

import { currentAccountId } from "@/lib/auth";
import {
  ASSISTANT_NOT_CONFIGURED,
  askAssistant,
  assistantConfigured,
  buildSnapshot,
  takeAssistantTurn,
  type AssistantTurn,
} from "@/lib/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_ENTRIES = 6;
const MAX_HISTORY_ENTRY_CHARS = 1500;

function fail(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

// The conversation is client state (no new tables), so it arrives untrusted:
// take only the shape we expect, and cap it hard.
function readHistory(raw: unknown): AssistantTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: AssistantTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_ENTRIES)) {
    if (typeof item !== "object" || item === null) continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const text = content.trim().slice(0, MAX_HISTORY_ENTRY_CHARS);
    if (text) turns.push({ role, content: text });
  }
  return turns;
}

export async function POST(req: Request) {
  const accountId = await currentAccountId();
  if (!accountId) {
    return fail("Your sign-in expired — refresh this page and sign in again.", 401);
  }

  if (!assistantConfigured()) {
    return fail(ASSISTANT_NOT_CONFIGURED, 503);
  }

  let body: { question?: unknown; history?: unknown };
  try {
    body = (await req.json()) as { question?: unknown; history?: unknown };
  } catch {
    return fail("That question didn't arrive readable. Try again.", 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 2) {
    return fail("Type a question first — for example, what did I spend on feed this year?", 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(
      `That question is a bit long. Keep it under ${MAX_QUESTION_CHARS} characters and ask again.`,
      400,
    );
  }

  const limit = takeAssistantTurn(accountId);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: limit.error },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    // Built fresh for THIS account on every question, so the answer always
    // reflects what is in the books right now.
    const snapshot = await buildSnapshot(accountId);
    const reply = await askAssistant(snapshot, question, readHistory(body.history));
    if (reply.error) return fail(reply.error, 502);
    return Response.json({ ok: true, answer: reply.answer });
  } catch (e) {
    // askAssistant never throws; this catches a database hiccup while the
    // snapshot is being built. The page still has to say something useful.
    console.error("[assistant] request failed:", e);
    return fail("Couldn't read your books just now. Try again in a moment.", 500);
  }
}
