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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // Storage keys are single flat UUID filenames — anything deeper is invalid.
  const key = path.length === 1 ? path[0] : "";
  const buf = key ? await readUpload(key) : null;
  if (!buf) return new Response("Not found", { status: 404 });

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      // Stored files can be attacker-influenced (anyone who can email the
      // inbound address supplies the HTML body). `sandbox` drops the response
      // into an opaque origin so its scripts can never touch this app's
      // session; nosniff stops a .txt being re-interpreted as markup.
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
