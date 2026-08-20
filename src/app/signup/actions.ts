"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { ensureSchema } from "@/lib/ensure-schema";

// Creates a new business account. Public by definition; set
// ALLOW_SIGNUPS="false" to close the door once everyone who needs an
// account has one.
export async function signup(formData: FormData) {
  if (process.env.ALLOW_SIGNUPS === "false") redirect("/signup?error=closed");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (name.length < 2 || name.length > 80) redirect("/signup?error=name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/signup?error=email");
  if (password.length < 8) redirect("/signup?error=password");

  await ensureSchema();

  const existing = await prisma.account.findUnique({ where: { email }, select: { id: true } });
  if (existing) redirect("/signup?error=exists");

  const passwordHash = await hashPassword(password);
  const account = await prisma.account.create({
    data: { email, name, passwordHash },
    select: { id: true },
  });
  // One profile per account, created up front so every document has a
  // business block from day one. GENERAL = no division picker anywhere.
  await prisma.businessProfile.create({
    data: {
      accountId: account.id,
      name,
      email,
      divisionsCsv: "GENERAL",
      defaultTaxRatePercent: 0,
    },
  });

  await startSession(account.id);
  redirect("/");
}
