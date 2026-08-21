// On-device OCR — reads the PIXELS of a receipt when there is no text layer
// to extract (iOS "scan" PDFs, camera photos). Runs entirely in the browser
// with Tesseract (WASM) and pdf.js; every asset is self-hosted under
// /public/ocr, so it needs no API key, no external CDN, and works for every
// account with zero configuration. The server's AI path (when a key is
// configured) takes precedence for quality — this is the always-available
// floor, not the ceiling.
//
// Browser-only: import dynamically from client components.

type PdfJs = typeof import("pdfjs-dist");

const MAX_RENDER_WIDTH = 2200; // plenty for OCR, keeps WASM memory sane

async function pdfPageToCanvas(file: File): Promise<HTMLCanvasElement | null> {
  // The LEGACY build on purpose: the modern one uses brand-new JS methods
  // (Map.getOrInsertComputed) that today's iPhones don't have yet.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await loadingTask.promise;
  try {
    // Receipts are one page; OCR page 1 only.
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1.5, MAX_RENDER_WIDTH / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // transparent PDFs OCR terribly on black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport } as never).promise;
    return canvas;
  } finally {
    void loadingTask.destroy().catch(() => {});
  }
}

async function imageToCanvas(file: File): Promise<HTMLCanvasElement | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, MAX_RENDER_WIDTH / Math.max(bitmap.width, bitmap.height)) || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** OCR a picked receipt (PDF or image) → its text, or null when unreadable.
 *  First use downloads ~7 MB of reader assets (then cached by the browser). */
export async function ocrFile(file: File): Promise<string | null> {
  try {
    const canvas =
      file.type === "application/pdf" ? await pdfPageToCanvas(file) : await imageToCanvas(file);
    if (!canvas) return null;

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr",
    });
    try {
      const { data } = await worker.recognize(canvas);
      const text = (data.text ?? "").trim();
      return text.length > 0 ? text : null;
    } finally {
      await worker.terminate().catch(() => {});
    }
  } catch (e) {
    console.warn("[ocr] on-device read failed:", e);
    return null;
  }
}
