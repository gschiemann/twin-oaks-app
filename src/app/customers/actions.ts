"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { TAX_TREATMENTS } from "@/lib/tax";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function customerDataFromForm(formData: FormData) {
  const name = str(formData.get("name"));
  if (!name) return null;

  const treatment = str(formData.get("taxTreatment"));
  const taxTreatment =
    treatment && (TAX_TREATMENTS as readonly string[]).includes(treatment)
      ? treatment
      : "DEFAULT";
  const rateRaw = str(formData.get("taxRatePercent"));
  const rate = rateRaw != null && Number.isFinite(Number(rateRaw)) ? Number(rateRaw) : null;

  return {
    name,
    company: str(formData.get("company")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
    address: str(formData.get("address")),
    notes: str(formData.get("notes")),
    taxTreatment,
    // Only meaningful for RATE; kept as typed so switching back and forth
    // doesn't lose the number the operator looked up.
    taxRatePercent: rate != null ? Math.max(0, Math.min(100, rate)) : null,
    taxExemptReason: str(formData.get("taxExemptReason")),
  };
}

export async function createCustomer(formData: FormData) {
  const data = customerDataFromForm(formData);
  if (!data) redirect("/customers/new?error=missing");
  const customer = await prisma.customer.create({ data });

  // Entering a customer mid-invoice? Bounce straight back into that flow.
  const returnTo = str(formData.get("returnTo"));
  redirect(returnTo === "invoice" ? "/invoices/new" : `/customers/${customer.id}`);
}

export async function updateCustomer(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/customers");
  const data = customerDataFromForm(formData);
  if (!data) redirect(`/customers/${id}/edit?error=missing`);
  await prisma.customer.update({ where: { id }, data });
  redirect(`/customers/${id}`);
}

// Customers with invoices are financial history — they can't be deleted.
export async function deleteCustomer(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/customers");
  const invoiceCount = await prisma.invoice.count({ where: { customerId: id } });
  if (invoiceCount > 0) redirect(`/customers/${id}?error=has-invoices`);
  await prisma.customer.delete({ where: { id } });
  redirect("/customers");
}
