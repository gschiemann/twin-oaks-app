"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function deletePasskey(formData: FormData) {
  const id = formData.get("id");
  if (typeof id === "string" && id) {
    await prisma.passkey.delete({ where: { id } }).catch(() => {});
  }
  revalidatePath("/settings/passkeys");
  redirect("/settings/passkeys");
}
