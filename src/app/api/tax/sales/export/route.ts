// Sales tax downloads for one month: the accountant's workbook (.xlsx) and
// the two bookkeeping CSVs. Live figures by default; ?snapshot=<id>
// regenerates a saved close/correction exactly. None of these files is a
// My Alabama Taxes upload file.

import { prisma } from "@/lib/db";
import { currentAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { isValidPeriod } from "@/lib/sales-tax/format";
import { computeMonth } from "@/lib/sales-tax/load";
import { salesLinesCsv, taxComponentsCsv } from "@/lib/sales-tax/csv";
import { salesTaxWorkbook, type WorkbookMeta } from "@/lib/sales-tax/workbook";
import type { EngineResult } from "@/lib/sales-tax/types";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function download(body: BodyInit, type: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const accountId = await currentAccountId();
  if (!accountId) return new Response("Sign in first.", { status: 401 });

  const url = new URL(req.url);
  const period = url.searchParams.get("period");
  const format = url.searchParams.get("format") ?? "xlsx";
  const snapshotId = url.searchParams.get("snapshot");
  if (!isValidPeriod(period)) return new Response("Bad month.", { status: 400 });
  if (!["xlsx", "lines", "components"].includes(format))
    return new Response("Bad format.", { status: 400 });

  let result: EngineResult;
  let snapshot: WorkbookMeta["snapshot"] = null;
  let tag: string;
  if (snapshotId) {
    const snap = await prisma.salesTaxSnapshot.findFirst({
      where: { id: snapshotId, accountId, period },
    });
    if (!snap) return new Response("Not found.", { status: 404 });
    result = JSON.parse(snap.snapshotJson) as EngineResult;
    snapshot = {
      id: snap.id,
      kind: snap.kind,
      reviewerName: snap.reviewerName,
      createdAt: snap.createdAt.toISOString(),
    };
    tag = `${snap.kind === "CORRECTION" ? "correction" : "closed"}-${snap.createdAt.toISOString().slice(0, 10)}`;
  } else {
    result = await computeMonth(accountId, period);
    tag = result.readyToFile ? "preview" : "draft";
  }

  if (format === "lines") {
    return download(
      salesLinesCsv(result),
      "text/csv; charset=utf-8",
      `sales_lines_${period}_${tag}.csv`,
    );
  }
  if (format === "components") {
    return download(
      taxComponentsCsv(result),
      "text/csv; charset=utf-8",
      `tax_components_${period}_${tag}.csv`,
    );
  }
  const profile = await getBusinessProfile(accountId);
  const bytes = salesTaxWorkbook(result, {
    businessName: profile.name,
    appUrl: url.origin,
    snapshot,
  });
  return download(bytes as Uint8Array<ArrayBuffer>, XLSX_TYPE, `sales-tax-${period}_${tag}.xlsx`);
}
