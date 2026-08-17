// Creates a receipt from an upload. Accepts either shape:
//   • JSON  — the browser already put the file in blob storage and sends the
//             resulting URL (the path that survives big files);
//   • multipart — the file itself, for local dev where blob isn't configured.
// Behind the login gate, like everything else that touches records.

import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
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
  const contentType = req.headers.get("content-type") ?? "";

  let filePath: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let fields: Record<string, string | null> = {};

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
      if (file instanceof File && file.size > 0) {
        const stored = await saveUpload(file);
        filePath = stored.storageKey;
        fileName = stored.fileName;
        mimeType = stored.mimeType;
        fileSize = stored.fileSize;
      }
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
    console.error("[receipt-create] unreadable request:", e);
    return Response.json({ ok: false, error: "That upload didn't come through." }, { status: 400 });
  }

  try {
    const receipt = await prisma.receipt.create({
      data: {
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
