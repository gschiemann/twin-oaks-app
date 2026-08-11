"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Face ID / Touch ID sign-in. Rendered on /login only when at least one
// passkey is registered; the password form always stays visible beneath it
// so a new or wiped device is never locked out.
export default function PasskeySignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/passkeys/auth");
      if (!optionsRes.ok) throw new Error("No passkeys are registered on this account.");
      const options = await optionsRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/passkeys/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.ok) {
        throw new Error(result.error ?? "That didn't verify.");
      }

      router.replace("/");
      router.refresh();
    } catch (e) {
      // A cancelled Face ID prompt throws too — say something calm.
      const message = e instanceof Error ? e.message : "Sign-in was cancelled.";
      setError(message.includes("NotAllowed") ? "Sign-in was cancelled." : message);
      setBusy(false);
    }
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-oak-700 px-4 py-3 text-base font-semibold text-white shadow-sm active:bg-oak-800 disabled:opacity-60"
      >
        {busy ? "Waiting for Face ID…" : "🔓 Sign in with Face ID"}
      </button>
      {error ? <p className="mt-1 text-sm font-medium text-red-600">{error}</p> : null}
      <p className="mt-2 text-center text-xs text-stone-400">or use your password</p>
    </div>
  );
}
