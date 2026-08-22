import Link from "next/link";
import { ACCOUNTING_CATEGORIES } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { Card, Chip, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { addReceiptLine, removeReceiptLine, updateReceiptLine } from "./actions";
import {
  linesTotalCents,
  linesVsTotalNote,
  splitByCategory,
  uncategorized,
  type LineLike,
} from "./receipt-lines";

// FR-006 — itemise a receipt.
//
// Everything about this card is optional: a receipt with no lines is a
// perfectly good receipt, and lines that don't add up to the total are only
// ever REPORTED, never refused. A hardware receipt legitimately splits across
// two categories, and the tax on it legitimately makes the lines come up
// short — the app says so plainly and gets out of the way.

type StoredLine = LineLike & { id: string };

const smallLabelCls = "mb-1 block text-xs font-medium text-stone-500";

function CategorySelect({
  id,
  defaultValue,
}: {
  id: string;
  defaultValue: string | null | undefined;
}) {
  return (
    <select
      id={id}
      name="accountingCategory"
      defaultValue={defaultValue ?? ""}
      className={inputCls}
    >
      <option value="">No category yet</option>
      {ACCOUNTING_CATEGORIES.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

export default function ReceiptLines({
  receiptId,
  lines,
  totalCents,
  salesTaxCents,
  canCategorize,
  typed,
}: {
  receiptId: string;
  lines: StoredLine[];
  totalCents: number | null;
  salesTaxCents: number | null;
  /** False once the receipt is already filed as an expense. */
  canCategorize: boolean;
  /** What was typed into the add-a-line form when a save was rejected. */
  typed?: { description?: string; quantity?: string; amount?: string; category?: string };
}) {
  const linesTotal = linesTotalCents(lines);
  const note = linesVsTotalNote(linesTotal, totalCents, salesTaxCents, formatCents);
  const byCategory = splitByCategory(lines);
  const leftover = uncategorized(lines);

  return (
    <Card className="mb-4">
      <h2 className="font-semibold text-stone-900">What was on this receipt</h2>
      <p className="mt-0.5 text-sm text-stone-500">
        One line per thing you bought. Optional — fill in as much or as little as you like.
      </p>

      {lines.length > 0 ? (
        <div className="mt-3 space-y-3">
          {lines.map((line, i) => (
            <div key={line.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <form action={updateReceiptLine} className="space-y-2">
                <input type="hidden" name="receiptId" value={receiptId} />
                <input type="hidden" name="lineId" value={line.id} />
                <div>
                  <label className={smallLabelCls} htmlFor={`line-desc-${line.id}`}>
                    Line {i + 1} — what it was
                  </label>
                  <input
                    id={`line-desc-${line.id}`}
                    name="description"
                    defaultValue={line.description}
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={smallLabelCls} htmlFor={`line-qty-${line.id}`}>
                      How many
                    </label>
                    <input
                      id={`line-qty-${line.id}`}
                      name="quantity"
                      inputMode="decimal"
                      defaultValue={String(line.quantity ?? 1)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={smallLabelCls} htmlFor={`line-amount-${line.id}`}>
                      Amount
                    </label>
                    <input
                      id={`line-amount-${line.id}`}
                      name="amount"
                      inputMode="decimal"
                      defaultValue={(line.amountCents / 100).toFixed(2)}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className={smallLabelCls} htmlFor={`line-category-${line.id}`}>
                    Category (optional)
                  </label>
                  <CategorySelect
                    id={`line-category-${line.id}`}
                    defaultValue={line.accountingCategory}
                  />
                </div>
                <button type="submit" className={`${btnSecondaryCls} w-full`}>
                  Save this line
                </button>
              </form>

              {/* Its own form on purpose — forms can't nest, and removing a
                  line must never be a side effect of saving one. */}
              <form action={removeReceiptLine} className="mt-2 text-right">
                <input type="hidden" name="receiptId" value={receiptId} />
                <input type="hidden" name="lineId" value={line.id} />
                <button
                  type="submit"
                  className="px-2 py-1 text-sm font-medium text-red-600 underline-offset-2 active:underline"
                >
                  Remove line {i + 1}
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div
          className={`mt-3 rounded-xl border p-3 ${
            note?.tone === "differs"
              ? "border-amber-300 bg-amber-50"
              : "border-stone-200 bg-stone-50"
          }`}
        >
          <p
            className={`text-base font-semibold ${
              note?.tone === "differs" ? "text-amber-900" : "text-stone-800"
            }`}
          >
            {note
              ? note.text
              : `Lines add up to ${formatCents(linesTotal)} — the receipt has no total filled in yet.`}
          </p>
          {note?.tone === "differs" ? (
            <p className="mt-1 text-sm text-amber-800">
              That&apos;s fine — sales tax, fees or a missed line usually explain it. Nothing is
              blocked and nothing needs fixing unless you want to.
            </p>
          ) : null}

          {byCategory.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {byCategory.map((c) => (
                <Chip key={c.accountingCategory} tone="stone">
                  {c.accountingCategory} · {formatCents(c.amountCents)}
                </Chip>
              ))}
              {leftover.lineCount > 0 ? (
                <Chip tone="amber">
                  No category yet · {formatCents(leftover.amountCents)}
                </Chip>
              ) : null}
            </div>
          ) : null}

          {byCategory.length > 1 && canCategorize ? (
            <p className="mt-2 text-sm text-stone-600">
              This receipt covers {byCategory.length} categories.{" "}
              <Link
                href={`/expenses/new?fromReceipt=${receiptId}`}
                className="font-semibold text-oak-700 underline"
              >
                You can file it as one expense per category
              </Link>{" "}
              when you categorize it.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-stone-200 p-3">
        <h3 className="mb-2 text-sm font-semibold text-stone-800">
          {lines.length > 0 ? "Add another line" : "Add the first line"}
        </h3>
        <form action={addReceiptLine} className="space-y-2">
          <input type="hidden" name="receiptId" value={receiptId} />
          <div>
            <label className={labelCls} htmlFor="new-line-description">
              What it was
            </label>
            <input
              id="new-line-description"
              name="description"
              defaultValue={typed?.description ?? ""}
              placeholder="Hydraulic hose"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={smallLabelCls} htmlFor="new-line-quantity">
                How many
              </label>
              <input
                id="new-line-quantity"
                name="quantity"
                inputMode="decimal"
                defaultValue={typed?.quantity ?? "1"}
                className={inputCls}
              />
            </div>
            <div>
              <label className={smallLabelCls} htmlFor="new-line-amount">
                Amount
              </label>
              <input
                id="new-line-amount"
                name="amount"
                inputMode="decimal"
                defaultValue={typed?.amount ?? ""}
                placeholder="$0.00"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={smallLabelCls} htmlFor="new-line-category">
              Category (optional)
            </label>
            <CategorySelect id="new-line-category" defaultValue={typed?.category} />
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Add line
          </button>
        </form>
      </div>
    </Card>
  );
}
