// Public liveness + version marker (no data, no auth — excluded from the
// login gate in src/middleware.ts). Lets deploys be verified externally.

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    app: "twin-oaks-os",
    phase: "v4.3.1-ocr",
    // Which file backend this deployment runs with (true = Blob store
    // connected; false = database fallback). Boolean only — never the token.
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    time: new Date().toISOString(),
  });
}
