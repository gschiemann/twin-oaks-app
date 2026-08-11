// Passkey sign-in. PUBLIC by necessity — this is how you get a session, so
// it runs before one exists (exempted in middleware.ts). It is safe because
// nothing here trusts client input: a session is only issued after a real
// signature over a server-issued challenge verifies against a public key we
// stored during an authenticated enrollment.

import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { relyingParty, setChallenge, takeChallenge } from "@/lib/passkey";
import { SESSION_COOKIE, sessionTokenFor } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const { rpID } = await relyingParty();
  const keys = await prisma.passkey.findMany({
    select: { credentialId: true, transports: true },
  });
  if (keys.length === 0) {
    return Response.json({ ok: false, error: "No passkeys registered." }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: keys.map((k) => ({
      id: k.credentialId,
      transports: k.transports
        ? (k.transports.split(",") as AuthenticatorTransportFuture[])
        : undefined,
    })),
  });

  await setChallenge(options.challenge);
  return Response.json(options);
}

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    // With no password configured the gate is off entirely; issuing a
    // session here would be meaningless.
    return Response.json({ ok: false, error: "Sign-in is not configured." }, { status: 503 });
  }

  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) {
    return Response.json({ ok: false, error: "That took too long — try again." }, { status: 400 });
  }

  let response: AuthenticationResponseJSON;
  try {
    response = (await req.json()) as AuthenticationResponseJSON;
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const stored = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!stored) {
    return Response.json({ ok: false, error: "Unknown device." }, { status: 400 });
  }

  const { rpID, origin } = await relyingParty();
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports
          ? (stored.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return Response.json({ ok: false, error: "That didn't verify." }, { status: 400 });
    }

    // Counter guards against cloned authenticators; Apple's passkeys always
    // report 0, so only persist forward movement.
    await prisma.passkey.update({
      where: { id: stored.id },
      data: {
        counter: Math.max(stored.counter, verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, await sessionTokenFor(password), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[passkey] authentication failed:", e);
    return Response.json({ ok: false, error: "That didn't verify." }, { status: 400 });
  }
}
