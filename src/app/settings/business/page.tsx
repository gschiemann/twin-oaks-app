import Link from "next/link";
import { getBusinessProfile } from "@/lib/business";
import { fileSrc } from "@/lib/storage";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls, inputCls, labelCls } from "@/components/ui";
import { removeLogo, saveBusinessProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const p = await getBusinessProfile();

  return (
    <div>
      <PageHeader
        title="Business profile"
        sub="Enter it once — invoices, quotes, packing lists and receipts all use it."
      />

      {saved ? (
        <Card className="mb-4 border-oak-200 bg-oak-50 text-sm text-oak-900">
          ✅ Saved. New documents will use these details.
        </Card>
      ) : null}

      <Card className="mb-4">
        <form action={saveBusinessProfile} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="name">
              Business name *
            </label>
            <input id="name" name="name" required defaultValue={p.name} className={inputCls} />
          </div>

          <div>
            <label className={labelCls} htmlFor="addressLine1">
              Street address
            </label>
            <input
              id="addressLine1"
              name="addressLine1"
              defaultValue={p.addressLine1 ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="addressLine2">
              Address line 2
            </label>
            <input
              id="addressLine2"
              name="addressLine2"
              defaultValue={p.addressLine2 ?? ""}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="city">
                City
              </label>
              <input id="city" name="city" defaultValue={p.city ?? ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="state">
                State
              </label>
              <input id="state" name="state" defaultValue={p.state ?? ""} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="postalCode">
                ZIP
              </label>
              <input
                id="postalCode"
                name="postalCode"
                defaultValue={p.postalCode ?? ""}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="phone">
                Phone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={p.phone ?? ""}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={p.email ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="website">
              Website
            </label>
            <input
              id="website"
              name="website"
              defaultValue={p.website ?? ""}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="defaultTaxRatePercent">
              Default sales-tax rate %
            </label>
            <input
              id="defaultTaxRatePercent"
              name="defaultTaxRatePercent"
              inputMode="decimal"
              defaultValue={p.defaultTaxRatePercent || ""}
              placeholder="0"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-stone-500">
              New invoices start at this rate and calculate tax on taxable lines
              automatically. You can change the rate on any single invoice, and the rate
              actually used is stored with it — changing this later never alters an invoice
              you already sent.
            </p>
          </div>

          <div>
            <label className={labelCls} htmlFor="logo">
              Logo
            </label>
            {p.logoPath ? (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileSrc(p.logoPath)}
                  alt="Business logo"
                  className="h-16 w-auto rounded-lg border border-stone-200 bg-white p-1"
                />
                <span className="text-xs text-stone-500">Upload a new file to replace it.</span>
              </div>
            ) : null}
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/*"
              className="w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-oak-700 file:px-4 file:py-2 file:font-semibold file:text-white"
            />
          </div>

          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Save business profile
          </button>
        </form>
      </Card>

      {p.logoPath ? (
        <form action={removeLogo} className="mb-4 text-center">
          <button type="submit" className="text-sm font-medium text-red-600">
            Remove logo
          </button>
        </form>
      ) : null}

      <Card className="mb-4 border-stone-200 bg-stone-50 text-sm text-stone-600">
        <p className="font-medium text-stone-800">Already-sent documents stay put.</p>
        <p className="mt-1">
          When an invoice or quote is marked as sent, these details are frozen onto it. Change
          your address here and last year&apos;s invoices still show the address they were
          issued with — which is exactly what an auditor expects.
        </p>
      </Card>

      <Link href="/more" className={btnSecondaryCls}>
        Back to More
      </Link>
    </div>
  );
}
