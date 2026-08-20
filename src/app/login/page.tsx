import Link from "next/link";
import { Card, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import PasskeySignIn from "@/components/PasskeySignIn";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { login, loginWithEmail } from "./actions";

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
            {error === "1" ? (
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
      <div className="my-5 flex items-center gap-3 text-xs text-stone-400">
        <span className="h-px flex-1 bg-stone-200" />
        or with an email account
        <span className="h-px flex-1 bg-stone-200" />
      </div>

      <Card>
        <form action={loginWithEmail} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="epassword">
              Password
            </label>
            <input
              id="epassword"
              name="epassword"
              type="password"
              required
              autoComplete="current-password"
              className={inputCls}
            />
            {error === "email" ? (
              <p className="mt-1 text-sm font-medium text-red-600">
                Wrong email or password — try again.
              </p>
            ) : null}
          </div>
          <button type="submit" className={`${btnSecondaryCls} w-full`}>
            Sign in with email
          </button>
        </form>
      </Card>

      <Link href="/signup" className="mt-4 block text-center text-sm font-semibold text-oak-700">
        New here? Create an account →
      </Link>
      <p className="mt-3 text-center text-xs text-stone-400">30-day session on this device.</p>
    </div>
  );
}
