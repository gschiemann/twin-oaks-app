"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeBackupToBlob } from "@/lib/backup";

export async function backupNow() {
  let target = "/settings/backups?done=1";
  try {
    const result = await writeBackupToBlob();
    if (!result) target = "/settings/backups?error=blob";
  } catch (e) {
    console.error("[backup] manual backup failed:", e);
    target = "/settings/backups?error=failed";
  }
  // redirect() throws control-flow, so it must sit outside the try.
  revalidatePath("/settings/backups");
  redirect(target);
}
