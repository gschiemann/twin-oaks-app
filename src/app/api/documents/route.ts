// Attach a file to any record — the one upload endpoint behind DocumentsCard.
//
// Multipart only (ownerType, ownerId, kind, title, file). The bytes go
// through this function into src/lib/storage.ts, which is why the size cap
// below matters: the platform refuses a request body much over 4.5 MB, and a
// refusal that happens in the network layer has no words for the operator.
//
// Ownership: the session decides the accountId — it is NEVER read from the
// body — and the owning record is looked up WITH that accountId before a
// single byte is stored, so a forged ownerId attaches nothing.

import { currentAccountId } from "@/lib/auth";
import { DOC_ERRORS, isDocumentOwnerType, ownerBelongsToAccount, saveDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function fail(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const accountId = await currentAccountId();
  if (!accountId) return fail(DOC_ERRORS.signedOut, 401);

  const contentType = req.headers.get("content-type") ?? "";
  const contentLength = req.headers.get("content-length") ?? "?";

  // Stage 1: read the body. An iCloud handle that went stale between pick
  // and send arrives here as an unreadable body or a zero-byte file — each
  // gets its own words, because the fix is different for each.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error(
      `[documents] unreadable body (content-type="${contentType}", content-length=${contentLength}):`,
      e,
    );
    return fail(DOC_ERRORS.unreadableBody, 400);
  }

  const ownerType = str(form.get("ownerType"));
  const ownerId = str(form.get("ownerId"));
  const kind = str(form.get("kind"));
  const title = str(form.get("title"));
  const file = form.get("file");

  if (!isDocumentOwnerType(ownerType) || !ownerId) return fail(DOC_ERRORS.badOwner, 400);
  if (!(file instanceof File)) return fail(DOC_ERRORS.noFile, 400);
  if (file.size === 0) {
    console.error(`[documents] zero-byte file "${file.name}" (${file.type})`);
    return fail(DOC_ERRORS.emptyFile, 400);
  }

  // Stage 2: prove the owner is ours BEFORE anything is written anywhere.
  const owned = await ownerBelongsToAccount(accountId, ownerType, ownerId);
  if (!owned) {
    console.warn(`[documents] refused attach to ${ownerType}:${ownerId} — not in this account`);
    return fail(DOC_ERRORS.badOwner, 404);
  }

  // Stage 3: store + record. saveDocument re-checks everything above (it is
  // safe on its own) and maps storage failures to plain English.
  const result = await saveDocument({ accountId, ownerType, ownerId, kind, title, file });
  if (!result.ok) return fail(result.error, result.status);

  return Response.json({ ok: true, id: result.document.id });
}
