import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { toDateInputValue } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/domain";
import { animalLabel, compareTags } from "@/lib/livestock";
import {
  Card,
  FormError,
  PageHeader,
  btnPrimaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { createLivestockSale } from "../../actions";
import { saleErrorMessage } from "../../livestock-bits";

export const dynamic = "force-dynamic";

export default async function NewLivestockSalePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; animalId?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error, animalId } = await searchParams;

  const [animals, customers] = await Promise.all([
    prisma.animal.findMany({
      where: { accountId },
      select: { id: true, tagNumber: true, name: true, status: true },
    }),
    prisma.customer.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const sorted = animals.sort((a, b) => compareTags(a.tagNumber, b.tagNumber));

  return (
    <div>
      <PageHeader
        title="Record a sale"
        sub="Saving this puts the money in your farm income and marks the animal sold."
      />

      {error ? <FormError>{saleErrorMessage(error)}</FormError> : null}

      <Card>
        <form action={createLivestockSale} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="animalId">
              Which animal?
            </label>
            <select
              id="animalId"
              name="animalId"
              defaultValue={animalId ?? ""}
              className={inputCls}
            >
              <option value="">No particular animal</option>
              {sorted.map((a) => (
                <option key={a.id} value={a.id}>
                  {animalLabel(a)}
                  {a.status === "SOLD" ? " (already sold)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="customerId">
              Buyer — one of your customers
            </label>
            <select id="customerId" name="customerId" defaultValue="" className={inputCls}>
              <option value="">Not one of my customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="buyerName">
              …or just type the buyer&apos;s name
            </label>
            <input
              id="buyerName"
              name="buyerName"
              placeholder="Hank Miller"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-stone-500">
              Pick a customer above or type a name here — one of the two.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="date">
                Date sold *
              </label>
              <input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={toDateInputValue(new Date())}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="salePrice">
                Sale price *
              </label>
              <input
                id="salePrice"
                name="salePrice"
                inputMode="decimal"
                required
                placeholder="$0.00"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="weightLbs">
                Weight at sale (lbs)
              </label>
              <input
                id="weightLbs"
                name="weightLbs"
                inputMode="decimal"
                placeholder="95"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="paymentMethod">
                Paid by
              </label>
              <select id="paymentMethod" name="paymentMethod" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="processingNotes">
              Processing arrangements
            </label>
            <input
              id="processingNotes"
              name="processingNotes"
              placeholder="Dropped at the locker Tuesday, buyer picks up cut & wrapped"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="notes">
              Notes
            </label>
            <textarea id="notes" name="notes" rows={2} className={inputCls} />
          </div>

          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save sale
          </button>
        </form>
      </Card>
    </div>
  );
}
