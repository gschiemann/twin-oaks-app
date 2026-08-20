"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";

export async function deletePasskey(formData: FormData) {
  const accountId = await requireAccountId();
  const id = formData.get("id");
  if (typeof id === "string" && id) {
    await prisma.passkey.deleteMany({ where: { id, accountId } }).catch(() => {});
  }
  revalidatePath("/settings/passkeys");
  redirect("/settings/passkeys");
}
