"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, btnSecondaryCls } from "@/components/ui";
import { archiveDuplicateReceipt } from "./actions";

// SPEC §4 — "wait, did I already save this one?"
//
// A warning, never a gate. It sits beside the receipt, it never blocks a
// save, and the only thing it can do to a record is archive it — the original
// photo and the row stay forever, exactly like every other receipt.
//
// Client-side only for the dismiss: tapping "different purchase" hides the
// card for this visit without writing anything anywhere.
export default function DuplicateWarning({
  receiptId,
  headline,
  why,
  otherReceiptId,
  otherLabel,
}: {
  /** The receipt being looked at — the one that would be archived. */
  receiptId: string;
  /** duplicateHeadline() from src/lib/receipt-dupes.ts. */
  headline: string;
  /** The plain-English reason, e.g. "Same receipt number (4471-22)." */
  why: string;
  otherReceiptId: string;
  /** What the other receipt shows ("Aug 14, 2026 · $44.87"), for the link
   *  text. Empty when that receipt has no date or total yet. */
  otherLabel?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
      <p className="text-base font-semibold text-amber-900">⚠️ {headline}</p>
      <p className="mt-1 text-sm text-amber-800">{why}</p>

      <div className="mt-3 space-y-2">
        <Link href={`/receipts/${otherReceiptId}`} className={`${btnSecondaryCls} w-full`}>
          Open the other receipt{otherLabel ? ` · ${otherLabel}` : ""}
        </Link>

        <form action={archiveDuplicateReceipt}>
          <input type="hidden" name="id" value={receiptId} />
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-100 px-4 py-2.5 text-base font-semibold text-amber-900 active:bg-amber-200"
          >
            Yes, it&apos;s a duplicate — archive this one
          </button>
        </form>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={`${btnSecondaryCls} w-full`}
        >
          No, it&apos;s a different purchase
        </button>
      </div>

      <p className="mt-2 text-xs text-amber-700">
        Archiving keeps the receipt and its original photo forever — nothing is deleted, and
        nothing here stops you saving.
      </p>
    </Card>
  );
}
