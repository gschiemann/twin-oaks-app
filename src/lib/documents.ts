// Documents — one reusable "attach a file to any record" mechanism.
//
// SPEC §31: a manual belongs on the tractor, registration papers belong on
// the animal, the CAD file belongs on the print job. Before this, only a
// Receipt could hold a file. A Document row is (ownerType, ownerId) plus the
// same storage tiering receipts use (src/lib/storage.ts) — no second storage
// path, no direct filesystem writes, no Blob SDK calls of its own.
//
// THREE SECURITY RULES, enforced here so no caller can forget them:
//   1. Every read and every write is filtered on accountId. No exceptions.
//   2. ownerType is checked against the DOCUMENT_OWNER_TYPES allowlist before
//      it is used to pick a table, and the owner row itself is looked up
//      WITH accountId — a forged ownerId from another account cannot be
//      attached to, and nothing is stored until that check passes.
//   3. Nothing here ever emits a raw storage URL. Callers render fileSrc(),
//      which routes through /api/files (login-gated, ownership-checked).
//
// Everything returns a value instead of throwing: a card that fails must
// degrade to "no documents yet", never take a page render down with it.

import { prisma } from "@/lib/db";
import {
  DOCUMENT_KINDS,
  DOCUMENT_OWNER_TYPES,
  type DocumentKind,
  type DocumentOwnerType,
} from "@/lib/domain";
import { MAX_DB_FILE_BYTES, StorageNotConnectedError, saveUpload } from "@/lib/storage";

export type DocumentRecord = {
  id: string;
  accountId: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  title: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  notes: string | null;
  createdAt: Date;
};

// The whole file rides through the API route, and the platform caps a
// serverless request body around 4.5 MB — so the ceiling is the same one the
// database-backed storage tier uses. Photos are shrunk on the device first,
// which puts every normal picture comfortably under it.
export const MAX_DOCUMENT_BYTES = MAX_DB_FILE_BYTES;

// One vocabulary for both the API route and the uploader, so the operator
// reads the same words no matter which layer noticed the problem.
export const DOC_ERRORS = {
  signedOut: "Your sign-in expired — refresh this page, sign in, and try again.",
  emptyFile:
    "That file arrived empty (0 bytes). Open it once in the Files app so it downloads from iCloud, then pick it again.",
  unreadableBody:
    "The upload arrived without its contents — usually a file the device couldn't read at send time. If it lives in iCloud, open it once in the Files app so it downloads, then pick it again.",
  noStorage:
    "File storage isn't connected on this deployment, so there was nowhere to put the file. Nothing was saved.",
  storeFailed:
    "The file transferred but couldn't be stored, so nothing was saved. Try again in a minute.",
  badOwner: "Couldn't find that record in your account, so nothing was attached.",
  noFile: "Pick a file first — nothing was attached.",
  tooBig: `That file is bigger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB, which is more than this app can send in one piece. Take a photo of the document instead (photos are shrunk automatically), or save it as a smaller PDF.`,
  saveFailed: "Could not save that document.",
} as const;

// ———————————————————————————————————————————————————————————————————————
// Owner plumbing — the allowlist that turns an untrusted string into a table
// ———————————————————————————————————————————————————————————————————————

