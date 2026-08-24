"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { saveUpload } from "@/lib/storage";
import { RECEIPT_STATUSES } from "@/lib/domain";
import { normalizeAccountingCategory, parseQuantity } from "./receipt-lines";

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

// ———————————————————————————————————————————————————————————————————————
// FR-006 — itemised receipt lines.
//
// A line is worth nothing on its own; it belongs to a receipt, and a receipt
// belongs to an account. So every one of these actions proves the receipt is
// THIS account's before it writes, and every write is scoped by accountId as
// well — a line can never be attached to, edited on, or removed from someone
// else's receipt even if the id is guessed.
// ———————————————————————————————————————————————————————————————————————

/** The receipt id, but only if this account owns it. */
async function ownedReceiptId(accountId: string, receiptId: string): Promise<string | null> {
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, accountId },
    select: { id: true },
  });
  return receipt?.id ?? null;
}

/** A rejected line save goes back to the receipt with a plain reason (the save
 *  rule: never a silent blank form).
 *
 *  `carryTyped` is for the add-a-line form only — its values live nowhere else,
 *  so they ride back in the URL. An edit is different: nothing was written, so
 *  that line's box still shows its saved values and handing typed text back
 *  would drop it into the wrong form. */
function lineBounce(receiptId: string, formData: FormData, carryTyped: boolean): string {
  const back = new URLSearchParams({ error: "missing" });
  if (carryTyped) {
    for (const [key, field] of [
      ["ld", "description"],
      ["lq", "quantity"],
      ["la", "amount"],
      ["lc", "accountingCategory"],
    ]) {
      const value = str(formData.get(field));
      if (value) back.set(key, value.slice(0, 200));
    }
  }
  return `/receipts/${receiptId}?${back.toString()}`;
}

export async function addReceiptLine(formData: FormData) {
  const accountId = await requireAccountId();
  const receiptId = str(formData.get("receiptId"));
  if (!receiptId) redirect("/receipts");
  if (!(await ownedReceiptId(accountId, receiptId))) redirect("/receipts");

  const description = str(formData.get("description"));
  const amountCents = parseDollarsToCents(formData.get("amount"));
  if (!description || amountCents == null) redirect(lineBounce(receiptId, formData, true));

  // New lines land at the bottom, in the order they were typed.
  const last = await prisma.receiptLine.aggregate({
    where: { receiptId, accountId },
    _max: { sortOrder: true },
  });

  await prisma.receiptLine.create({
    data: {
      accountId,
      receiptId,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
      description,
      quantity: parseQuantity(formData.get("quantity")),
      amountCents,
      accountingCategory: normalizeAccountingCategory(str(formData.get("accountingCategory"))),
    },
  });

  // Stay on the receipt: itemising is a run of small edits, and the line
  // appearing in the list above is the confirmation.
  redirect(`/receipts/${receiptId}`);
}

export async function updateReceiptLine(formData: FormData) {
  const accountId = await requireAccountId();
  const receiptId = str(formData.get("receiptId"));
  const lineId = str(formData.get("lineId"));
  if (!receiptId || !lineId) redirect("/receipts");
  if (!(await ownedReceiptId(accountId, receiptId))) redirect("/receipts");

  const description = str(formData.get("description"));
  const amountCents = parseDollarsToCents(formData.get("amount"));
  // Nothing was written, so the box still shows the saved values — the bounce
  // only has to explain why.
  if (!description || amountCents == null) redirect(lineBounce(receiptId, formData, false));

  await prisma.receiptLine.updateMany({
    where: { id: lineId, accountId, receiptId },
    data: {
      description,
      quantity: parseQuantity(formData.get("quantity")),
      amountCents,
      accountingCategory: normalizeAccountingCategory(str(formData.get("accountingCategory"))),
    },
  });

  redirect(`/receipts/${receiptId}`);
}

export async function removeReceiptLine(formData: FormData) {
  const accountId = await requireAccountId();
  const receiptId = str(formData.get("receiptId"));
  const lineId = str(formData.get("lineId"));
  if (!receiptId || !lineId) redirect("/receipts");

  // A line is typed-in detail, not the document: removing one never touches
  // the receipt or its original file (SPEC §1 — receipts are permanent).
  await prisma.receiptLine.deleteMany({ where: { id: lineId, accountId, receiptId } });
  redirect(`/receipts/${receiptId}`);
}

// SPEC §4 — the operator agreed this receipt is one they already have.
// Archiving is the ONLY action a duplicate warning offers: the record and its
// original stay forever, the status changes, and it drops out of the Inbox
// (and out of future duplicate warnings).
export async function archiveDuplicateReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");

  await prisma.receipt.updateMany({ where: { id, accountId }, data: { status: "ARCHIVED" } });
  redirect("/receipts?archived=1");
}

// Archive from anywhere, not just the duplicate warning. This is the SAFE
// way to get a receipt out of the way: nothing is destroyed, and it can be
// found again under the All tab.
export async function archiveReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");

  await prisma.receipt.updateMany({ where: { id, accountId }, data: { status: "ARCHIVED" } });
  redirect("/receipts?archived=1");
}

// Put an archived receipt back where it was, so archiving is never a
// one-way door.
export async function unarchiveReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");

  // Back to the Inbox unless it is already accounted for by an expense.
  const receipt = await prisma.receipt.findFirst({
    where: { id, accountId },
    select: { expenseId: true },
  });
  await prisma.receipt.updateMany({
    where: { id, accountId },
    data: { status: receipt?.expenseId ? "CATEGORIZED" : "INBOX" },
  });
  redirect(`/receipts/${id}`);
}

// Delete a receipt for good, original and all.
//
// This is the one action in the receipts module that destroys something, so
// it is deliberately two-step (the page asks first) and it cleans up after
// itself: a database-stored original is a row we own, and leaving it behind
// would quietly keep using space the operator thinks they freed.
//
// What it does NOT do: touch the expense this receipt documents. The money
// was really spent — deleting the paperwork must never silently rewrite the
// books. The expense simply goes back to having no receipt attached, which
// the dashboard already counts as "missing documentation".
export async function deleteReceipt(formData: FormData) {
  const accountId = await requireAccountId();
  const id = str(formData.get("id"));
  if (!id) redirect("/receipts");

  // Read the storage key first (scoped), so we know what to clean up.
  const receipt = await prisma.receipt.findFirst({
    where: { id, accountId },
    select: { id: true, filePath: true },
  });
  if (!receipt) redirect("/receipts");

  // Lines are removed explicitly rather than relying on the cascade, so the
  // behaviour is identical whichever database this runs on.
  await prisma.receiptLine.deleteMany({ where: { receiptId: id, accountId } });
  const removed = await prisma.receipt.deleteMany({ where: { id, accountId } });
  if (removed.count === 0) redirect("/receipts");

  // Database-backed originals ("db:<id>") are rows we own — drop the bytes
  // once nothing else points at the same key.
  if (receipt.filePath?.startsWith("db:")) {
    const storedFileId = receipt.filePath.slice(3);
    const [otherReceipts, otherDocs] = await Promise.all([
      prisma.receipt.count({ where: { accountId, filePath: receipt.filePath } }),
      prisma.document.count({ where: { accountId, filePath: receipt.filePath } }),
    ]);
    if (otherReceipts === 0 && otherDocs === 0) {
      await prisma.storedFile.deleteMany({ where: { id: storedFileId, accountId } });
    }
  }

  redirect("/receipts?deleted=1");
}
