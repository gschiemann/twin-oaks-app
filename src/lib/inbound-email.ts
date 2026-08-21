// Inbound-email normalization + receipt-field heuristics.
//
// Two jobs, both pure and both total (they never throw, whatever garbage the
// webhook hands us — a 500 on the mail webhook means the provider retries or
// drops a receipt on the floor, and a lost receipt is unrecoverable):
//
//   1. normalizeInboundEmail() flattens the mutually-incompatible payloads of
//      CloudMailin (legacy multipart + v2 JSON), SendGrid, Postmark and
//      Mailgun into one NormalizedEmail shape. Every provider names the same
//      five things differently and any field may simply be absent, so every
//      read here is defensive: pick the first candidate that yields something
//      usable, otherwise fall back to the empty value.
//
//   2. extractReceiptHints() guesses vendor / total / tax / date / receipt
//      number out of a *forwarded* receipt email. These are HINTS: they
//      pre-fill the Inbox form that the owner reviews before anything becomes
//      an expense. A blank field costs one tap; a confidently wrong dollar
//      amount can survive review and land in the books. So every heuristic
//      below prefers null over a guess, and every numeric guess is bounded.
//
// No Prisma / React / Next imports on purpose — this is called from the email
// webhook route and is trivially unit-testable in isolation.

export type InboundAttachment = { filename: string; contentType: string; content: Buffer };

export type NormalizedEmail = {
  from: string; // bare address, lowercased ("" when unknown)
  fromName: string | null;
  subject: string; // "" when none
  text: string; // plain-text body (HTML stripped to readable text when that's all we got)
  attachments: InboundAttachment[];
};

export type ReceiptHints = {
  vendorName: string | null;
  totalCents: number | null;
  salesTaxCents: number | null;
  receiptDate: Date | null;
  receiptNumber: string | null;
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Receipt emails carry a photo or two, not a media library. */
const MAX_ATTACHMENTS = 10;

/** Above this, we're reading a phone number / order id / parse noise, not money. */
const MAX_PLAUSIBLE_DOLLARS = 1_000_000;

/** Clock skew + "receipt dated tomorrow" tolerance before we call a date bogus. */
const MAX_FUTURE_MS = 2 * 24 * 60 * 60 * 1000;

/** Attachment extensions worth keeping when the content type is unhelpful. */
const RECEIPT_FILE_EXT = /\.(jpe?g|png|heic|heif|webp|pdf)$/i;

/**
 * Free-mail domains never name a vendor — a forwarded receipt whose inner
 * "From:" is a gmail.com address is a person, so we return null instead of
 * proudly filling the vendor field in with "Gmail".
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "sbcglobal.net",
  "att.net",
  "comcast.net",
  "verizon.net",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "zoho.com",
]);

/** Sending-subdomains that say nothing about who the vendor is. */
const GENERIC_SUBDOMAINS = new Set([
  "www",
  "mail",
  "email",
  "mailer",
  "mailing",
  "smtp",
  "send",
  "sender",
  "no-reply",
  "noreply",
  "reply",
  "notify",
  "notifications",
  "notification",
  "alerts",
  "info",
  "news",
  "e",
  "em",
  "m",
]);

/** Subject openers that are boilerplate, never a vendor name. */
const GENERIC_SUBJECT_START = /^(your|thank|thanks|order|receipt|invoice|payment|confirmation)\b/i;

// ---------------------------------------------------------------------------
// Tiny defensive readers (everything above is `unknown` — assume nothing)
// ---------------------------------------------------------------------------

function asTrimmedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = asTrimmedString(value);
    if (str !== null) return str;
  }
  return null;
}

function tryJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** Object, or a JSON string holding an object (CloudMailin sends `envelope` both ways). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const parsed = tryJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/**
 * Read the first present key, trying each candidate name in order and falling
 * back to a case-insensitive match (header maps arrive with wild casing:
 * `From`, `from`, `FROM`).
 */
