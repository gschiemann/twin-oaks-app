"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput, taxYearOf } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { ALL_DIVISIONS, INCOME_CATEGORIES } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function incomeDataFromForm(formData: FormData) {
  const date = parseDateInput(formData.get("date")) ?? new Date();
  const amountCents = parseDollarsToCents(formData.get("amount"));
  const description = str(formData.get("description"));
  const division = str(formData.get("division"));
  const category = str(formData.get("category"));

  if (amountCents == null || !description) return null;
  if (!division || !(ALL_DIVISIONS as readonly string[]).includes(division)) return null;
  if (!category || !(INCOME_CATEGORIES as readonly string[]).includes(category)) return null;

  return {
    date,
    taxYear: taxYearOf(date),
    amountCents,
    description,
    division,
    category,
    source: str(formData.get("source")),
    paymentMethod: str(formData.get("paymentMethod")),
    notes: str(formData.get("notes")),
  };
}

export async function createIncome(formData: FormData) {
  const accountId = await requireAccountId();
  const data = incomeDataFromForm(formData);
  if (!data) redirect("/income/new?error=missing");
  await prisma.income.create({ data: { ...data, accountId } });
  redirect("/income");
}

export async function updateIncome(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/income");
  const data = incomeDataFromForm(formData);
  if (!data) redirect(`/income/${id}?error=missing`);
  await prisma.income.updateMany({ where: { id, accountId }, data });
  redirect("/income");
}

export async function deleteIncome(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (id) await prisma.income.deleteMany({ where: { id, accountId } });
  redirect("/income");
}
