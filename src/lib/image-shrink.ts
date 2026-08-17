// Shrink a photo in the browser before it is uploaded.
//
// Three problems this solves at once, all of them mobile problems:
//  • A 12MP iPhone photo is 3–6 MB; uploading that over cellular is slow and
//    used to hit the platform's request-size ceiling.
//  • iPhones shoot HEIC, which most browsers cannot display. Drawing to a
//    canvas and exporting JPEG normalizes the format — Safari decodes the
//    HEIC for us.
//  • Receipts are text on paper: 2000px on the long edge is far more than
//    enough to read every line, so the quality cost is nil.
//
// Anything that is not an image (a PDF) is returned untouched, and any
// failure returns the original file rather than blocking the upload.

const MAX_EDGE = 2000;
const QUALITY = 0.82;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (typeof document === "undefined") return file;

  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small AND already a web-friendly format: leave it alone.
    if (scale === 1 && /jpeg|png|webp/.test(file.type) && file.size < 1_500_000) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size === 0) return file;
    // Keep the original if shrinking somehow made it bigger.
    if (blob.size >= file.size && /jpeg/.test(file.type)) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "receipt";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari refuses HEIC here; fall through to the <img> path, which it
      // decodes natively.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    // Revoked on the next tick so the decode has definitely finished.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
