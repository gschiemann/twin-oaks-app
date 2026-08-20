import { buildBackup } from "@/lib/backup";
import { currentAccountId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// SPEC §32: export/backup capability — never rely on one copy of anything.
// Full JSON dump of every table (file originals live in blob/upload storage;
// their storage keys are included here). The nightly automatic backup writes
// the same payload — see src/lib/backup.ts.
export async function GET() {
  const accountId = await currentAccountId();
  if (!accountId) return new Response("Sign in first.", { status: 401 });
  // Scoped to the signed-in business — an export only ever contains your own books.
  const backup = await buildBackup(accountId);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="twin-oaks-backup-${date}.json"`,
    },
  });
}
