// Remove one attached document. Scoped to the signed-in account, so an id
// belonging to somebody else's books deletes nothing and reads as "gone".

import { currentAccountId } from "@/lib/auth";
import { DOC_ERRORS, deleteDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await currentAccountId();
  if (!accountId) return Response.json({ ok: false, error: DOC_ERRORS.signedOut }, { status: 401 });

  const { id } = await params;
  const result = await deleteDocument(accountId, id);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error ?? DOC_ERRORS.saveFailed }, { status: 404 });
  }
  return Response.json({ ok: true, id });
}
