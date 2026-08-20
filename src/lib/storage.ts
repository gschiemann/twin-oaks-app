// File storage abstraction — callers only deal in storage keys/URLs.
//
// Three backends, auto-selected best-first:
//   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set. saveUpload returns the
//     blob's full https URL as the storage key. Blob URLs are
//     unguessable-random; true private object storage is a planned upgrade.
//   - THE DATABASE otherwise (StoredFile table, key "db:<id>"). This is what
//     keeps uploads working on a deployment whose Blob store was never
//     connected — the Vercel filesystem is read-only, so without this there
//     is no storage at all and every upload dies (the 2026-08 incident).
//     Intake through the API route is ≤ ~4.5 MB on Vercel, which photos
//     (shrunk on-device) and typical PDFs fit comfortably.
//   - Local disk under UPLOAD_DIR as the last resort (dev without any
//     database). Flat UUID filenames served by /api/files/[key].

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "var/uploads";

function uploadRoot(): string {
  return path.resolve(process.cwd(), UPLOAD_DIR);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/html": ".html",
  "text/plain": ".txt",
};

export type StoredFile = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

// Thrown when a deployment has nowhere durable to put a file — no Blob
// store, and the database write failed too. The API layer maps this to a 503
// whose message names the real problem, instead of a generic transfer error.
export class StorageNotConnectedError extends Error {
  constructor() {
    super(
      "Nowhere to store the file: no Blob store is connected and the database write failed. Check the Vercel project's Storage tab.",
    );
    this.name = "StorageNotConnectedError";
  }
}

// Serving a DB-stored file goes through a serverless response (capped around
// 4.5 MB on Vercel), so refuse anything we could store but never hand back.
export const MAX_DB_FILE_BYTES = 4 * 1024 * 1024;

// Core writer — used by browser uploads and by the inbound-email webhook
// (which already holds decoded Buffers, not File objects).
export async function saveBuffer(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
): Promise<StoredFile> {
  const type = mimeType || "application/octet-stream";
  const name = fileName || "upload";
  const ext = EXT_BY_MIME[type] ?? path.extname(name).slice(0, 10) ?? "";
  const generatedName = `${crypto.randomUUID()}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(`receipts/${generatedName}`, bytes, {
        access: "public",
        contentType: type,
        // A hung storage write must fail in bounded time — the serverless
        // function only lives 30s, and the caller has fallbacks.
        abortSignal: AbortSignal.timeout(20_000),
      });
      return { storageKey: blob.url, fileName: name, mimeType: type, fileSize: bytes.byteLength };
    } catch (e) {
      console.error("[storage] blob write failed, falling back:", e);
    }
  }

  // No Blob store (or it failed): keep the original in the database, which
  // every deployment of this app has by definition.
  if (bytes.byteLength <= MAX_DB_FILE_BYTES) {
    try {
      const row = await prisma.storedFile.create({
        data: { fileName: name, mimeType: type, size: bytes.byteLength, data: new Uint8Array(bytes) },
        select: { id: true },
      });
      return {
        storageKey: `db:${row.id}`,
        fileName: name,
        mimeType: type,
        fileSize: bytes.byteLength,
      };
    } catch (e) {
      console.error("[storage] database write failed, falling back:", e);
    }
  }

  // Last resort: local disk. Read-only on Vercel, so there it's a hard stop.
  if (process.env.VERCEL) throw new StorageNotConnectedError();
  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(path.join(uploadRoot(), generatedName), bytes);
  return { storageKey: generatedName, fileName: name, mimeType: type, fileSize: bytes.byteLength };
}

export async function saveUpload(file: File): Promise<StoredFile> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return saveBuffer(bytes, file.name, file.type);
}

// Resolve a stored key to something an <img src> / link can use.
//
// Blob-backed documents are deliberately NOT linked directly: their public
// URL would end up in browser history, screenshots and share sheets, and
// anyone holding it could read a financial document without signing in.
// Everything is routed through /api/files instead, which sits behind the
// login gate and fetches the blob server-side.
export function fileSrc(storageKey: string): string {
  return storageKey.startsWith("http")
    ? `/api/files/remote?k=${encodeURIComponent(storageKey)}`
    : `/api/files/${storageKey}`;
}

// Only our own blob store may be proxied — without this check the proxy
// would be an open SSRF relay.
export function isOwnBlobUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".public.blob.vercel-storage.com") ||
        url.hostname.endsWith(".blob.vercel-storage.com"))
    );
  } catch {
    return false;
  }
}

// Local-disk keys are single flat server-generated filenames; reject anything
// else so the file-serving route can never traverse outside the upload dir.
export function isSafeStorageKey(key: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9]{1,10})?$/.test(key);
}

export async function readUpload(storageKey: string): Promise<Buffer | null> {
  if (!isSafeStorageKey(storageKey)) return null;
  try {
    return await readFile(path.join(uploadRoot(), storageKey));
  } catch {
    return null;
  }
}
