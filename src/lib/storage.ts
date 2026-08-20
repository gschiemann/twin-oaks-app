// File storage abstraction — callers only deal in storage keys/URLs.
//
// Two backends, auto-selected:
//   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production on Vercel).
//     saveUpload returns the blob's full https URL as the storage key.
//     Blob URLs are unguessable-random; true private object storage is a
//     planned upgrade (docs/ROADMAP.md).
//   - Local disk under UPLOAD_DIR otherwise (dev). saveUpload returns a flat
//     UUID filename served by /api/files/[key] (behind the login gate).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

// Thrown when a deployment has nowhere durable to put a file: on Vercel the
// filesystem is read-only, so without a connected Blob store there is no
// storage at all. The API layer maps this to a 503 whose message names the
// real problem, instead of the generic "didn't come through".
export class StorageNotConnectedError extends Error {
  constructor() {
    super(
      "File storage isn't connected on this deployment — in Vercel open the project → Storage → connect the Blob store to all environments, then redeploy.",
    );
    this.name = "StorageNotConnectedError";
  }
}

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
        // function only lives 30s, and the caller has a disk fallback.
        abortSignal: AbortSignal.timeout(20_000),
      });
      return { storageKey: blob.url, fileName: name, mimeType: type, fileSize: bytes.byteLength };
    } catch (e) {
      // On Vercel there is no disk to fall back to — surface the real cause.
      if (process.env.VERCEL) {
        throw new Error(
          `Blob storage rejected the file: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      console.error("[storage] blob write failed, using local disk instead:", e);
    }
  } else if (process.env.VERCEL) {
    throw new StorageNotConnectedError();
  }

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
