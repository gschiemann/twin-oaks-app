// Face ID / Touch ID sign-in (SPEC §32) via WebAuthn passkeys.
//
// Design notes that matter:
// • Passkeys are ADDITIVE. The owner password in APP_PASSWORD always keeps
//   working, so a lost, wiped or upgraded phone can never lock the owner out
//   of their own books. Never make a passkey the only way in.
// • The one-time challenge lives in a short-lived httpOnly cookie instead of
//   server state: the app runs on serverless instances that share no memory,
//   and the browser cannot read or forge an httpOnly value.
// • rpID/origin are derived from the incoming request so the same code works
//   on localhost, on *.vercel.app, and on a custom domain later.

import { cookies, headers } from "next/headers";

export const CHALLENGE_COOKIE = "to_wa_challenge";

export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // rpID is a domain, never host:port.
  const rpID = host.split(":")[0];
  return { rpID, origin: `${proto}://${host}` };
}

export async function setChallenge(challenge: string): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300, // 5 minutes — a ceremony that stalls longer should restart
  });
}

export async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value ?? null;
  // Single use: clear it whether or not verification ends up succeeding.
  store.delete(CHALLENGE_COOKIE);
  return value;
}
