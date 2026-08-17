"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { humanSize, shrinkImage } from "@/lib/image-shrink";
import { btnPrimaryCls, btnSecondaryCls } from "./ui";

// Two separate inputs on purpose. An <input capture="environment"> opens the
// camera and, on iOS, HIDES "Photo Library" and "Browse Files" entirely — so
// a single capture input makes it impossible to send an existing photo or a
// PDF. One input per intent is the only arrangement that offers both.

type Props = { blobEnabled: boolean };

export default function ReceiptUploader({ blobEnabled }: Props) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(input: HTMLInputElement | null) {
    const chosen = input?.files?.[0];
    if (!chosen) return;
    setError(null);
    setBusy("Preparing…");
    try {
      const shrunk = await shrinkImage(chosen);
      setFile(shrunk);
      setPreview(shrunk.type.startsWith("image/") ? URL.createObjectURL(shrunk) : null);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    try {
      const form = document.getElementById("receipt-details") as HTMLFormElement | null;
      const details = form ? Object.fromEntries(new FormData(form).entries()) : {};

      // No file at all is allowed: the operator can record the receipt now
      // and attach the picture later.
      if (!file) {
        setBusy("Saving…");
        const res = await fetch("/api/receipts/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(details),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save.");
        router.push(`/receipts/${json.id}`);
        return;
      }

      if (blobEnabled) {
        // Straight to storage — never through a serverless body limit.
        setBusy("Uploading…");
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`receipts/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/blob/token",
          contentType: file.type || undefined,
        });
        setBusy("Saving…");
        const res = await fetch("/api/receipts/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...details,
            storageKey: blob.url,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save.");
        router.push(`/receipts/${json.id}`);
        return;
      }

      // Local dev / no blob store: post the file itself.
      setBusy("Uploading…");
      const body = new FormData();
      body.set("file", file);
      for (const [k, v] of Object.entries(details)) {
        if (typeof v === "string") body.set(k, v);
      }
      const res = await fetch("/api/receipts/create", { method: "POST", body });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not save.");
      router.push(`/receipts/${json.id}`);
    } catch (e) {
      setBusy(null);
      const message = e instanceof Error ? e.message : "Upload failed.";
      setError(
        /413|too large|size/i.test(message)
          ? "That file is too big to send. Try a photo instead of a scan."
          : message,
      );
    }
  }

  return (
    <div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={() => pick(cameraRef.current)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.heic,.heif"
        className="hidden"
        onChange={() => pick(fileRef.current)}
      />

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Receipt preview"
          className="mb-3 max-h-72 w-full rounded-xl border border-stone-200 object-contain"
        />
      ) : null}

      {file ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-oak-200 bg-oak-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-oak-900">
            {file.type === "application/pdf" ? "📄 " : "🖼 "}
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-oak-700">{humanSize(file.size)}</span>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy !== null}
          className={`${btnSecondaryCls} disabled:opacity-60`}
        >
          📷 Take photo
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className={`${btnSecondaryCls} disabled:opacity-60`}
        >
          📁 Choose file
        </button>
      </div>
      <p className="mb-4 text-xs text-stone-500">
        “Choose file” reaches your Photos, iCloud Drive and Files — use it for a saved picture or a
        PDF. Photos are shrunk on this device before sending, so it works on cellular.
      </p>

      {error ? (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={busy !== null}
        className={`${btnPrimaryCls} w-full disabled:opacity-60`}
      >
        {busy ?? (file ? "Save to Inbox" : "Save without a picture")}
      </button>
    </div>
  );
}
