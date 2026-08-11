// Authenticated proxy for blob-stored documents.
//
// Receipts are financial records, so their URLs must not be independently
// useful: this route sits behind the login gate (middleware) and streams the
// document from our blob store, keeping the underlying public URL out of the
// browser entirely. The host allowlist in isOwnBlobUrl stops the proxy from
// being turned into an SSRF relay.

import { isOwnBlobUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("k");
  if (!key || !isOwnBlobUrl(key)) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await fetch(key, { cache: "no-store" }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      // Same reasoning as the local-disk route: stored documents can be
      // attacker-influenced (anyone who can email the inbound address), so
      // they render in an opaque origin that cannot reach this session.
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
