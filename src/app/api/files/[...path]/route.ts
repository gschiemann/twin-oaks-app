import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  // Stored email bodies (forwarded receipts) — see the CSP note below.
  ".html": "text/html",
  ".txt": "text/plain; charset=utf-8",
};

// Stored files can be attacker-influenced (anyone who can email the inbound
// address supplies the HTML body). `sandbox` drops the response into an
// opaque origin so its scripts can never touch this app's session; nosniff
// stops a .txt being re-interpreted as markup.
const SAFETY_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "Content-Security-Policy":
    "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // Storage keys are single flat segments — anything deeper is invalid.
  const key = path.length === 1 ? decodeURIComponent(path[0]) : "";

  // Database-stored originals ("db:<id>" — the no-Blob-store fallback).
  if (key.startsWith("db:")) {
    const id = key.slice(3);
    if (!/^[a-z0-9]{10,40}$/i.test(id)) return new Response("Not found", { status: 404 });
    const row = await prisma.storedFile
      .findUnique({ where: { id } })
      .catch(() => null);
    if (!row) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(row.data), {
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        ...SAFETY_HEADERS,
      },
    });
  }

  const buf = key ? await readUpload(key) : null;
  if (!buf) return new Response("Not found", { status: 404 });

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      ...SAFETY_HEADERS,
    },
  });
}
