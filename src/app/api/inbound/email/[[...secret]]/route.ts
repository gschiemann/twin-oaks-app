// Inbound-email webhook (SPEC §37 "Email receipt importing", §3 "attach an
// emailed receipt later"). An inbound-email provider (CloudMailin, Postmark,
// SendGrid Inbound Parse, Mailgun…) POSTs a forwarded receipt here and it
// lands in the Receipt Inbox, pre-filled with whatever we can read
// confidently.
//
// SECURITY — this route is PUBLIC (providers can't carry a session cookie),
// so it is gated three ways:
//   1. shared secret in the URL path (…/api/inbound/email/<secret>) or the
//      ?key= query / x-inbound-secret header, compared in constant time;
//   2. optional sender allowlist (INBOUND_ALLOWED_SENDERS) so a leaked URL
//      still can't be used to inject receipts from a stranger's address;
//   3. hard caps on attachment count/size.
// When INBOUND_EMAIL_SECRET is unset the endpoint is disabled entirely.
//
// It always answers 200 on *soft* problems (nothing to ingest, duplicate)
// because providers retry aggressively on non-2xx; genuine auth failures
// return 401 so misconfiguration is visible during setup.

import crypto from "node:crypto";
import { prisma } from "@/lib/db";
// The inbound address + secret are the OWNER's configuration, so everything
// this webhook creates lands in the owner account. Per-account inbound
// addresses are a future feature.
import { OWNER_ACCOUNT_ID } from "@/lib/session";
import { saveBuffer } from "@/lib/storage";
import {
  extractReceiptHints,
  normalizeInboundEmail,
  type InboundAttachment,
} from "@/lib/inbound-email";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret?: string[] }> },
) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    return json({ ok: false, error: "Inbound email is not configured." }, 503);
  }

  const { secret } = await params;
  const url = new URL(req.url);
  const supplied =
    (secret && secret.length > 0 ? secret.join("/") : null) ??
    url.searchParams.get("key") ??
    req.headers.get("x-inbound-secret") ??
    "";
  if (!timingSafeEqual(supplied, expected)) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  // ---- Read the payload in whatever shape the provider sends -------------
  const contentType = req.headers.get("content-type") ?? "";
  const fields: Record<string, unknown> = {};
  const files: InboundAttachment[] = [];

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as unknown;
      if (body && typeof body === "object") Object.assign(fields, body);
    } else {
      // multipart/form-data or urlencoded (SendGrid, Mailgun, CloudMailin
      // "normalized" format) — File entries are the attachments.
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
        } else {
          const buf = Buffer.from(await value.arrayBuffer());
          files.push({
            filename: value.name || "attachment",
            contentType: value.type || "application/octet-stream",
            content: buf,
          });
        }
      }
    }
  } catch {
    return json({ ok: false, error: "Unreadable payload." }, 400);
  }

  const email = normalizeInboundEmail(fields, files);

  // ---- Sender allowlist --------------------------------------------------
  const allow = (process.env.INBOUND_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes(email.from)) {
    // 200 on purpose: the provider did its job; we simply drop the message.
    console.warn(`[inbound-email] dropped message from unlisted sender: ${email.from}`);
    return json({ ok: true, ignored: "sender-not-allowed" });
  }

  // ---- Duplicate suppression (providers retry on timeouts) ---------------
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const duplicate = await prisma.receipt.findFirst({
    where: {
      accountId: OWNER_ACCOUNT_ID,
      source: "EMAIL",
      emailFrom: email.from || null,
      emailSubject: email.subject || null,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  if (duplicate) {
    return json({ ok: true, ignored: "duplicate", receiptId: duplicate.id });
  }

  // ---- Decide what becomes the stored receipt document --------------------
  // Attachments win (a real PDF/photo receipt). With none, the email body IS
  // the receipt (Amazon/Apple-style), so it is stored verbatim — SPEC §1
  // requires the original to be kept permanently.
  const hints = extractReceiptHints(email);
  const documents: { bytes: Buffer; name: string; type: string }[] = [];

  let total = 0;
  for (const att of email.attachments.slice(0, MAX_ATTACHMENTS)) {
    if (total + att.content.byteLength > MAX_TOTAL_BYTES) break;
    total += att.content.byteLength;
    documents.push({ bytes: att.content, name: att.filename, type: att.contentType });
  }

  if (documents.length === 0) {
    const html = typeof fields.html === "string" ? fields.html : null;
    const bodyHtml =
      html ??
      (typeof fields.HtmlBody === "string" ? (fields.HtmlBody as string) : null) ??
      (typeof fields["body-html"] === "string" ? (fields["body-html"] as string) : null);
    const safeSubject = (email.subject || "receipt").replace(/[^\w .-]+/g, "_").slice(0, 60);
    documents.push(
      bodyHtml
        ? { bytes: Buffer.from(bodyHtml, "utf8"), name: `${safeSubject}.html`, type: "text/html" }
        : {
            bytes: Buffer.from(email.text || "(empty email)", "utf8"),
            name: `${safeSubject}.txt`,
            type: "text/plain",
          },
    );
  }

  // ---- Create one Inbox receipt per document ------------------------------
  const created: string[] = [];
  for (const doc of documents) {
    let stored;
    try {
      stored = await saveBuffer(doc.bytes, doc.name, doc.type, OWNER_ACCOUNT_ID);
    } catch (e) {
      console.error("[inbound-email] failed to store document:", e);
      continue;
    }
    const receipt = await prisma.receipt.create({
      data: {
        accountId: OWNER_ACCOUNT_ID,
        status: "INBOX",
        source: "EMAIL",
        emailFrom: email.from || null,
        emailSubject: email.subject || null,
        filePath: stored.storageKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
        vendorName: hints.vendorName,
        receiptDate: hints.receiptDate,
        totalCents: hints.totalCents,
        salesTaxCents: hints.salesTaxCents,
        receiptNumber: hints.receiptNumber,
        notes: email.subject ? `Forwarded email: ${email.subject}` : "Forwarded email",
      },
    });
    created.push(receipt.id);
  }

  if (created.length === 0) {
    return json({ ok: false, error: "Nothing could be stored." }, 500);
  }

  console.log(
    `[inbound-email] ingested ${created.length} receipt(s) from ${email.from || "unknown"}`,
  );
  return json({ ok: true, receipts: created.length, ids: created });
}

// A GET makes provider setup verifiable without sending mail.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ secret?: string[] }> },
) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  const { secret } = await params;
  const supplied = secret && secret.length > 0 ? secret.join("/") : "";
  if (!expected) return json({ ok: false, configured: false }, 503);
  if (!timingSafeEqual(supplied, expected)) return json({ ok: false }, 401);
  return json({ ok: true, configured: true, ready: "POST a forwarded email here." });
}
