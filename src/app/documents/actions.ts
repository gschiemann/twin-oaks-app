"use server";

import { revalidatePath } from "next/cache";
import { requireAccountId } from "@/lib/auth";
import { deleteDocument, ownerHref } from "@/lib/documents";

// Remove one attached file. The account comes from the session, never the
// form, and deleteDocument() scopes the delete on it — a posted id from
// another account's books removes nothing.
export async function removeDocument(formData: FormData) {
  const accountId = await requireAccountId();
  const id = typeof formData.get("id") === "string" ? String(formData.get("id")) : "";
  const ownerType = String(formData.get("ownerType") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");

  if (id) await deleteDocument(accountId, id);

  // Refresh the page the card is sitting on, plus the all-documents list.
  if (ownerType && ownerId) revalidatePath(ownerHref(ownerType, ownerId));
  revalidatePath("/documents");
}