export function isDocumentOwnerType(value: unknown): value is DocumentOwnerType {
  return typeof value === "string" && (DOCUMENT_OWNER_TYPES as readonly string[]).includes(value);
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const DOCUMENT_OWNER_LABELS: Record<DocumentOwnerType, string> = {
  ASSET: "Equipment",
  CUSTOMER: "Customer",
  ANIMAL: "Animal",
  PRINT_JOB: "Print job",
  INVOICE: "Invoice",
  EXPENSE: "Expense",
};

// Where the owning record lives in the app. Deliberately plain strings —
// those pages belong to other parts of the codebase and are not imported.
export function ownerHref(ownerType: string, ownerId: string): string {
  switch (ownerType) {
    case "ASSET":
      return `/assets/${ownerId}`;
    case "CUSTOMER":
      return `/customers/${ownerId}`;
    case "ANIMAL":
      return `/livestock/${ownerId}`;
    case "PRINT_JOB":
      return `/jobs/${ownerId}`;
    case "INVOICE":
      return `/invoices/${ownerId}`;
    case "EXPENSE":
      return `/expenses/${ownerId}`;
    default:
      return "/documents";
  }
}

/** Does this owner record exist AND belong to this account? Every attach
 *  goes through here before a single byte is stored. */
export async function ownerBelongsToAccount(
  accountId: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
): Promise<boolean> {
  if (!accountId || !ownerId) return false;
  try {
    switch (ownerType) {
      case "ASSET":
        return (await prisma.asset.count({ where: { id: ownerId, accountId } })) > 0;
      case "CUSTOMER":
        return (await prisma.customer.count({ where: { id: ownerId, accountId } })) > 0;
      case "ANIMAL":
        return (await prisma.animal.count({ where: { id: ownerId, accountId } })) > 0;
      case "PRINT_JOB":
        return (await prisma.printJob.count({ where: { id: ownerId, accountId } })) > 0;
      case "INVOICE":
        return (await prisma.invoice.count({ where: { id: ownerId, accountId } })) > 0;
      case "EXPENSE":
        return (await prisma.expense.count({ where: { id: ownerId, accountId } })) > 0;
      default:
        return false;
    }
  } catch (e) {
    // A database hiccup must read as "can't prove ownership", never as "sure".
    console.error("[documents] owner check failed:", e);
    return false;
  }
}

// ———————————————————————————————————————————————————————————————————————
// Reads
// ———————————————————————————————————————————————————————————————————————

/** Every document attached to one record, newest first. Never throws. */
export async function listDocuments(
  accountId: string,
  ownerType: string,
  ownerId: string,
): Promise<DocumentRecord[]> {
  if (!accountId || !ownerId || !isDocumentOwnerType(ownerType)) return [];
  try {
    return await prisma.document.findMany({
      where: { accountId, ownerType, ownerId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  } catch (e) {
    console.error("[documents] list failed:", e);
    return [];
  }
}

/** How many documents each of these records has — ONE grouped query, so a
 *  list page can show "3 photos" badges without a query per row. */
export async function documentCounts(
  accountId: string,
  ownerType: string,
  ownerIds: string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  if (!accountId || ids.length === 0 || !isDocumentOwnerType(ownerType)) return {};
  try {
    const rows = await prisma.document.groupBy({
      by: ["ownerId"],
      where: { accountId, ownerType, ownerId: { in: ids } },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) out[row.ownerId] = row._count._all;
    return out;
  } catch (e) {
    console.error("[documents] counts failed:", e);
    return {};
  }
}

/** Everything this account has stored, newest first — the /documents page.
 *  `kind` is validated; an unknown value simply means "no filter". */
export async function listAllDocuments(
  accountId: string,
  kind?: string,
  limit = 300,
): Promise<DocumentRecord[]> {
  if (!accountId) return [];
  try {
    return await prisma.document.findMany({
      where: { accountId, ...(isDocumentKind(kind) ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch (e) {
    console.error("[documents] list-all failed:", e);
    return [];
  }
}

/** Human names for the records these documents hang off — batched per table
 *  (at most one query per owner type), so /documents is never N+1.
 *  Keyed "OWNERTYPE:ownerId". Every lookup is accountId-scoped. */
export async function documentOwnerNames(
  accountId: string,
  docs: { ownerType: string; ownerId: string }[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!accountId || docs.length === 0) return out;

  const byType = new Map<DocumentOwnerType, string[]>();
  for (const d of docs) {
    if (!isDocumentOwnerType(d.ownerType) || !d.ownerId) continue;
    const list = byType.get(d.ownerType) ?? [];
    list.push(d.ownerId);
    byType.set(d.ownerType, list);
  }

  await Promise.all(
    [...byType.entries()].map(async ([ownerType, rawIds]) => {
      const ids = [...new Set(rawIds)];
      try {
        switch (ownerType) {
          case "ASSET": {
            const rows = await prisma.asset.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, name: true },
            });
            for (const r of rows) out[`ASSET:${r.id}`] = r.name;
            break;
          }
          case "CUSTOMER": {
            const rows = await prisma.customer.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, name: true },
            });
            for (const r of rows) out[`CUSTOMER:${r.id}`] = r.name;
            break;
          }
          case "ANIMAL": {
            const rows = await prisma.animal.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, tagNumber: true, name: true },
            });
            for (const r of rows) {
              out[`ANIMAL:${r.id}`] = r.name ? `${r.tagNumber} · ${r.name}` : r.tagNumber;
            }
            break;
          }
          case "PRINT_JOB": {
            const rows = await prisma.printJob.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, jobNumber: true, partName: true },
            });
            for (const r of rows) out[`PRINT_JOB:${r.id}`] = `${r.jobNumber} · ${r.partName}`;
            break;
          }
          case "INVOICE": {
            const rows = await prisma.invoice.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, number: true },
            });
            for (const r of rows) out[`INVOICE:${r.id}`] = r.number;
            break;
          }
          case "EXPENSE": {
            const rows = await prisma.expense.findMany({
              where: { accountId, id: { in: ids } },
              select: { id: true, description: true },
            });
            for (const r of rows) out[`EXPENSE:${r.id}`] = r.description;
            break;
          }
        }
      } catch (e) {
        // A missing table (a model another engineer hasn't shipped yet) or a
        // database blip must not blank the page — the row just shows its type.
        console.error(`[documents] owner names failed for ${ownerType}:`, e);
      }
    }),
  );

  return out;
}

