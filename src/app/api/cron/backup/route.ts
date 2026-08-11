// Nightly automatic backup (SPEC §32). Invoked by the Vercel cron declared
// in vercel.json.
//
// PUBLIC by necessity — cron requests carry no session — so it is exempted
// in middleware and authenticated with CRON_SECRET, which Vercel sends as
// `Authorization: Bearer <CRON_SECRET>` whenever that env var exists. If the
// variable is not set the endpoint refuses to run rather than leaving an
// unauthenticated database-dump trigger exposed.

import { writeBackupToBlob } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not set — automatic backups are disabled." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await writeBackupToBlob();
    if (!result) {
      return Response.json(
        { ok: false, error: "Blob storage is not configured." },
        { status: 503 },
      );
    }
    console.log(`[backup] wrote ${result.bytes} bytes`);
    return Response.json({ ok: true, bytes: result.bytes });
  } catch (e) {
    console.error("[backup] failed:", e);
    return Response.json({ ok: false, error: "Backup failed." }, { status: 500 });
  }
}
