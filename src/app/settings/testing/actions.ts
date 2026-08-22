"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccountId } from "@/lib/auth";
import { createSampleData, removeSampleData, sampleDataCounts, totalOf } from "@/lib/sample-data";
import { encodeKept } from "./kept-report";

const PAGE = "/settings/testing";

/**
 * One tap. src/lib/sample-data.ts refuses when practice records are already
 * there — it will never quietly add a second set — so the only jobs here are
 * to run it and to come back with a number the banner can say out loud.
 */
export async function addSampleData() {
  const accountId = await requireAccountId();

  let target: string;
  try {
    const result = await createSampleData(accountId);
    target = result.ok
      ? `${PAGE}?added=${result.total}`
      : `${PAGE}?error=${result.reason === "exists" ? "exists" : "failed"}`;
  } catch (e) {
    console.error("[sample-data] add failed:", e);
    target = `${PAGE}?error=failed`;
  }

  // Practice records show up on every screen in the app, not just this one.
  revalidatePath("/", "layout");
  // redirect() throws control-flow, so it must sit outside the try.
  redirect(target);
}

/**
 * Two-step on purpose: the first press only asks, and only the confirmed form
 * carries confirm=yes. Nothing is removed until the operator has seen the two
 * numbers — how many practice records go, and how many of his own stay.
 */
export async function removeAllSampleData(formData: FormData) {
  const accountId = await requireAccountId();

  if (formData.get("confirm") !== "yes") redirect(`${PAGE}?confirm=1`);

  // Already gone (a stale page, a double tap): say so rather than flashing a
  // green "removed 0" banner at him.
  const before = totalOf(await sampleDataCounts(accountId));
  if (before === 0) redirect(`${PAGE}?error=none`);

  let target: string;
  try {
    // Every number in the banner comes from this report — counted by the
    // library after its own sweep, never assumed here.
    const report = await removeSampleData(accountId);
    const params = new URLSearchParams({
      removed: String(report.removedTotal),
      real: String(report.realTotal),
    });
    const kept = encodeKept(report.kept);
    if (kept) params.set("kept", kept);
    target = `${PAGE}?${params.toString()}`;
  } catch (e) {
    console.error("[sample-data] removal failed:", e);
    target = `${PAGE}?error=failed`;
  }

  revalidatePath("/", "layout");
  redirect(target);
}
