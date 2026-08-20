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

// Anything at or under this still fits through the serverless route (the
// platform caps request bodies around 4.5 MB), so when the direct-to-storage
// path fails we can quietly send the file the old way instead of stranding
// the operator. It's also the ceiling for posting bytes to the scan API.
const SERVER_ROUTE_MAX_BYTES = 3_500_000;

// The API always answers JSON. Anything else — an HTML login page after the
// session cookie expired, an empty body from a proxy — used to crash
// res.json() and show the operator a JSON parse error. Name the real cause.
async function parseResponse(
  res: Response,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { ok: boolean; id?: string; error?: string };
  } catch {
    if (res.redirected || res.status === 401 || res.status === 403 || /<html/i.test(text)) {
      return {
        ok: false,
        error: "Your sign-in expired — refresh this page, sign in, and try again.",
      };
    }
    return {
      ok: false,
      error: `The server answered with status ${res.status} instead of a result. Try again.`,
    };
  }
}

type ScanFields = {
  vendorName: string | null;
  receiptDate: string | null;
  total: string | null;
  salesTax: string | null;
  receiptNumber: string | null;
};

const SCAN_LABELS: [keyof ScanFields, string][] = [
  ["vendorName", "vendor"],
  ["receiptDate", "date"],
  ["total", "total"],
  ["salesTax", "sales tax"],
  ["receiptNumber", "receipt #"],
];

function localToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Drop scanned values into the (server-rendered) details form. Never clobbers
// something the operator already typed — the one exception is the date field,
// which is overwritten only while it still holds its "today" default.
function applyScanFields(fields: ScanFields): string[] {
  const form = document.getElementById("receipt-details") as HTMLFormElement | null;
  if (!form) return [];
  const defaults = new Set([localToday(-1), localToday(0), localToday(1)]);
  const filled: string[] = [];

  for (const [name, label] of SCAN_LABELS) {
    const value = fields[name];
    if (!value) continue;
    const el = form.elements.namedItem(name);
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
    const current = el.value.trim();
    const isDefaultDate = name === "receiptDate" && defaults.has(current);
    if (current !== "" && !isDefaultDate) continue;
    if (current === value) continue;
    el.value = value;
    filled.push(label);
  }

  if (filled.length > 0) {
    const details = form.querySelector("details");
    if (details) details.open = true;
  }
  return filled;
}

