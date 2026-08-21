"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { saveUpload } from "@/lib/storage";
import { RECEIPT_STATUSES } from "@/lib/domain";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// SPEC §§3–4: a receipt can be saved instantly (photo → Inbox) and
// categorized later, so nothing gets lost on a busy day.
export async function createReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const file = formData.get("file");
  let fileMeta: Awaited<ReturnType<typeof saveUpload>> | null = null;
  if (file instanceof File && file.size > 0) {
    fileMeta = await saveUpload(file, accountId);
  }

  const receipt = await prisma.receipt.create({
    data: {
      accountId,
      status: "INBOX",
      filePath: fileMeta?.storageKey ?? null,
      fileName: fileMeta?.fileName ?? null,
      mimeType: fileMeta?.mimeType ?? null,
      fileSize: fileMeta?.fileSize ?? null,
      vendorName: str(formData.get("vendorName")),
      receiptDate: parseDateInput(formData.get("receiptDate")),
      totalCents: parseDollarsToCents(formData.get("total")),
      salesTaxCents: parseDollarsToCents(formData.get("salesTax")),
      paymentMethod: str(formData.get("paymentMethod")),
      receiptNumber: str(formData.get("receiptNumber")),
      notes: str(formData.get("notes")),
    },
  });

  redirect(`/receipts/${receipt.id}`);
}

export async function updateReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");

  const status = str(formData.get("status"));
  await prisma.receipt.updateMany({
    where: { id, accountId },
    data: {
      vendorName: str(formData.get("vendorName")),
      receiptDate: parseDateInput(formData.get("receiptDate")),
      totalCents: parseDollarsToCents(formData.get("total")),
      salesTaxCents: parseDollarsToCents(formData.get("salesTax")),
      paymentMethod: str(formData.get("paymentMethod")),
      receiptNumber: str(formData.get("receiptNumber")),
      notes: str(formData.get("notes")),
      ...(status && (RECEIPT_STATUSES as readonly string[]).includes(status)
        ? { status }
        : {}),
    },
  });

  // Back to the list, not the same page — "it just sits there" reads as the
  // save having done nothing. The list shows a saved note via ?saved=1.
  redirect("/receipts?updated=1");
}

// Attach a photo/PDF to an existing receipt record (e.g. emailed receipt
// added after the fact). Originals are permanently stored — receipts are
// archived, never deleted (SPEC §1).
export async function attachReceiptFile(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");
  const file = formData.get("file");
  // A file that arrives with zero bytes is an iCloud item the device never
  // actually downloaded — say so instead of silently attaching nothing.
  if (file instanceof File && file.name && file.size === 0) {
    redirect(`/receipts/${id}?attach=empty`);
  }
  if (file instanceof File && file.size > 0) {
    const meta = await saveUpload(file, accountId);
    await prisma.receipt.updateMany({
      where: { id, accountId },
      data: {
        filePath: meta.storageKey,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        fileSize: meta.fileSize,
      },
    });
  }
  redirect(`/receipts/${id}`);
}
