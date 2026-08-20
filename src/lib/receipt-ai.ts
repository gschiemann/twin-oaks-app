// FR-002/FR-006: AI reading for receipts the deterministic path can't handle —
// photos of paper receipts and scanned PDFs with no text layer.
//
// Uses the Anthropic API directly (no SDK dependency) with ANTHROPIC_API_KEY.
// When the key isn't configured this module simply reports so and the caller
// degrades to "fill it in by hand" — the app never breaks over a missing key.
// Never throws; every failure path returns null.

import type { ReceiptHints } from "@/lib/inbound-email";

const MODEL = "claude-haiku-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";
// Anthropic vision accepts these image types (HEIC is normalized to JPEG
// on-device before upload, so it never reaches here).
const AI_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Keep the request payload sane: ~10 MB of raw bytes ≈ 13 MB base64.
const MAX_AI_BYTES = 10 * 1024 * 1024;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiCanRead(mimeType: string): boolean {
  return mimeType === "application/pdf" || AI_IMAGE_TYPES.has(mimeType);
}

const PROMPT = `This is a receipt, invoice, order confirmation, or packing slip. Extract these fields and answer with STRICT JSON only — no prose, no markdown fence:
{"vendorName": string|null, "receiptDate": "YYYY-MM-DD"|null, "totalDollars": number|null, "salesTaxDollars": number|null, "receiptNumber": string|null}
Rules: vendorName is the merchant/seller, never the buyer or shipping carrier. receiptDate is the purchase/order date. totalDollars is the grand total actually charged (not subtotal). salesTaxDollars only if a tax amount is printed. receiptNumber is the order/receipt/invoice number. Use null for anything not clearly present — never guess.`;

type AiJson = {
  vendorName?: unknown;
  receiptDate?: unknown;
  totalDollars?: unknown;
  salesTaxDollars?: unknown;
  receiptNumber?: unknown;
};

function asCleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= max ? t : null;
}

function dollarsToCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

function toLocalNoonDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (y < 2000 || date.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) return null;
  return date;
}

export async function aiExtractReceipt(bytes: Buffer, mimeType: string): Promise<ReceiptHints | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !aiCanRead(mimeType) || bytes.byteLength === 0 || bytes.byteLength > MAX_AI_BYTES) {
    return null;
  }

  try {
    const data = bytes.toString("base64");
    const fileBlock =
      mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: mimeType, data } };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0,
        messages: [{ role: "user", content: [fileBlock, { type: "text", text: PROMPT }] }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error(`[receipt-ai] API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }

    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as AiJson;

    const totalCents = dollarsToCents(parsed.totalDollars);
    let salesTaxCents = dollarsToCents(parsed.salesTaxDollars);
    if (salesTaxCents !== null && totalCents !== null && salesTaxCents >= totalCents) {
      salesTaxCents = null;
    }
    return {
      vendorName: asCleanString(parsed.vendorName, 60),
      receiptDate: toLocalNoonDate(parsed.receiptDate),
      totalCents,
      salesTaxCents,
      receiptNumber: asCleanString(parsed.receiptNumber, 40),
    };
  } catch (e) {
    console.error("[receipt-ai] extraction failed:", e);
    return null;
  }
}