function pickField(source: Record<string, unknown> | null, ...names: string[]): unknown {
  if (!source) return undefined;
  const keys = Object.keys(source);
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      const direct = source[name];
      if (direct !== undefined && direct !== null && direct !== "") return direct;
    }
    const lowered = name.toLowerCase();
    for (const key of keys) {
      if (key.toLowerCase() !== lowered) continue;
      const value = source[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// parseAddress
// ---------------------------------------------------------------------------

const EMPTY_ADDRESS: { address: string; name: string | null } = { address: "", name: null };

/**
 * Loose address shape. Deliberately permissive (no dot required in the domain)
 * — we only need something we can store and later match on, and rejecting a
 * real address is worse than keeping an odd one.
 */
const ADDRESS_RE = /^[^\s@,;<>()[\]"]+@[^\s@,;<>()[\]"]+$/;

function cleanDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  name = name.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/[,;:]+$/, "").trim();
  return name === "" ? null : name;
}

function sanitizeAddress(raw: string): string {
  const address = raw
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/^[<"'\s]+/, "")
    .replace(/[>"'\s]+$/, "")
    .replace(/[,;.]+$/, "")
    .trim()
    .toLowerCase();
  return ADDRESS_RE.test(address) ? address : "";
}

/**
 * `"Greg S" <greg@x.com>` / `Greg S <greg@x.com>` / `greg@x.com` /
 * `{ Email, Name }` (Postmark FromFull) / `{ from }` (CloudMailin envelope)
 * / a one-element array of any of those → `{ address, name }`.
 */
export function parseAddress(raw: unknown): { address: string; name: string | null } {
  if (raw == null) return { ...EMPTY_ADDRESS };

  // Providers occasionally hand us a list; the first entry is the sender.
  if (Array.isArray(raw)) return raw.length > 0 ? parseAddress(raw[0]) : { ...EMPTY_ADDRESS };

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const inner = pickField(obj, "email", "address", "from", "value", "mailbox");
    const explicitName = cleanDisplayName(firstString(pickField(obj, "name", "personal", "display_name")));
    if (inner === undefined) return { address: "", name: explicitName };
    const parsed = parseAddress(inner);
    // An explicit name field beats anything embedded in the address string.
    return { address: parsed.address, name: explicitName ?? parsed.name };
  }

  if (typeof raw !== "string") return { ...EMPTY_ADDRESS };
  const input = raw.trim();
  if (input === "") return { ...EMPTY_ADDRESS };

  let address = "";
  let name: string | null = null;

  // Angle-bracket form first: the display name may itself contain commas
  // ("Schiemann, Greg" <greg@x.com>), so splitting on commas would be wrong.
  const angled = /<([^<>]*)>/.exec(input);
  if (angled) {
    address = sanitizeAddress(angled[1] ?? "");
    name = cleanDisplayName(input.slice(0, angled.index));
  }

  if (!address) {
    // Bare form: first whitespace/comma/semicolon-delimited token with an "@".
    for (const token of input.split(/[\s,;]+/)) {
      if (!token.includes("@")) continue;
      const candidate = sanitizeAddress(token);
      if (candidate) {
        address = candidate;
        break;
      }
    }
  }

  // "greg@x.com <greg@x.com>" carries no human name — don't pretend it does.
  if (name && address && name.toLowerCase() === address) name = null;

  return { address, name };
}

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  zwnj: "",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
};

/**
 * Single pass so `&amp;lt;` decodes to the literal text `&lt;` rather than
 * being double-decoded into `<`.
 */
function decodeEntities(input: string): string {
  return input.replace(/&(#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,10});/gi, (whole, body: string) => {
    if (body.charAt(0) === "#") {
      const isHex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      if (code >= 0xd800 && code <= 0xdfff) return ""; // lone surrogate
      if (code === 0xa0) return " "; // nbsp → plain space, keeps downstream regexes simple
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** HTML email body → readable plain text. Never throws; "" for non-strings. */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || html === "") return "";
  try {
    let text = html;

    // 1. Kill anything whose text content is not human-readable.
    text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
    text = text.replace(/<!--[\s\S]*?-->/g, " ");

    // 2. Block boundaries → newlines, cell boundaries → a space (so
    //    `<td>Total</td><td>$12.34</td>` reads "Total $12.34" instead of
    //    running the label into the amount).
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/(?:p|div|tr|li|h[1-6]|table|blockquote|section|header|footer)\s*>/gi, "\n");
    text = text.replace(/<\/(?:td|th)\s*>/gi, " ");

    // 3. Everything else goes.
    text = text.replace(/<[^>]*>/g, "");

    // 4. Entities, then whitespace tidy-up.
    text = decodeEntities(text);
    text = text.replace(/\r\n?/g, "\n");
    text = text.replace(/[^\S\n]+/g, " "); // runs of spaces/tabs/nbsp, never newlines
    text = text.replace(/ *\n */g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function safeFilename(raw: string | null | undefined): string {
  if (!raw) return "";
  // Storage keys get built from these downstream — strip any path component
  // and control characters here rather than trusting the sender.
  const base = raw
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .split(/[\\/]/)
    .pop();
  return (base ?? "").trim().slice(0, 180);
}

function toBuffer(value: unknown): Buffer | null {
  try {
    if (Buffer.isBuffer(value)) return value.length > 0 ? value : null;
    if (value instanceof Uint8Array) return value.byteLength > 0 ? Buffer.from(value) : null;
    if (typeof value !== "string") return null;

    const compact = value.replace(/\s+/g, "");
    if (compact === "") return null;
    const dataUri = /^data:[^;,]*;base64,(.*)$/i.exec(compact);
    const b64 = dataUri ? dataUri[1] : compact;
    // Refuse anything that isn't plausibly base64 — Node's decoder silently
    // discards unknown characters, which would otherwise store a corrupt file
    // that looks like a real receipt until someone opens it.
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) return null;
    const buf = Buffer.from(b64, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function toAttachment(keyName: string | null, entry: unknown): InboundAttachment | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;

  const content = toBuffer(pickField(obj, "content", "data", "body", "Content"));
  if (!content) return null; // e.g. CloudMailin "stored" attachments (URL only) — nothing to save

  const filename = safeFilename(
    firstString(pickField(obj, "file_name", "filename", "fileName", "name"), keyName),
  );
  const contentType =
    firstString(pickField(obj, "content_type", "contentType", "mime_type", "mimeType", "type")) ?? "";

  return { filename, contentType: contentType.trim(), content };
}

function collectEmbeddedAttachments(raw: unknown): InboundAttachment[] {
  const out: InboundAttachment[] = [];
  const value = typeof raw === "string" ? tryJson(raw) : raw;
  if (!value || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const att = toAttachment(null, entry);
      if (att) out.push(att);
    }
    return out;
  }

  // Object map: { "receipt.pdf": { content_type, content }, ... }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const att = toAttachment(key, entry);
    if (att) out.push(att);
  }
  return out;
}

/**
 * Keep photos and PDFs; drop the .ics / .vcf / .txt / .html noise that rides
 * along on forwarded mail. An `image/*` content type is always kept (a logo
 * costs a few KB; a dropped receipt photo costs the owner a real deduction).
 */
function isLikelyReceiptAttachment(att: InboundAttachment): boolean {
  const type = att.contentType.toLowerCase().split(";")[0].trim();
  if (type.startsWith("image/") || type === "application/pdf") return true;
  return RECEIPT_FILE_EXT.test(att.filename);
}

function fallbackFilename(att: InboundAttachment, index: number): string {
  if (att.filename) return att.filename;
  const type = att.contentType.toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return `attachment-${index + 1}.pdf`;
  if (type.startsWith("image/")) {
    const sub = type.slice("image/".length).replace(/[^a-z0-9]/g, "") || "img";
    return `attachment-${index + 1}.${sub === "jpeg" ? "jpg" : sub}`;
  }
  return `attachment-${index + 1}`;
}

// ---------------------------------------------------------------------------
// normalizeInboundEmail
// ---------------------------------------------------------------------------

/**
 * Flatten any provider's inbound webhook payload into one shape.
 *
 * @param fields raw form fields / parsed JSON body (any key may be missing)
 * @param files  attachments the route already decoded out of the multipart body
 */
export function normalizeInboundEmail(
  fields: Record<string, unknown>,
  files: { filename: string; contentType: string; content: Buffer }[],
): NormalizedEmail {
  const empty: NormalizedEmail = { from: "", fromName: null, subject: "", text: "", attachments: [] };

  try {
    const source: Record<string, unknown> | null =
      fields && typeof fields === "object" && !Array.isArray(fields)
        ? (fields as Record<string, unknown>)
        : null;
    if (!source) return { ...empty, attachments: normalizeFileList(files) };

    const headers = asRecord(pickField(source, "headers", "Headers", "message-headers"));
    const envelope = asRecord(pickField(source, "envelope", "Envelope"));

    // --- from ---------------------------------------------------------------
    // Ordered by how likely each source is to carry the human display name.
    // The SMTP envelope goes last: it is the return-path, which on bulk
    // senders is a bounce mailbox (`bounces+123@sendgrid.net`), not the vendor.
    const fromCandidates: unknown[] = [
      pickField(source, "from", "From"),
      pickField(source, "FromFull", "fromFull", "from_full"),
      pickField(headers, "from"),
      pickField(envelope, "from"),
      pickField(source, "envelope[from]"),
      pickField(source, "sender", "Sender"),
    ];
    const parsedFrom = fromCandidates.map((candidate) => parseAddress(candidate));

    let from = "";
    let fromName: string | null = null;
    for (const parsed of parsedFrom) {
      if (parsed.address) {
        from = parsed.address;
        fromName = parsed.name;
        break;
      }
    }
    if (from && !fromName) {
      // The envelope may hold the address while the header holds the name.
      for (const parsed of parsedFrom) {
        if (parsed.address === from && parsed.name) {
          fromName = parsed.name;
          break;
        }
      }
    }
    if (!from && !fromName) {
      for (const parsed of parsedFrom) {
        if (parsed.name) {
          fromName = parsed.name;
          break;
        }
      }
    }

    // --- subject ------------------------------------------------------------
    // Collapsed to one line: folded headers arrive with embedded newlines and
    // the hint regexes below are line-oriented.
    const subjectRaw =
      firstString(pickField(source, "subject", "Subject"), pickField(headers, "subject")) ?? "";
    const subject = subjectRaw.replace(/\s+/g, " ").trim();

    // --- text ---------------------------------------------------------------
    const plain = firstString(
      pickField(source, "plain"), // CloudMailin
      pickField(source, "text"), // CloudMailin v2 / SendGrid
      pickField(source, "TextBody"), // Postmark
      pickField(source, "body-plain"), // Mailgun
    );
    let text = plain ?? "";
    if (text === "") {
      const html = firstString(
        pickField(source, "html"),
        pickField(source, "HtmlBody"),
        pickField(source, "body-html"),
      );
      text = html ? htmlToText(html) : "";
    } else {
      text = text.replace(/\r\n?/g, "\n").trim();
    }

    // --- attachments --------------------------------------------------------
    const attachments = [
      ...normalizeFileList(files),
      ...collectEmbeddedAttachments(pickField(source, "attachments", "Attachments")),
    ]
      .filter(isLikelyReceiptAttachment)
      .slice(0, MAX_ATTACHMENTS)
      .map((att, index) => ({ ...att, filename: fallbackFilename(att, index) }));

    return { from, fromName, subject, text, attachments };
  } catch {
    // Total by contract: a malformed payload yields an empty email, never a throw.
    return empty;
  }
}

function normalizeFileList(files: { filename: string; contentType: string; content: Buffer }[]): InboundAttachment[] {
  if (!Array.isArray(files)) return [];
  const out: InboundAttachment[] = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const content = toBuffer((file as { content?: unknown }).content);
    if (!content) continue;
    out.push({
      filename: safeFilename(asTrimmedString((file as { filename?: unknown }).filename)),
      contentType: asTrimmedString((file as { contentType?: unknown }).contentType) ?? "",
      content,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Receipt heuristics — shared bits
// ---------------------------------------------------------------------------

/**
 * `[0-9,]+\.[0-9]{2}` plus a "not followed by another digit" guard, so a
 * three-decimal number (`1.234`) is skipped instead of being silently
 * truncated to `1.23`.
 */
const AMOUNT = "(?<amt>[0-9,]+\\.[0-9]{2})(?![0-9])";

/**
 * Labelled totals, best-first. Every pattern starts with `(?:^|[^a-z])` (with
 * the /i flag that also excludes A–Z), so a label can only match on a word
 * boundary. The total pattern additionally swallows an optional "sub" into a
 * named group and the caller drops those matches — the sub-total is the one
 * number on a receipt that is reliably NOT the total, in either spelling
 * ("Subtotal", "Sub-total"). `[^\n$0-9]{0,20}` allows the label-to-amount
 * filler ("&nbsp;due:", " — USD ") while refusing to jump across a line break
 * into an unrelated column.
 */
const TOTAL_PATTERNS: RegExp[] = [
  new RegExp(
    `(?:^|[^a-z])(?<sub>sub[\\s_-]*)?(?:order\\s+|grand\\s+)?total\\b[^\\n$0-9]{0,20}\\$?\\s*${AMOUNT}`,
    "gi",
  ),
  new RegExp(`(?:^|[^a-z])amount\\s+(?:paid|charged)\\b[^\\n$0-9]{0,20}\\$?\\s*${AMOUNT}`, "gi"),
  new RegExp(`(?:^|[^a-z])you\\s+paid\\b[^\\n$0-9]{0,20}\\$?\\s*${AMOUNT}`, "gi"),
  new RegExp(`(?:^|[^a-z])charged\\b[^\\n$0-9]{0,20}\\$?\\s*${AMOUNT}`, "gi"),
];

const BARE_AMOUNT_RE = new RegExp(`\\$\\s*${AMOUNT}`, "g");

/** Only trust a bare "biggest dollar figure" reading if the mail looks like a receipt at all. */
const RECEIPTISH_RE = /\b(receipt|invoice|order|payment|purchase|total)\b/i;

/** `tax(es)` — the `%` follow-up is rejected at the call site ("Tax rate 8.25%").
 *  The lookbehinds keep "Total BEFORE TAX: $20.99" / "pre-tax" lines — which
 *  name the untaxed subtotal, not the tax — from being read as a tax amount
 *  (bit an Amazon order summary on 2026-08-21). */
const TAX_RE = new RegExp(
  `(?:^|[^a-z])(?<!before )(?<!pre[- ])(?:sales\\s+)?tax(?:es)?\\b[^\\n$0-9]{0,20}\\$?\\s*${AMOUNT}`,
  "gi",
);

const RECEIPT_NUMBER_RE =
  /\b(?:order|receipt|invoice|confirmation|transaction)\s*(?:#|no\.?|number|id)\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]{3,24})/i;

function toCents(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  // 0.00 is almost always a zeroed "balance due" line, not the purchase price,
  // and a negative reading means we matched a refund/credit column.
  if (value <= 0) return null;
  if (value > MAX_PLAUSIBLE_DOLLARS) return null;
  return Math.round(value * 100);
}

function largestCents(text: string, pattern: RegExp): number | null {
  let best: number | null = null;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.groups?.sub) continue; // "Subtotal" / "Sub-total" — never the total
    const cents = toCents(match.groups?.amt ?? match[1] ?? "");
    if (cents !== null && (best === null || cents > best)) best = cents;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Receipt heuristics — dates
// ---------------------------------------------------------------------------

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const US_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;
const MONTH_D_Y_RE = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi");
const D_MONTH_Y_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, "gi");
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** Labels that introduce the purchase date. Longest alternatives first. */
const DATE_LABEL_RE =
  /(?:^|[^a-z])(?:transaction\s+date|order\s+date|date\s+of\s+(?:purchase|order|sale)|order\s+placed(?:\s+on)?|placed\s+on|purchased(?:\s+on)?|ordered(?:\s+on)?|date)\b/gi;

/**
 * Local noon, exactly like `parseDateInput` in dates.ts — a midnight timestamp
 * shifts the calendar day whenever the server and the owner disagree about the
 * timezone, and the calendar day is the whole point of a receipt date.
 */
function buildDate(year: number, month1: number, day: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month1) || !Number.isFinite(day)) return null;
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month1 - 1, day, 12, 0, 0, 0);
  // Round-trip check rejects Feb 30 and friends.
  if (date.getFullYear() !== year || date.getMonth() !== month1 - 1 || date.getDate() !== day) return null;
  if (year < 2000) return null; // pre-2000 means we parsed a version string / phone number
  if (date.getTime() > Date.now() + MAX_FUTURE_MS) return null; // a future receipt is a mis-parse
  return date;
}

function monthFromToken(token: string): number | null {
  const index = MONTH_INDEX[token.slice(0, 3).toLowerCase()];
  return index === undefined ? null : index + 1;
}

function scanUsDate(text: string): Date | null {
  US_DATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = US_DATE_RE.exec(text)) !== null) {
    const rawYear = match[3] ?? "";
    // Two-digit years are read as 20xx; anything that implies 19xx or a far
    // future year is rejected by buildDate rather than guessed at.
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const date = buildDate(year, Number(match[1]), Number(match[2]));
    if (date) return date;
  }
  return null;
}

function scanMonthNameDate(text: string): Date | null {
  MONTH_D_Y_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONTH_D_Y_RE.exec(text)) !== null) {
    const month = monthFromToken(match[1] ?? "");
    if (month === null) continue;
    const date = buildDate(Number(match[3]), month, Number(match[2]));
    if (date) return date;
  }
  D_MONTH_Y_RE.lastIndex = 0;
  while ((match = D_MONTH_Y_RE.exec(text)) !== null) {
    const month = monthFromToken(match[2] ?? "");
    if (month === null) continue;
    const date = buildDate(Number(match[3]), month, Number(match[1]));
    if (date) return date;
  }
  return null;
}

