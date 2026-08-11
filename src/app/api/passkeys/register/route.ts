// Passkey enrollment. Behind the login gate (middleware): you must already
// be signed in with the owner password to add a new way in.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { relyingParty, setChallenge, takeChallenge } from "@/lib/passkey";

export const dynamic = "force-dynamic";

// A single-owner app: one stable user handle keeps the authenticator from
// creating a second credential per enrollment.
const USER_ID = new TextEncoder().encode("twin-oaks-owner");
const USER_NAME = "Twin Oaks owner";

export async function GET() {
  const { rpID } = await relyingParty();
  const existing = await prisma.passkey.findMany({
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: "Twin Oaks OS",
    rpID,
    userID: USER_ID,
    userName: USER_NAME,
    userDisplayName: USER_NAME,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred", // Face ID / Touch ID when available
    },
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
  });

  await setChallenge(options.challenge);
  return Response.json(options);
}

export async function POST(req: Request) {
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) {
    return Response.json({ ok: false, error: "That took too long — try again." }, { status: 400 });
  }

  let body: { response?: RegistrationResponseJSON; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!body.response) {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { rpID, origin } = await relyingParty();
  try {
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return Response.json({ ok: false, error: "Could not verify that device." }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;
    const label = (body.label ?? "").trim() || "This device";

    await prisma.passkey.create({
      data: {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports?.join(",") ?? null,
        label: label.slice(0, 60),
      },
    });

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[passkey] registration failed:", e);
    return Response.json({ ok: false, error: "Could not verify that device." }, { status: 400 });
  }
}
