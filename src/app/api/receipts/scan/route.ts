// FR-006: read a picked receipt and hand back form-ready field guesses.
//
// Three request shapes, mirroring how the receipt reaches us:
//   • multipart {file}  — small files, sent directly by the browser;
//   • JSON {src}        — big files already uploaded to blob storage at pick
//                         time; src must be OUR OWN blob URL (SSRF guard);
//   • JSON {text}       — text the BROWSER produced by on-device OCR
//                         (src/lib/client-ocr.ts) after we answered
//                         wantClientOcr — runs the same field heuristics.
//
// Reading strategy, cheapest first:
//   1. PDF with a text layer → free deterministic extraction (unpdf + the
//      same heuristics the inbound-email path uses).
//   2. Photos and scanned PDFs → AI vision when ANTHROPIC_API_KEY is
//      configured; otherwise the response says wantClientOcr and the
//      browser reads the pixels itself with Tesseract (no key, no setup).
//
// Behind the login gate (middleware). Never 500s over a bad document — a scan
// is a convenience, not a gate on saving the receipt.

import { extractFromDocumentText, hintsToScanFields, hasAnyField } from "@/lib/receipt-extract";
import { aiCanRead, aiConfigured, aiExtractReceipt } from "@/lib/receipt-ai";
import { isOwnBlobUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const MIN_USEFUL_TEXT = 40;

const NOTHING_FOUND_NOTE = "Couldn't find the details automatically — fill in what matters below.";
const MAX_OCR_TEXT = 200_000;

function respond(
  source: string,
  fields: ReturnType<typeof hintsToScanFields> | null,
  note?: string,
  wantClientOcr = false,
) {
  return Response.json({ ok: true, source, fields, note: note ?? null, wantClientOcr });
}

async function readPdfText(bytes: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(doc, { mergePages: true });
    return typeof text === "string" ? text : "";
  } catch (e) {
    console.error("[receipt-scan] pdf text extraction failed:", e);
    return "";
  }
}

export async function POST(req: Request) {
  let bytes: Buffer | null = null;
  let mimeType = "";

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { src?: unknown; text?: unknown };
      // On-device OCR output: no bytes involved, straight to the heuristics.
      if (typeof body.text === "string") {
        const fields = hintsToScanFields(
          extractFromDocumentText(body.text.slice(0, MAX_OCR_TEXT)),
        );
        return hasAnyField(fields)
          ? respond("ocr", fields)
          : respond("ocr", null, NOTHING_FOUND_NOTE);
      }
      const src = typeof body.src === "string" ? body.src : "";
      if (!isOwnBlobUrl(src)) {
        return Response.json({ ok: false, error: "Not a file this app stored." }, { status: 400 });
      }
      const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        return Response.json({ ok: false, error: "Couldn't fetch the uploaded file." }, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf;
      mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        bytes = Buffer.from(await file.arrayBuffer());
        mimeType = file.type;
      }
    }
  } catch (e) {
    console.error("[receipt-scan] unreadable request:", e);
    return Response.json({ ok: false, error: "The file didn't arrive readable." }, { status: 400 });
  }

  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SCAN_BYTES) {
    return Response.json({ ok: false, error: "Nothing readable to scan." }, { status: 400 });
  }

  // Trust the magic bytes over a missing/odd content type for PDFs.
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") mimeType = "application/pdf";

  try {
    if (mimeType === "application/pdf") {
      const text = await readPdfText(bytes);
      if (text.trim().length >= MIN_USEFUL_TEXT) {
        const fields = hintsToScanFields(extractFromDocumentText(text));
        return hasAnyField(fields)
          ? respond("pdf-text", fields)
          : respond("pdf-text", null, NOTHING_FOUND_NOTE);
      }
      // Scanned PDF — no text layer.
      if (aiConfigured()) {
        const hints = await aiExtractReceipt(bytes, "application/pdf");
        const fields = hints ? hintsToScanFields(hints) : null;
        return fields && hasAnyField(fields)
          ? respond("ai", fields)
          : respond("ai", null, NOTHING_FOUND_NOTE);
      }
      // No AI on this deployment: the browser reads the pixels itself.
      return respond("none", null, NOTHING_FOUND_NOTE, true);
    }

    if (mimeType.startsWith("image/")) {
      if (aiConfigured() && aiCanRead(mimeType)) {
        const hints = await aiExtractReceipt(bytes, mimeType);
        const fields = hints ? hintsToScanFields(hints) : null;
        return fields && hasAnyField(fields)
          ? respond("ai", fields)
          : respond("ai", null, NOTHING_FOUND_NOTE);
      }
      return respond("none", null, NOTHING_FOUND_NOTE, true);
    }

    return respond("none", null, NOTHING_FOUND_NOTE);
  } catch (e) {
    // A scan must never block saving the receipt.
    console.error("[receipt-scan]", e);
    return respond("none", null, NOTHING_FOUND_NOTE);
  }
}
