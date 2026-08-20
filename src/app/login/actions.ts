"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { OWNER_ACCOUNT_ID, startSession, verifyPassword } from "@/lib/auth";

// The original Twin Oaks sign-in — APP_PASSWORD, exactly as before. It now
// mints a v2 session bound to the owner account (old cookies stay valid too).
export async function login(formData: FormData) {
  const password = process.env.APP_PASSWORD;
  const attempt = formData.get("password");

  if (!password || typeof attempt !== "string" || attempt !== password) {
    redirect("/login?error=1");
  }

  await startSession(OWNER_ACCOUNT_ID);
  redirect("/");
}

// Email + password sign-in for every other account.
export async function loginWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("epassword") ?? "");
  if (!email || !password) redirect("/login?error=email");

  const account = await prisma.account
    .findUnique({ where: { email }, select: { id: true, passwordHash: true } })
    .catch(() => null);
  // Empty hash = env-password-only account (the owner) — email login refuses
  // it, so knowing the owner's email alone opens nothing.
  if (!account || !account.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
    redirect("/login?error=email");
  }

  await startSession(account.id);
  redirect("/");
}