export default function ReceiptUploader({ blobEnabled }: Props) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A late scan answer for a file the operator already replaced must not
  // fill the form — every pick bumps this and stale responses are dropped.
  const scanSeq = useRef(0);
  // Set when the file was already uploaded to storage at pick time (big
  // files, so the scan can read them) — save() then skips the re-upload.
  const uploadedUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanFilled, setScanFilled] = useState<string[]>([]);

  async function uploadToBlob(f: File): Promise<string> {
    // A hung or endlessly-retrying connection must not strand the operator
    // forever: give the direct path a hard deadline, after which the caller's
    // fallback (small files) or a real error message takes over. Scaled by
    // size so a genuinely slow cellular upload of a big PDF isn't cut off
    // mid-transfer. The Promise.race is the guarantee — the library's
    // internal retry loop can sleep through an abort signal.
    const deadlineMs = Math.max(90_000, Math.round(f.size / 1024) * 30);
    const { upload } = await import("@vercel/blob/client");
    const blob = await Promise.race([
      upload(`receipts/${f.name}`, f, {
        access: "public",
        handleUploadUrl: "/api/blob/token",
        contentType: f.type || undefined,
        abortSignal:
          typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
            ? AbortSignal.timeout(deadlineMs)
            : undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("The storage upload timed out.")), deadlineMs + 5_000),
      ),
    ]);
    return blob.url;
  }

  // Fire-and-forget: a scan is a convenience. It fills empty fields when it
  // succeeds and says why when it can't — it never blocks saving.
  async function scanFile(f: File, seq: number, src: string | null) {
    setScanning(true);
    setScanNote(null);
    setScanFilled([]);
    try {
      let res: Response;
      if (src) {
        res = await fetch("/api/receipts/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ src }),
        });
      } else {
        const body = new FormData();
        body.set("file", f);
        res = await fetch("/api/receipts/scan", { method: "POST", body });
      }
      if (seq !== scanSeq.current) return; // operator picked a different file
      const json = (await res.json()) as {
        ok: boolean;
        fields?: ScanFields | null;
        note?: string | null;
      };
      if (seq !== scanSeq.current) return;
      if (json.ok && json.fields) {
        const filled = applyScanFields(json.fields);
        setScanFilled(filled);
        if (filled.length === 0 && json.note) setScanNote(json.note);
      } else if (json.note) {
        setScanNote(json.note);
      }
    } catch {
      // Reading failed — the form still works by hand, say nothing scary.
      if (seq === scanSeq.current) {
        setScanNote("Couldn't read the file automatically — fill in what matters below.");
      }
    } finally {
      if (seq === scanSeq.current) setScanning(false);
    }
  }

  async function pick(input: HTMLInputElement | null) {
    const chosen = input?.files?.[0];
    // Clear the input so picking the same file again still fires onChange.
    if (input) input.value = "";
    if (!chosen) return;
    setError(null);
    setBusy("Preparing…");
    const seq = ++scanSeq.current;
    uploadedUrlRef.current = null;
    setScanNote(null);
    setScanFilled([]);
    try {
      // Read the bytes NOW, not at send time. A file picked from iCloud/Files
      // on iOS can arrive as a lazy handle that Safari fails to stream when
      // the request is finally sent — the body goes out empty and the server
      // can only say "nothing arrived". (Photos were immune because the
      // shrink step re-encodes them; PDFs went through untouched.) Reading
      // here makes a bad handle fail loudly while the picker is still open.
      const bytes = await chosen.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("read 0 bytes");
      const solid = new File([bytes], chosen.name, {
        type: chosen.type,
        lastModified: chosen.lastModified,
      });
      const shrunk = await shrinkImage(solid);
      if (preview) URL.revokeObjectURL(preview);
      setFile(shrunk);
      setPreview(shrunk.type.startsWith("image/") ? URL.createObjectURL(shrunk) : null);

      // Read the document and pre-fill the details. Small files post their
      // bytes; big ones go to storage first (they'd blow the route's body
      // cap) and are scanned from there — save() then reuses that upload.
      if (shrunk.size <= SERVER_ROUTE_MAX_BYTES) {
        void scanFile(shrunk, seq, null);
      } else if (blobEnabled) {
        setBusy("Uploading…");
        try {
          const url = await uploadToBlob(shrunk);
          if (seq === scanSeq.current) {
            uploadedUrlRef.current = url;
            void scanFile(shrunk, seq, url);
          }
        } catch {
          // Upload retries at save time through the normal path; the scan is
          // simply skipped for a file this large.
        }
      }
    } catch {
      setFile(null);
      setPreview(null);
      setError(
        "Couldn't read that file. If it's stored in iCloud, open it once in the Files app so it downloads to this device, then pick it again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveRecord(payload: Record<string, unknown>) {
    const res = await fetch("/api/receipts/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await parseResponse(res);
    if (!res.ok || !json.ok || !json.id) throw new Error(json.error ?? "Could not save.");
    router.push(`/receipts/${json.id}`);
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
        await saveRecord(details);
        return;
      }

      if (blobEnabled) {
        // Straight to storage — never through a serverless body limit.
        setBusy("Uploading…");
        let storageKey: string | null = uploadedUrlRef.current;
        if (!storageKey) {
          try {
            storageKey = await uploadToBlob(file);
          } catch (e) {
            // Direct-to-storage failed. A small file still fits through the
            // server route, so fall through to that instead of giving up.
            if (file.size > SERVER_ROUTE_MAX_BYTES) {
              const reason = e instanceof Error ? e.message : "unknown error";
              throw new Error(
                `Direct upload to storage failed (${reason}), and the file is too big to send any other way. Try a photo of the document instead.`,
              );
            }
            console.warn("[uploader] storage upload failed, using the server route:", e);
          }
        }
        if (storageKey) {
          setBusy("Saving…");
          await saveRecord({
            ...details,
            storageKey,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
          });
          return;
        }
      }

      // Local dev, no blob store — or the fallback when direct storage failed.
      setBusy("Uploading…");
      const body = new FormData();
      body.set("file", file);
      for (const [k, v] of Object.entries(details)) {
        if (typeof v === "string") body.set(k, v);
      }
      const res = await fetch("/api/receipts/create", { method: "POST", body });
      const json = await parseResponse(res);
      if (!res.ok || !json.ok || !json.id) throw new Error(json.error ?? "Could not save.");
      router.push(`/receipts/${json.id}`);
    } catch (e) {
      setBusy(null);
      const message = e instanceof Error ? e.message : "Upload failed.";
      setError(
        /413|too large/i.test(message)
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

      {scanning ? (
        <p className="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">
          🔎 Reading the receipt…
        </p>
      ) : scanFilled.length > 0 ? (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          ✓ Filled from the file: {scanFilled.join(", ")} — check them before saving.
        </p>
      ) : scanNote ? (
        <p className="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">{scanNote}</p>
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
