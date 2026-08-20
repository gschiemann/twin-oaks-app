// Public liveness + version marker (no data, no auth — excluded from the
// login gate in src/middleware.ts). Lets deploys be verified externally.

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    app: "twin-oaks-os",
    phase: "v3.5-scan",
    time: new Date().toISOString(),
  });
}
