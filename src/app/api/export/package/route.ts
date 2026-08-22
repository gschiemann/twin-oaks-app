// GET /api/export/package?year=YYYY  → the accountant's ZIP (SPEC §28).
// GET /api/export/package?year=YYYY&info=1 → JSON preflight for the UI.
//
// This is the single biggest download the app produces: a whole tax year of
// books plus every receipt original. See src/lib/tax-package.ts for how it is
// streamed and how the size/time budgets degrade gracefully.

import { currentAccountId } from "@/lib/auth";
import {
  createTaxPackageStream,
  taxPackageFileName,
  taxPackagePreflight,
} from "@/lib/tax-package";

export const dynamic = "force-dynamic";
// Reading blobs and Prisma rows — not Edge.
export const runtime = "nodejs";
// Matches the longest-running route in the app (/api/cron/backup). The
// library's own time budget sits below this so the index, the README and the
// zip's central directory always get written before the platform cuts us off.
// On a plan that allows 300s, raise BOTH this and TAX_PACKAGE_TIME_BUDGET_MS.
export const maxDuration = 60;

export async function GET(req: Request) {
  // Same gate as every other export route: a session, and everything scoped
  // to that one accountId. This response is the account's entire financial
  // history — it must never be reachable without signing in.
  const accountId = await currentAccountId();
  if (!accountId) return new Response("Sign in first.", { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1990 || year > 2200) {
    return new Response("Bad year", { status: 400 });
  }

  // Preflight: metadata only, no file bytes read. Lets the Tax Center warn
  // "412 files, about 180 MB" before a farmer taps this on cell service.
  if (url.searchParams.get("info") === "1") {
    const info = await taxPackagePreflight(accountId, year);
    return new Response(JSON.stringify(info), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const { stream, filename } = createTaxPackageStream(accountId, year);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${taxPackageFileName(year)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Financial records: never cached by a proxy, never revalidated stale.
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      // Ask any intermediary not to buffer the whole archive before
      // forwarding it — the point of streaming is a fast first byte.
      "X-Accel-Buffering": "no",
    },
  });
}
