"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimaryCls, inputCls } from "./ui";

// Enrollment runs from inside the app (session already established), so the
// server can trust the caller before storing a new credential.
export default function PasskeyEnroll() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/passkeys/register");
      if (!optionsRes.ok) throw new Error("Could not start setup.");
      const options = await optionsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/passkeys/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attestation, label }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.ok) throw new Error(result.error ?? "Setup failed.");

      setDone(true);
      setLabel("");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Setup failed.";
      setError(
        message.includes("NotAllowed")
          ? "Cancelled — nothing was saved."
          : message.includes("already registered") || message.includes("excluded")
            ? "This device already has a passkey."
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm font-medium text-oak-800">
        ✅ Saved. Next time you sign in, tap “Sign in with Face ID”.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name this device (e.g. Greg's iPhone)"
        className={inputCls}
      />
      <button type="button" onClick={enroll} disabled={busy} className={`${btnPrimaryCls} w-full disabled:opacity-60`}>
        {busy ? "Waiting for Face ID…" : "Set up Face ID on this device"}
      </button>
      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