function scanIsoDate(text: string): Date | null {
  ISO_DATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ISO_DATE_RE.exec(text)) !== null) {
    const date = buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) return date;
  }
  return null;
}

function scanAnyDate(text: string): Date | null {
  return scanUsDate(text) ?? scanMonthNameDate(text) ?? scanIsoDate(text);
}

function findReceiptDate(haystack: string): Date | null {
  // 1. A labelled date wins — look only at the ~40 characters after the label
  //    so we cannot drift onto an unrelated date further down the mail.
  DATE_LABEL_RE.lastIndex = 0;
  let label: RegExpExecArray | null;
  while ((label = DATE_LABEL_RE.exec(haystack)) !== null) {
    const start = label.index + label[0].length;
    const found = scanAnyDate(haystack.slice(start, start + 40));
    if (found) return found;
  }
  // 2/3. Otherwise the first plausible date anywhere in the mail.
  return scanAnyDate(haystack);
}

// ---------------------------------------------------------------------------
// Receipt heuristics — vendor
// ---------------------------------------------------------------------------

const FORWARD_PREFIX_RE = /^\s*(?:(?:fwd|fw|re|aw|tr)\s*:\s*)+/i;
const FORWARDED_FROM_RE = /^\s*from:\s*(.+)$/gim;

