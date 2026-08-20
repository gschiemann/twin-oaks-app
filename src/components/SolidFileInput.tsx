"use client";

// A drop-in <input type="file"> that reads the picked file's bytes
// IMMEDIATELY and swaps the lazy handle for an in-memory copy. On iOS, a
// file picked from iCloud/Files can be a placeholder that fails to stream
// when the form is finally submitted — the request goes out without the
// file and the server sees nothing. Reading the bytes up front either
// forces the download to happen now or fails loudly while the picker is
// still open, instead of silently at save time. (BUG-002 follow-up: the
// add-receipt flow has its own uploader; this covers every plain form.)

import { useState } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export default function SolidFileInput(props: Props) {
  const [warning, setWarning] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Captured before the await — a React event's currentTarget is only
    // valid during dispatch.
    const input = e.currentTarget;
    const chosen = input.files?.[0];
    setWarning(null);
    if (!chosen) return;
    try {
      const bytes = await chosen.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("read 0 bytes");
      try {
        const dt = new DataTransfer();
        dt.items.add(
          new File([bytes], chosen.name, { type: chosen.type, lastModified: chosen.lastModified }),
        );
        input.files = dt.files;
      } catch {
        // DataTransfer unsupported — keep the original handle; the read
        // above already forced the file to materialize on the device.
      }
    } catch {
      input.value = "";
      setWarning(
        "Couldn't read that file. If it's stored in iCloud, open it once in the Files app so it downloads, then pick it again.",
      );
    }
  }

  return (
    <>
      <input {...props} type="file" onChange={onChange} />
      {warning ? <p className="mt-1 text-xs font-medium text-red-600">{warning}</p> : null}
    </>
  );
}
