// Session tokens, shared by middleware (Edge runtime) and the login/signup
// actions (Node runtime) — Web Crypto only, no Node imports.
//
// Two formats are valid at once:
//   • v2 (multi-user): "2.<accountId>.<expiresEpochSeconds>.<hmacHex>",
//     signed with HMAC-SHA256 so the account id can't be forged.
//   • legacy (pre-multi-user): the bare SHA-256 owner token. Every device
//     that signed in before the upgrade holds one; it resolves to the owner
//     account so nobody gets logged out by the migration.

export const SESSION_COOKIE = "to_owner";
export const OWNER_ACCOUNT_ID = "owner";
const SESSION_DAYS = 30;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The legacy owner token (unchanged bytes — existing cookies keep working).
export async function sessionTokenFor(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${password}:twin-oaks-cookie-v1`));
  return toHex(digest);
}

// Signing secret: SESSION_SECRET when set, else derived from APP_PASSWORD so
// no new env var is required. Deterministic per deployment config.
async function signingKey(): Promise<CryptoKey> {
  const base =
    process.env.SESSION_SECRET ||
    (process.env.APP_PASSWORD ? `derived:${process.env.APP_PASSWORD}` : "twin-oaks-dev-secret");
  const keyBytes = await crypto.subtle.digest("SHA-256", enc.encode(`twin-oaks-session-v2:${base}`));
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionValue(accountId: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const payload = `${accountId}.${expires}`;
  const sig = toHex(await crypto.subtle.sign("HMAC", await signingKey(), enc.encode(payload)));
  return `2.${payload}.${sig}`;
}

/** Cookie value → accountId, or null when invalid/expired. */
export async function verifySessionValue(value: string | undefined): Promise<string | null> {
  if (!value) return null;

  if (value.startsWith("2.")) {
    const parts = value.split(".");
    if (parts.length !== 4) return null;
    const [, accountId, expiresRaw, sig] = parts;
    const expires = Number(expiresRaw);
    if (!accountId || !Number.isFinite(expires)) return null;
    if (expires * 1000 < Date.now()) return null;
    const ok = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      hexToBytes(sig),
      enc.encode(`${accountId}.${expires}`),
    );
    return ok ? accountId : null;
  }

  // Legacy owner token.
  const password = process.env.APP_PASSWORD;
  if (password && value === (await sessionTokenFor(password))) return OWNER_ACCOUNT_ID;
  return null;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return new Uint8Array(new ArrayBuffer(0));
  }
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * SESSION_DAYS,
  path: "/",
};