function titleCase(input: string): string {
  return input.replace(/[a-z0-9]+/gi, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function cleanVendorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.replace(/[\u0000-\u001f\u007f]+/g, " ");
  name = name.replace(/^["'`(\[<\s]+/, "").replace(/["'`)\]>\s]+$/, "");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/[\s.,:;|_–—-]+$/, "").trim();
  if (name.length < 2 || name.length > 60) return null;
  if (name.includes("@")) return null; // an address is not a display name
  if (!/[a-z]/i.test(name)) return null; // pure punctuation / digits
  return name;
}

/** "orders@homedepot.com" → "Homedepot"; free-mail and bare hosts → null. */
function vendorFromDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).replace(/\.$/, "").toLowerCase();
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null;

  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  while (labels.length > 2 && GENERIC_SUBDOMAINS.has(labels[0])) labels.shift();

  // Drop the public suffix: two labels for co.uk / com.au shapes, else one.
  const last = labels[labels.length - 1] ?? "";
  const secondLast = labels[labels.length - 2] ?? "";
  const cut =
    labels.length >= 3 && last.length === 2 && ["co", "com", "net", "org", "ac", "gov", "edu"].includes(secondLast)
      ? 2
      : 1;
  const registrable = labels.slice(0, Math.max(1, labels.length - cut));
  const nameLabel = registrable[registrable.length - 1] ?? "";
  if (nameLabel.length < 2) return null;
  return cleanVendorName(titleCase(nameLabel.replace(/_+/g, "-")));
}

function findVendorName(subject: string, text: string, ownerAddress: string): string | null {
  // 1. The inner "From:" of a forwarded message. The OUTER sender is the owner
  //    forwarding their own mail, so any From: line matching them is skipped.
  FORWARDED_FROM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORWARDED_FROM_RE.exec(text)) !== null) {
    const parsed = parseAddress(match[1] ?? "");
    if (!parsed.address && !parsed.name) continue;
    if (parsed.address && ownerAddress && parsed.address === ownerAddress) continue;
    const display = cleanVendorName(parsed.name);
    if (display) return display;
    const fromDomain = parsed.address ? vendorFromDomain(parsed.address) : null;
    if (fromDomain) return fromDomain;
  }

  const strippedSubject = subject.replace(FORWARD_PREFIX_RE, "").trim();

  // 2. "Your receipt from Acme Hardware" / "Invoice at Tractor Supply".
  const phrased = /(?:receipt|invoice|order|confirmation)\s+(?:from|at)\s+([A-Z][\w& '.-]{1,40})/i.exec(
    strippedSubject,
  );
  const phrasedName = cleanVendorName(phrased?.[1]);
  if (phrasedName) return phrasedName;

  // 3. Vendors often lead the subject with their own name ("Acme Hardware —
  //    Order #123"). Only accept it when it isn't boilerplate.
  const segment = strippedSubject.split(/[|,–—]|\s-\s/)[0] ?? "";
  if (!GENERIC_SUBJECT_START.test(segment.trim())) {
    const leading = cleanVendorName(segment);
    if (leading && leading.length >= 2 && leading.length <= 40) return leading;
  }

  // 4. Nothing trustworthy — leave it blank for the operator.
  return null;
}

