// Server-side account helpers (Node runtime — pages, actions, API routes).
//
// The middleware has already gated every request, so by the time a page or
// action runs there IS a valid session — requireAccountId() re-verifies and
// hands back which account it belongs to. Every database query in the app
// scopes on that id explicitly; scoping is never implicit.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  OWNER_ACCOUNT_ID,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSessionValue,
  verifySessionValue,
} from "@/lib/session";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export { OWNER_ACCOUNT_ID };

export async function currentAccountId(): Promise<string | null> {
  // Gate disabled (local dev without APP_PASSWORD): single-user owner mode.
  if (!process.env.APP_PASSWORD) return OWNER_ACCOUNT_ID;
  const store = await cookies();
  return verifySessionValue(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in account, or a redirect to /login. Use at the top of every
 *  page and server action that touches records. */
export async function requireAccountId(): Promise<string> {
  const id = await currentAccountId();
  if (!id) redirect("/login");
  return id;
}

export async function startSession(accountId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionValue(accountId), SESSION_COOKIE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Password hashing — scrypt from node:crypto (no native-module dependency).
// Format: "s1$<saltBase64>$<hashBase64>".
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "s1" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
    return expected.length > 0 && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
