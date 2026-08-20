// Creates a receipt from an upload. Accepts either shape:
//   • JSON  — the browser already put the file in blob storage and sends the
//             resulting URL (the path that survives big files);
//   • multipart — the file itself, for local dev where blob isn't configured.
// Behind the login gate, like everything else that touches records.

import { prisma } from "@/lib/db";
import { currentAccountId } from "@/lib/auth";
import { StorageNotConnectedError, saveUpload } from "@/lib/storage";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function str(v: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function POST(req: Request) {
  const accountId = await currentAccountId();
  if (!accountId) {
    return Response.json(
      { ok: false, error: "Your sign-in expired — refresh and sign in again." },
      { status: 401 },
    );
  }
  const contentType = req.headers.get("content-type") ?? "";
  const contentLength = req.headers.get("content-length") ?? "?";

  let filePath: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let upload: File | null = null;
  let fields: Record<string, string | null> = {};

  // Stage 1: read the body. Each failure mode gets its own words — one
  // catch-all string here cost a day of blind debugging on an iPad once.
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      filePath = str(body.storageKey as string);
      fileName = str(body.fileName as string);
      mimeType = str(body.mimeType as string);
      fileSize = typeof body.fileSize === "number" ? body.fileSize : null;
      fields = {
        vendorName: str(body.vendorName as string),
        receiptDate: str(body.receiptDate as string),
        total: str(body.total as string),
        salesTax: str(body.salesTax as string),
        paymentMethod: str(body.paymentMethod as string),
        receiptNumber: str(body.receiptNumber as string),
        notes: str(body.notes as string),
      };
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) upload = file;
      fields = {
        vendorName: str(form.get("vendorName")),
        receiptDate: str(form.get("receiptDate")),
        total: str(form.get("total")),
        salesTax: str(form.get("salesTax")),
        paymentMethod: str(form.get("paymentMethod")),
        receiptNumber: str(form.get("receiptNumber")),
        notes: str(form.get("notes")),
      };
    }
  } catch (e) {
    console.error(
      `[receipt-create] unreadable body (content-type="${contentType}", content-length=${contentLength}):`,
      e,
    );
    return Response.json(
      {
        ok: false,
        error:
          "The save request arrived without its contents — usually a file the device couldn't read at send time. If it lives in iCloud, open it once in the Files app so it downloads, then pick it again.",
      },
      { status: 400 },
    );
  }

  // Stage 2: a picked file that reads as zero bytes is the iOS lazy-download
  // signature (an iCloud item that was never materialized on the device).
  if (upload && upload.size === 0) {
    console.error(`[receipt-create] zero-byte file "${upload.name}" (${upload.type})`);
    return Response.json(
      {
        ok: false,
        error:
          "That file arrived empty (0 bytes). Open it once in the Files app so it downloads from iCloud, then pick it again.",
      },
      { status: 400 },
    );
  }

  // Stage 3: put the file somewhere durable. A storage failure must never be
  // reported as a transfer failure — it sends the operator to the wrong fix.
  if (upload) {
    try {
      const stored = await saveUpload(upload, accountId);
      filePath = stored.storageKey;
      fileName = stored.fileName;
      mimeType = stored.mimeType;
      fileSize = stored.fileSize;
    } catch (e) {
      console.error("[receipt-create] storing the file failed:", e);
      if (e instanceof StorageNotConnectedError) {
        return Response.json({ ok: false, error: e.message }, { status: 503 });
      }
      return Response.json(
        {
          ok: false,
          error:
            "The file transferred but couldn't be stored, so nothing was saved. Try again in a minute — if it keeps happening, check the Blob store on the Vercel dashboard.",
        },
        { status: 502 },
      );
    }
  }

  try {
    const receipt = await prisma.receipt.create({
      data: {
        accountId,
        status: "INBOX",
        source: "UPLOAD",
        filePath,
        fileName,
        mimeType,
        fileSize,
        vendorName: fields.vendorName,
        receiptDate: parseDateInput(fields.receiptDate),
        totalCents: parseDollarsToCents(fields.total),
        salesTaxCents: parseDollarsToCents(fields.salesTax),
        paymentMethod: fields.paymentMethod,
        receiptNumber: fields.receiptNumber,
        notes: fields.notes,
      },
    });
    return Response.json({ ok: true, id: receipt.id });
  } catch (e) {
    console.error("[receipt-create]", e);
    return Response.json({ ok: false, error: "Could not save that receipt." }, { status: 500 });
  }
}
