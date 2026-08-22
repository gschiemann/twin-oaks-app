"use client";

// Attach a photo, manual, warranty or CAD file to any record.
//
// The scar tissue from the receipt uploader is reused wholesale, because it
// was all paid for on a real iPhone:
//   • Two separate file inputs. An <input capture="environment"> opens the
//     camera and, on iOS, HIDES "Photo Library" and "Browse Files" — so one
//     combined input makes it impossible to send an existing photo or a PDF.
//   • The bytes are read at PICK time, not at send time. A file picked from
//     iCloud/Files can be a lazy handle that fails to stream when the request
//     finally goes out; the body arrives empty and the server can only say
//     "nothing arrived". Reading here makes a bad handle fail loudly while
//     the picker is still open.
//   • Photos are shrunk (and HEIC normalised to JPEG) on the device, so a
//     12 MP picture fits through the request-body cap and uploads on cellular.
//   • XHR, not fetch, so there is a REAL progress bar — an operator staring
//     at a dead button assumes the app is broken and taps it again.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { humanSize, shrinkImage } from "@/lib/image-shrink";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type DocumentOwnerType,
} from "@/lib/domain";
import { btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "./ui";

type Props = {
  ownerType: DocumentOwnerType;
  ownerId: string;
  /** Pre-selects the kind dropdown (e.g. "PHOTO" on an animal page). */
  defaultKind?: DocumentKind;
};

// Mirrors MAX_DOCUMENT_BYTES on the server. Checked here too so an oversized
// file is refused while the picker is still open, not after a long upload.
const MAX_BYTES = 4 * 1024 * 1024;

const ACCEPT =
  "image/*,application/pdf,.pdf,.heic,.heif,.stl,.step,.stp,.3mf,.obj,.dxf,.dwg,.txt,.csv,.doc,.docx,.xls,.xlsx";

export default function DocumentUploader({ ownerType, ownerId, defaultKind }: Props) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>(defaultKind ?? "DOCUMENT");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Never leak the object URL of a preview the operator replaced or left.
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function setPreviewUrl(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }

  function clearPick() {
    setPreviewUrl(null);
    setFile(null);
    setTitle("");
    setProgress(null);
  }

  async function pick(input: HTMLInputElement | null) {
    const chosen = input?.files?.[0];
    // Clear the input so picking the SAME file again still fires onChange.
    if (input) input.value = "";
    if (!chosen) return;
    setError(null);
    setBusy("Preparing…");
    try {
      const bytes = await chosen.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("read 0 bytes");
      const solid = new File([bytes], chosen.name, {
        type: chosen.type,
        lastModified: chosen.lastModified,
      });
      const shrunk = await shrinkImage(solid);

      if (shrunk.size > MAX_BYTES) {
        clearPick();
        setError(
          `That file is ${humanSize(shrunk.size)} — more than this app can send in one piece (${Math.round(
            MAX_BYTES / 1024 / 1024,
          )} MB). Take a photo of the document instead (photos are shrunk automatically), or save it as a smaller PDF.`,
        );
        return;
      }

      setFile(shrunk);
      setPreviewUrl(shrunk.type.startsWith("image/") ? URL.createObjectURL(shrunk) : null);
      // A sensible name so the operator can just press Save.
      setTitle((prev) => prev.trim() || shrunk.name.replace(/\.[^.]+$/, ""));
      if (!defaultKind && shrunk.type.startsWith("image/")) setKind("PHOTO");
    } catch {
      clearPick();
      setError(
        "Couldn't read that file. If it's stored in iCloud, open it once in the Files app so it downloads to this device, then pick it again.",
      );
    } finally {
      setBusy(null);
    }
  }

  // XHR gives upload progress; fetch does not. The API always answers JSON —
  // anything else (an HTML login page after the cookie expired) is named for
  // what it actually is instead of surfacing a JSON parse error.
  function send(body: FormData): Promise<{ ok: boolean; id?: string; error?: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onerror = () =>
        resolve({ ok: false, error: "The upload didn't reach the server. Check your signal and try again." });
      xhr.ontimeout = () =>
        resolve({ ok: false, error: "The upload timed out. Try again — a photo sends faster than a scan." });
      xhr.onload = () => {
        const text = xhr.responseText ?? "";
        try {
          resolve(JSON.parse(text) as { ok: boolean; id?: string; error?: string });
        } catch {
          if (xhr.status === 401 || xhr.status === 403 || /<html/i.test(text)) {
            resolve({
              ok: false,
              error: "Your sign-in expired — refresh this page, sign in, and try again.",
            });
          } else if (xhr.status === 413) {
            resolve({ ok: false, error: "That file is too big to send. Try a photo instead of a scan." });
          } else {
            resolve({
              ok: false,
              error: `The server answered with status ${xhr.status} instead of a result. Try again.`,
            });
          }
        }
      };
      xhr.timeout = 120_000;
      xhr.send(body);
    });
  }

  async function save() {
    if (!file) {
      setError("Pick a file first — use Take photo or Choose file.");
      return;
    }
    setError(null);
    setBusy("Uploading…");
    setProgress(0);
    try {
      const body = new FormData();
      body.set("ownerType", ownerType);
      body.set("ownerId", ownerId);
      body.set("kind", kind);
      body.set("title", title.trim());
      body.set("file", file);
      const json = await send(body);
      if (!json.ok) throw new Error(json.error ?? "Could not save that document.");
      setBusy("Saved");
      clearPick();
      router.refresh();
      // The card re-renders with the new file; drop the label a beat later so
      // the operator sees that something happened.
      setTimeout(() => setBusy(null), 800);
    } catch (e) {
      setBusy(null);
      setProgress(null);
      setError(e instanceof Error ? e.message : "Could not save that document.");
    }
  }

  const uploading = busy === "Uploading…";

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
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
        accept={ACCEPT}
        className="hidden"
        onChange={() => pick(fileRef.current)}
      />

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="The file you picked"
          className="mb-3 max-h-56 w-full rounded-xl border border-stone-200 object-contain"
        />
      ) : null}

      {file ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-oak-200 bg-oak-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-oak-900">
            {file.type === "application/pdf" ? "📄 " : file.type.startsWith("image/") ? "🖼 " : "📎 "}
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-oak-700">{humanSize(file.size)}</span>
        </div>
      ) : null}

      {file ? (
        <div className="mb-3 space-y-3">
          <div>
            <label className={labelCls} htmlFor={`doc-title-${ownerId}`}>
              What is it?
            </label>
            <input
              id={`doc-title-${ownerId}`}
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Owner's manual"
              disabled={uploading}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor={`doc-kind-${ownerId}`}>
              Type
            </label>
            <select
              id={`doc-kind-${ownerId}`}
              className={inputCls}
              value={kind}
              onChange={(e) => setKind(e.target.value as DocumentKind)}
              disabled={uploading}
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
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

      {uploading && progress !== null ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-oak-600 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-stone-500">Sending… {progress}%</p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      {file ? (
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className={`${btnPrimaryCls} mt-3 w-full disabled:opacity-60`}
        >
          {busy === "Uploading…" ? "Uploading…" : busy === "Saved" ? "✓ Saved" : "Save this file"}
        </button>
      ) : (
        <p className="mt-2 text-xs text-stone-500">
          Photos are shrunk on this device before sending. “Choose file” also reaches iCloud Drive and
          Files for a PDF or a CAD file.
        </p>
      )}

      {busy === "Saved" && !file ? (
        <p className="mt-3 rounded-xl bg-oak-50 px-3 py-2 text-sm font-medium text-oak-800">
          ✓ Saved — it&apos;s in the list above.
        </p>
      ) : null}
    </div>
  );
}
