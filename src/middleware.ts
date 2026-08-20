import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// Login gate (SPEC §32). When APP_PASSWORD is set, every route except the
// public ones below requires a valid session cookie — either the legacy
// owner token (pre-multi-user devices) or a signed v2 account session.
// When unset (local dev), the gate is disabled.

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const accountId = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value);
  if (accountId) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Exempt paths, and why each one has to be public:
// • api/inbound      — email providers POST without a session; that route
//                      authenticates itself with a shared secret.
// • api/passkeys/auth — this is how you OBTAIN a session (Face ID sign-in);
//                      it trusts nothing but a signature over a server-issued
//                      challenge. Enrollment (api/passkeys/register) stays
//                      gated, so new keys can only be added while signed in.
// • api/cron        — Vercel's scheduler carries no session; that route
//                      authenticates with CRON_SECRET.
// • manifest/icons   — fetched by iOS when installing to the home screen.
// • brand/           — the logo, which the SIGN-IN page itself renders, so it
//                      has to load before anyone is signed in. Static brand
//                      art only; never put customer files under this path.
// (signup is public by definition — it's how a new account comes to exist.)
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|signup|brand/|api/health|api/inbound|api/passkeys/auth|api/cron|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
