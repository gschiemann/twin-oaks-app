import { buildBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

// SPEC §32: export/backup capability — never rely on one copy of anything.
// Full JSON dump of every table (file originals live in blob/upload storage;
// their storage keys are included here). The nightly automatic backup writes
// the same payload — see src/lib/backup.ts.
export async function GET() {
  const backup = await buildBackup();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="twin-oaks-backup-${date}.json"`,
    },
  });
}
