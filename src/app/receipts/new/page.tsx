import { PAYMENT_METHODS } from "@/lib/domain";
import { toDateInputValue } from "@/lib/dates";
import { Card, PageHeader, inputCls, labelCls } from "@/components/ui";
import ReceiptUploader from "@/components/ReceiptUploader";

export const dynamic = "force-dynamic";

export default function NewReceiptPage() {
  // Blob storage lets the browser upload straight to storage, which is the
  // only way a full-size phone photo gets through reliably.
  const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  // Without a Blob store, files are kept in the database instead — that works
  // fine for photos and normal PDFs, so this is information, not an alarm.
  const usingDbStorage = Boolean(process.env.VERCEL) && !blobEnabled;

  return (
    <div>
      <PageHeader
        title="Add receipt"
        sub="Snap it or pick a file — details are optional, categorize later."
      />
      {usingDbStorage ? (
        <div className="mb-4 rounded-xl border border-stone-200 bg-stone-100 px-3 py-2 text-xs text-stone-600">
          Files are kept in the database on this deployment (fine for photos and normal PDFs, up
          to ~4 MB). For bigger files, connect the Blob store: Vercel → project → Storage.
        </div>
      ) : null}
      <Card>
        {/* The uploader reads these fields when it saves, so they can stay a
            plain (non-submitting) form. */}
        <form id="receipt-details">
          <details className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700">
              Vendor, date and total — tap to fill in now
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className={labelCls} htmlFor="vendorName">
                  Vendor
                </label>
                <input
                  id="vendorName"
                  name="vendorName"
                  className={inputCls}
                  placeholder="Tractor Supply Co"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="receiptDate">
                    Date
                  </label>
                  <input
                    id="receiptDate"
                    name="receiptDate"
                    type="date"
                    defaultValue={toDateInputValue(new Date())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="total">
                    Total
                  </label>
                  <input
                    id="total"
                    name="total"
                    inputMode="decimal"
                    placeholder="$0.00"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="salesTax">
                    Sales tax
                  </label>
                  <input
                    id="salesTax"
                    name="salesTax"
                    inputMode="decimal"
                    placeholder="$0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="paymentMethod">
                    Payment method
                  </label>
                  <select id="paymentMethod" name="paymentMethod" className={inputCls} defaultValue="">
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor="receiptNumber">
                  Receipt #
                </label>
                <input id="receiptNumber" name="receiptNumber" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="notes">
                  Notes
                </label>
                <textarea id="notes" name="notes" rows={2} className={inputCls} />
              </div>
            </div>
          </details>
        </form>

        <ReceiptUploader blobEnabled={blobEnabled} />
      </Card>
    </div>
  );
}