// ---------------------------------------------------------------------------
// extractReceiptHints
// ---------------------------------------------------------------------------

/**
 * Best-effort field extraction from a forwarded receipt. Everything is
 * optional and everything defaults to null: these values land in the Inbox
 * review form, where a blank costs one tap and a wrong number can quietly
 * become a wrong expense.
 */
export function extractReceiptHints(email: NormalizedEmail): ReceiptHints {
  const empty: ReceiptHints = {
    vendorName: null,
    totalCents: null,
    salesTaxCents: null,
    receiptDate: null,
    receiptNumber: null,
  };

  try {
    if (!email || typeof email !== "object") return empty;
    const subject = typeof email.subject === "string" ? email.subject : "";
    const text = (typeof email.text === "string" ? email.text : "").replace(/\r\n?/g, "\n");
    const ownerAddress = typeof email.from === "string" ? email.from.toLowerCase() : "";
    const haystack = `${subject}\n${text}`;
    if (haystack.trim() === "") return empty;

    // --- total --------------------------------------------------------------
    // Labelled amounts first; among them the largest wins, because the total
    // is by construction bigger than the tax / shipping / item lines that share
    // the same label vocabulary.
    let totalCents: number | null = null;
    for (const pattern of TOTAL_PATTERNS) {
      const candidate = largestCents(haystack, pattern);
      if (candidate !== null && (totalCents === null || candidate > totalCents)) totalCents = candidate;
    }
    if (totalCents === null && RECEIPTISH_RE.test(haystack)) {
      // Fallback: the biggest bare $-amount, but only in mail that at least
      // claims to be a receipt. Without that guard any email mentioning a price
      // would auto-fill an expense.
      totalCents = largestCents(haystack, BARE_AMOUNT_RE);
    }

    // --- sales tax ----------------------------------------------------------
    let salesTaxCents: number | null = null;
    TAX_RE.lastIndex = 0;
    let taxMatch: RegExpExecArray | null;
    while ((taxMatch = TAX_RE.exec(haystack)) !== null) {
      const tail = haystack.slice(taxMatch.index + taxMatch[0].length, taxMatch.index + taxMatch[0].length + 2);
      if (/^\s*%/.test(tail)) continue; // "Tax rate 8.25%" is a rate, not an amount
      const cents = toCents(taxMatch.groups?.amt ?? taxMatch[1] ?? "");
      if (cents === null) continue;
      salesTaxCents = cents;
      break; // first real tax line; later ones are per-item breakdowns
    }
    // Tax that equals or exceeds the total means we matched the wrong number.
    if (salesTaxCents !== null && totalCents !== null && salesTaxCents >= totalCents) salesTaxCents = null;

    // --- date ---------------------------------------------------------------
    const receiptDate = findReceiptDate(haystack);

    // --- receipt number -----------------------------------------------------
    const numberMatch = RECEIPT_NUMBER_RE.exec(haystack);
    let receiptNumber: string | null = null;
    if (numberMatch) {
      const candidate = (numberMatch[1] ?? "").replace(/-+$/, "").trim();
      // Require a digit: it rules out "Order status: Pending" style captures
      // while keeping every real order/invoice id we've seen.
      if (candidate.length >= 4 && /[0-9]/.test(candidate)) receiptNumber = candidate;
    }

    // --- vendor -------------------------------------------------------------
    const vendorName = findVendorName(subject, text, ownerAddress);

    return { vendorName, totalCents, salesTaxCents, receiptDate, receiptNumber };
  } catch {
    return empty;
  }
}