// ———————————————————————————————————————————————————————————————————————
// Writes
// ———————————————————————————————————————————————————————————————————————

export type SaveDocumentResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; error: string; status: number };

/** Store the bytes and create the row. Returns a result rather than throwing
 *  so every caller is forced to have words for the failure. */
export async function saveDocument(input: {
  accountId: string;
  ownerType: string;
  ownerId: string;
  kind?: string | null;
  title?: string | null;
  file: File;
}): Promise<SaveDocumentResult> {
  const { accountId, ownerId, file } = input;
  if (!accountId) return { ok: false, error: DOC_ERRORS.signedOut, status: 401 };
  if (!isDocumentOwnerType(input.ownerType) || !ownerId) {
    return { ok: false, error: DOC_ERRORS.badOwner, status: 400 };
  }
  if (!(file instanceof File)) return { ok: false, error: DOC_ERRORS.noFile, status: 400 };
  if (file.size === 0) return { ok: false, error: DOC_ERRORS.emptyFile, status: 400 };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: DOC_ERRORS.tooBig, status: 413 };
  }

  // NOTHING is stored until the owner record is proven to be this account's.
  const owned = await ownerBelongsToAccount(accountId, input.ownerType, ownerId);
  if (!owned) return { ok: false, error: DOC_ERRORS.badOwner, status: 404 };

  const kind: DocumentKind = isDocumentKind(input.kind) ? input.kind : "DOCUMENT";
  const fallbackName = file.name || "Document";
  const title = (input.title ?? "").trim() || fallbackName.replace(/\.[^.]+$/, "") || "Document";

  let stored: Awaited<ReturnType<typeof saveUpload>>;
  try {
    stored = await saveUpload(file, accountId);
  } catch (e) {
    console.error("[documents] storing the file failed:", e);
    if (e instanceof StorageNotConnectedError) {
      return { ok: false, error: DOC_ERRORS.noStorage, status: 503 };
    }
    return { ok: false, error: DOC_ERRORS.storeFailed, status: 502 };
  }

  try {
    const document = await prisma.document.create({
      data: {
        accountId,
        ownerType: input.ownerType,
        ownerId,
        kind,
        title: title.slice(0, 200),
        filePath: stored.storageKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
      },
    });
    return { ok: true, document };
  } catch (e) {
    console.error("[documents] row create failed:", e);
    return { ok: false, error: DOC_ERRORS.saveFailed, status: 500 };
  }
}

/** Remove one document (accountId-scoped), and the stored bytes with it when
 *  the file lives in the database and nothing else points at it. */
export async function deleteDocument(
  accountId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!accountId || !id) return { ok: false, error: DOC_ERRORS.badOwner };
  try {
    // Read the key first (scoped) so we know what to clean up afterwards.
    const doc = await prisma.document.findFirst({
      where: { id, accountId },
      select: { id: true, filePath: true },
    });
    if (!doc) return { ok: false, error: "That document is already gone." };

    const removed = await prisma.document.deleteMany({ where: { id, accountId } });
    if (removed.count === 0) return { ok: false, error: "That document is already gone." };

    // Database-backed originals ("db:<id>") are rows we own; drop them once
    // no other document or receipt still points at the same key, so deleting
    // a 3 MB manual actually gives the space back.
    if (doc.filePath.startsWith("db:")) {
      const storedFileId = doc.filePath.slice(3);
      const [otherDocs, otherReceipts] = await Promise.all([
        prisma.document.count({ where: { accountId, filePath: doc.filePath } }),
        prisma.receipt.count({ where: { accountId, filePath: doc.filePath } }),
      ]);
      if (otherDocs === 0 && otherReceipts === 0) {
        await prisma.storedFile.deleteMany({ where: { id: storedFileId, accountId } });
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("[documents] delete failed:", e);
    return { ok: false, error: "Could not remove that document. Try again." };
  }
}

// ———————————————————————————————————————————————————————————————————————
// Small shared display helpers
// ———————————————————————————————————————————————————————————————————————

export function isImageDocument(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.startsWith("image/") && !/heic|heif/.test(mimeType);
}

export function documentGlyph(mimeType: string | null | undefined, fileName?: string): string {
  const t = (mimeType ?? "").toLowerCase();
  const n = (fileName ?? "").toLowerCase();
  if (t.startsWith("image/")) return "🖼";
  if (t === "application/pdf" || n.endsWith(".pdf")) return "📄";
  if (/\.(stl|step|stp|3mf|obj|dxf|dwg|f3d|scad|gcode)$/.test(n)) return "🧊";
  if (t.startsWith("video/")) return "🎞";
  return "📎";
}
