import Link from "next/link";
import { Card, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { signup } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  closed: "Sign-ups are closed on this deployment.",
  name: "Enter your business (or your own) name.",
  email: "That email doesn't look right.",
  password: "Password needs at least 8 characters.",
  exists: "That email already has an account — sign in instead.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-6 text-center">
        <p className="display-serif text-3xl font-bold text-stone-900">Run your business</p>
        <p className="mt-2 text-sm text-stone-500">
          Receipts, expenses, invoices, payments and mileage — from your phone. Built for small
          operations: services, farms, side businesses.
        </p>
      </div>
      <Card>
        <form action={signup} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="name">
              Business name
            </label>
            <input
              id="name"
              name="name"
              required
              autoFocus
              placeholder="Sarah’s Sitting"
              autoComplete="organization"
              className={inputCls}
            />
          </div>
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
            <label className={labelCls} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>
          </div>
          {error ? (
            <p className="text-sm font-medium text-red-600">
              {ERRORS[error] ?? "Something went wrong — try again."}
            </p>
          ) : null}
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Create account
          </button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-stone-500">
        Already have one?{" "}
        <Link href="/login" className="font-semibold text-oak-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
