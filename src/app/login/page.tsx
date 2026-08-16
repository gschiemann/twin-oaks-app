import { Card, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import PasskeySignIn from "@/components/PasskeySignIn";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Only offer Face ID when a passkey actually exists. A database that is
  // unreachable must never block the password form — that is the fallback.
  let hasPasskey = false;
  try {
    const db = await ensureSchema();
    if (db.ok) hasPasskey = (await prisma.passkey.count()) > 0;
  } catch {
    hasPasskey = false;
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/twin-oaks-logo.png"
          alt="Twin Oaks Farm & Tech"
          className="mx-auto h-20 w-auto"
        />
        <p className="eyebrow mt-3">Owner sign-in</p>
      </div>
      {hasPasskey ? <PasskeySignIn /> : null}
      <Card>
        <form action={login} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className={inputCls}
            />
            {error ? (
              <p className="mt-1 text-sm font-medium text-red-600">
                Wrong password — try again.
              </p>
            ) : null}
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Sign in
          </button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-stone-400">
        30-day session on this device. Face ID / passkeys planned.
      </p>
    </div>
  );
}
