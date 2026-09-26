import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import {
  DERIVED_PRODUCT_TYPES,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  RATE_CLASSES,
  RATE_CLASS_LABELS,
  SALES_TAX_BASES,
  SALES_TAX_BASIS_LABELS,
  SALES_TAX_TREATMENT_LABELS,
  TAX_AUTHORITY_LEVELS,
  TAX_AUTHORITY_LEVEL_LABELS,
  TAX_TREATMENTS_SALES,
  type ProductType,
  type RateClass,
  type SalesTaxBasis,
  type SalesTaxTreatment,
  type TaxAuthorityLevel,
} from "@/lib/domain";
import { daysBetween, isoDay, ppmToPercentLabel } from "@/lib/sales-tax/format";
import { RATE_STALE_DAYS } from "@/lib/sales-tax/engine";
import { asBasis, splitIds } from "@/lib/sales-tax/load";
import {
  Card,
  Chip,
  FormError,
  PageHeader,
  SavedBanner,
  btnPrimaryCls,
  btnSecondaryCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  addRate,
  confirmRate,
  deleteAuthority,
  deleteLocation,
  deleteRate,
  saveAuthority,
  saveBasis,
  saveLocation,
  saveRule,
} from "./actions";

export const dynamic = "force-dynamic";

const SAVED: Record<string, string> = {
  basis: "Reporting basis saved.",
  authority: "Authority saved.",
  rate: "Rate added.",
  "rate-replaced": "Rate added — the one it replaces now ends the day before.",
  confirmed: "Rate re-confirmed.",
  location: "Location saved.",
  rule: "Rule saved.",
  deleted: "Deleted.",
};

const ERRORS: Record<string, string> = {
  basis: "Pick a basis and add who approved it.",
  authority: "An authority needs a name, a level and a tax type.",
  "authority-in-use": "A location still uses that authority — take it off the location first.",
  rate: "A rate needs a percent, a start date, a return code and a source.",
  "rate-dates": "The end date is before the start date.",
  "rate-overlap": "That overlaps another rate of the same class — give one of them an end date.",
  location: "A location needs a name.",
  "location-authorities": "Tick at least one tax authority.",
  "location-in-use": "Invoices or livestock sales are taxed at that location.",
  rule: "Pick a treatment and add who approved it.",
  "rule-reason": "Exempt and wholesale need a reason.",
};

// Short pointers, never decisions — a rule only exists once someone approves it.
const RULE_HINTS: Partial<Record<ProductType, string>> = {
  PRINTED_PART: "Parts you print and sell.",
  OTHER_GOODS: "Other goods you sell.",
  LIVE_LIVESTOCK: "ALDOR lists livestock among no-tax sales — confirm for yours.",
  DESIGN_STANDALONE: "Design sold on its own — ask your accountant.",
  DESIGN_WITH_PRODUCT: "Design that goes into a product you sell — ask your accountant.",
  FABRICATION_LABOR: "ALDOR: fabrication labor is part of the taxable price.",
  REPAIR_LABOR: "ALDOR: separately billed repair/install labor is generally not taxed.",
  SERVICE: "Depends on the service — ask your accountant.",
  SHIPPING: "Depends on how delivery is billed — ask your accountant.",
};

const LEVEL_ORDER: Record<string, number> = {
  STATE: 0,
  COUNTY: 1,
  CITY: 2,
  POLICE_JURISDICTION: 3,
  OTHER: 4,
};

const treatmentTone: Record<string, string> = {
  TAXABLE: "blue",
  EXEMPT: "green",
  WHOLESALE: "indigo",
  NEEDS_REVIEW: "red",
};

type AuthorityOption = { id: string; name: string; level: string };

/** Label wrapping its control, so every field is announced by name. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function LocationFields({
  authorities,
  defaults,
}: {
  authorities: AuthorityOption[];
  defaults?: {
    name: string;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string;
    postalCode: string | null;
    insideCity: boolean;
    policeJurisdiction: string | null;
    authorityIds: string[];
    notes: string | null;
  };
}) {
  const d = defaults;
  return (
    <>
      <Field label="Name *">
        <input
          name="name"
          required
          defaultValue={d?.name ?? ""}
          placeholder="Farm pickup"
          className={inputCls}
        />
      </Field>
      <Field label="Address">
        <input name="address" defaultValue={d?.address ?? ""} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <input name="city" defaultValue={d?.city ?? ""} className={inputCls} />
        </Field>
        <Field label="County">
          <input name="county" defaultValue={d?.county ?? ""} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="State">
          <input name="state" defaultValue={d?.state ?? "AL"} maxLength={2} className={inputCls} />
        </Field>
        <Field label="ZIP">
          <input
            name="postalCode"
            defaultValue={d?.postalCode ?? ""}
            inputMode="numeric"
            className={inputCls}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          name="insideCity"
          defaultChecked={d?.insideCity ?? false}
          className="accent-oak-700"
        />
        Inside city limits
      </label>
      <Field label="Police jurisdiction">
        <input
          name="policeJurisdiction"
          defaultValue={d?.policeJurisdiction ?? ""}
          placeholder="If outside the city but in its PJ"
          className={inputCls}
        />
      </Field>
      <fieldset>
        <legend className={labelCls}>Taxed by *</legend>
        {authorities.length === 0 ? (
          <p className="text-sm text-stone-500">Add tax authorities first.</p>
        ) : (
          <div className="space-y-1.5">
            {authorities.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  name="authorityIds"
                  value={a.id}
                  defaultChecked={d ? d.authorityIds.includes(a.id) : a.level === "STATE"}
                  className="accent-oak-700"
                />
                {a.name}
                <span className="text-xs text-stone-400">
                  {TAX_AUTHORITY_LEVEL_LABELS[a.level as TaxAuthorityLevel] ?? a.level}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field label="Notes">
        <input name="notes" defaultValue={d?.notes ?? ""} className={inputCls} />
      </Field>
    </>
  );
}

export default async function SalesTaxSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { saved, error } = await searchParams;

  const [profile, authoritiesRaw, locations, rules, account] = await Promise.all([
    prisma.businessProfile.findFirst({
      where: { accountId },
      select: { salesTaxBasis: true, salesTaxBasisApprovedBy: true, salesTaxBasisApprovedAt: true },
    }),
    prisma.taxAuthority.findMany({
      where: { accountId },
      include: { rates: { orderBy: [{ rateClass: "asc" }, { effectiveFrom: "desc" }] } },
      orderBy: { name: "asc" },
    }),
    prisma.taxLocation.findMany({ where: { accountId }, orderBy: { name: "asc" } }),
    prisma.salesTaxRule.findMany({ where: { accountId } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
  ]);
  const authorities = [...authoritiesRaw].sort(
    (a, b) =>
      (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || a.name.localeCompare(b.name),
  );
  const authorityById = new Map(authorities.map((a) => [a.id, a]));
  const ruleByType = new Map(rules.map((r) => [r.productType, r]));
  const basis = asBasis(profile?.salesTaxBasis);
  const me = account?.name ?? "";
  const today = isoDay(new Date());
  const hasState = authorities.some((a) => a.level === "STATE");

  // Combined general rate in force today, for a location — null if any of
  // its authorities has none (that sale couldn't be computed either).
  const combinedToday = (ids: string[]): number | null => {
    let total = 0;
    for (const id of ids) {
      const a = authorityById.get(id);
      const r = a?.rates.find(
        (x) =>
          x.rateClass === "GENERAL" &&
          isoDay(x.effectiveFrom) <= today &&
          (x.effectiveTo === null || today <= isoDay(x.effectiveTo)),
      );
      if (!r) return null;
      total += r.ratePpm;
    }
    return ids.length ? total : null;
  };

  const ruleTypes = PRODUCT_TYPES.filter((t) => !DERIVED_PRODUCT_TYPES.includes(t));

  return (
    <div>
      <PageHeader
        title="Sales tax setup"
        action={
          <Link href="/tax/sales" className={`${btnSecondaryCls} px-3 py-2 text-sm`}>
            Months
          </Link>
        }
      />

      {saved && SAVED[saved] ? <SavedBanner title={SAVED[saved]} /> : null}
      {error && ERRORS[error] ? <FormError>{ERRORS[error]}</FormError> : null}

      {/* ————————— basis ————————— */}
      <Card className="mb-4">
        <div id="basis" className="scroll-mt-20" />
        <h2 className="font-semibold text-stone-900">Reporting basis</h2>
        <p className="text-xs text-stone-500">
          Which date puts a sale in a month — an invoice issued in August and paid in September
          lands in a different month under each.
        </p>
        {basis ? (
          <p className="mt-2 text-sm text-stone-700">
            <span className="font-semibold">{SALES_TAX_BASIS_LABELS[basis]}</span>
            {profile?.salesTaxBasisApprovedBy ? ` · ${profile.salesTaxBasisApprovedBy}` : ""}
            {profile?.salesTaxBasisApprovedAt
              ? ` · ${formatDate(profile.salesTaxBasisApprovedAt)}`
              : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm font-medium text-red-700">Not chosen — filing is blocked.</p>
        )}
        <details className="mt-2" open={!basis}>
          <summary className="cursor-pointer text-sm font-medium text-oak-700">
            {basis ? "Change" : "Choose"}
          </summary>
          <form action={saveBasis} className="mt-2 space-y-3">
            <div className="space-y-1.5">
              {SALES_TAX_BASES.map((b: SalesTaxBasis) => (
                <label key={b} className="flex items-center gap-2 text-sm text-stone-800">
                  <input
                    type="radio"
                    name="basis"
                    value={b}
                    required
                    defaultChecked={basis === b}
                    className="accent-oak-700"
                  />
                  {SALES_TAX_BASIS_LABELS[b]}
                </label>
              ))}
            </div>
            <Field label="Approved by *">
              <input name="approvedBy" required defaultValue={me} className={inputCls} />
            </Field>
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Save basis
            </button>
          </form>
        </details>
      </Card>

      {/* ————————— authorities + rates ————————— */}
      <Card className="mb-4">
        <div id="authorities" className="scroll-mt-20" />
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-stone-900">Tax authorities &amp; rates</h2>
          <a
            href="https://www.revenue.alabama.gov/sales-use/city-and-county-tax-rates/"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-oak-700 underline"
          >
            ALDOR rates
          </a>
        </div>
        {authorities.length === 0 ? (
          <p className="mt-1 text-sm text-stone-500">
            None yet — add the state, then each county/city you sell into.
          </p>
        ) : null}
        <div className="divide-y divide-stone-100">
          {authorities.map((a) => (
            <div key={a.id} id={`auth-${a.id}`} className="scroll-mt-20 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-stone-900">{a.name}</span>
                <span className="text-xs text-stone-500">
                  {TAX_AUTHORITY_LEVEL_LABELS[a.level as TaxAuthorityLevel] ?? a.level} ·{" "}
                  {a.taxType}
                  {a.jurisdictionCode ? ` · code ${a.jurisdictionCode}` : ""}
                </span>
              </div>
              {a.rates.length === 0 ? (
                <p className="mt-1 text-sm text-red-700">No rates yet.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {a.rates.map((r) => {
                    const stale =
                      r.effectiveTo === null &&
                      daysBetween(isoDay(r.confirmedAt), today) > RATE_STALE_DAYS;
                    const ended = r.effectiveTo !== null && isoDay(r.effectiveTo) < today;
                    return (
                      <li
                        key={r.id}
                        className={`rounded-lg px-2.5 py-1.5 text-sm ${ended ? "bg-stone-50 text-stone-400" : "bg-stone-50"}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={ended ? "" : "text-stone-800"}>
                            <span className="font-semibold tabular-nums">
                              {ppmToPercentLabel(r.ratePpm)}
                            </span>{" "}
                            {RATE_CLASS_LABELS[r.rateClass as RateClass] ?? r.rateClass} ·{" "}
                            {r.rateTypeCode}
                          </span>
                          <span className="shrink-0 text-xs">
                            {formatDate(r.effectiveFrom)} –{" "}
                            {r.effectiveTo ? formatDate(r.effectiveTo) : "now"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                          <span className="min-w-0 truncate">
                            {r.source} ·{" "}
                            <span className={stale ? "font-semibold text-red-700" : ""}>
                              checked {formatDate(r.confirmedAt)}
                            </span>
                          </span>
                          <span className="flex shrink-0 gap-3">
                            {r.effectiveTo === null ? (
                              <form action={confirmRate}>
                                <input type="hidden" name="id" value={r.id} />
                                <button type="submit" className="font-medium text-oak-700">
                                  Confirm
                                </button>
                              </form>
                            ) : null}
                            <form action={deleteRate}>
                              <input type="hidden" name="id" value={r.id} />
                              <button
                                type="submit"
                                className="text-red-500"
                                aria-label="Delete rate"
                              >
                                ✕
                              </button>
                            </form>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <details className="mt-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-stone-700">
                  {a.rates.length ? "New rate / rate change" : "Add rate"}
                </summary>
                <form action={addRate} className="mt-3 space-y-3">
                  <input type="hidden" name="authorityId" value={a.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rate %*">
                      <input
                        name="ratePercent"
                        required
                        inputMode="decimal"
                        placeholder={a.level === "STATE" ? "4" : "2.5"}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Class">
                      <select name="rateClass" defaultValue="GENERAL" className={inputCls}>
                        {RATE_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {RATE_CLASS_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Starts *">
                      <input name="effectiveFrom" type="date" required className={inputCls} />
                    </Field>
                    <Field label="Ends">
                      <input name="effectiveTo" type="date" className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Return code">
                    <input
                      name="rateTypeCode"
                      placeholder={
                        a.level === "STATE"
                          ? "Blank = OTHER / FARM-MFG / AUTO…"
                          : "Blank = GENER for general"
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Source *">
                    <input
                      name="source"
                      required
                      placeholder="ALDOR rates file, Sep 2026"
                      className={inputCls}
                    />
                  </Field>
                  <button type="submit" className={`${btnPrimaryCls} w-full`}>
                    Save rate
                  </button>
                  <p className="text-xs text-stone-500">
                    A rate change is a new rate with its start date; the old one ends the day
                    before.
                  </p>
                </form>
              </details>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-stone-500">
                  Edit authority
                </summary>
                <form action={saveAuthority} className="mt-2 space-y-3">
                  <input type="hidden" name="id" value={a.id} />
                  <AuthorityFields defaults={a} />
                  <button type="submit" className={`${btnPrimaryCls} w-full`}>
                    Save
                  </button>
                </form>
                <form action={deleteAuthority} className="mt-2 text-center">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="text-sm font-medium text-red-600">
                    Delete authority
                  </button>
                </form>
              </details>
            </div>
          ))}
        </div>

        {!hasState ? (
          <form action={saveAuthority} className="mt-2">
            <input type="hidden" name="name" value="State of Alabama" />
            <input type="hidden" name="level" value="STATE" />
            <input type="hidden" name="taxType" value="SS" />
            <button type="submit" className={`${btnSecondaryCls} w-full`}>
              + State of Alabama
            </button>
          </form>
        ) : null}
        <details className="mt-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Add authority
          </summary>
          <form action={saveAuthority} className="mt-3 space-y-3">
            <AuthorityFields />
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Add
            </button>
          </form>
        </details>
      </Card>

      {/* ————————— locations ————————— */}
      <Card className="mb-4">
        <div id="locations" className="scroll-mt-20" />
        <h2 className="font-semibold text-stone-900">Where you sell</h2>
        <p className="text-xs text-stone-500">
          Each place a sale is taxed — pickup, delivery towns — and who taxes it.
        </p>
        <div className="divide-y divide-stone-100">
          {locations.map((l) => {
            const ids = splitIds(l.authorityIdsCsv);
            const combined = combinedToday(ids);
            return (
              <div key={l.id} id={`loc-${l.id}`} className="scroll-mt-20 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-stone-900">{l.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-stone-900">
                    {combined === null ? (
                      <span className="text-red-700">rate missing</span>
                    ) : (
                      ppmToPercentLabel(combined)
                    )}
                  </span>
                </div>
                <p className="text-xs text-stone-500">
                  {[
                    l.address,
                    l.city,
                    l.county ? `${l.county} County` : null,
                    l.state,
                    l.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {l.insideCity ? " · inside city limits" : ""}
                  {l.policeJurisdiction ? ` · PJ ${l.policeJurisdiction}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {ids.map((id) => (
                    <Chip key={id} tone={authorityById.has(id) ? "stone" : "red"}>
                      {authorityById.get(id)?.name ?? "deleted authority"}
                    </Chip>
                  ))}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-stone-500">
                    Edit
                  </summary>
                  <form action={saveLocation} className="mt-2 space-y-3">
                    <input type="hidden" name="id" value={l.id} />
                    <LocationFields
                      authorities={authorities}
                      defaults={{ ...l, authorityIds: ids }}
                    />
                    <button type="submit" className={`${btnPrimaryCls} w-full`}>
                      Save
                    </button>
                  </form>
                  <form action={deleteLocation} className="mt-2 text-center">
                    <input type="hidden" name="id" value={l.id} />
                    <button type="submit" className="text-sm font-medium text-red-600">
                      Delete location
                    </button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
        <details
          className="mt-2 rounded-xl border border-stone-200 bg-stone-50 p-3"
          open={locations.length === 0 && authorities.length > 0}
        >
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Add location
          </summary>
          <form action={saveLocation} className="mt-3 space-y-3">
            <LocationFields authorities={authorities} />
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Add
            </button>
          </form>
        </details>
      </Card>

      {/* ————————— product rules ————————— */}
      <Card className="mb-4">
        <div id="rules" className="scroll-mt-20" />
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-stone-900">What&apos;s taxable</h2>
          <a
            href="https://www.revenue.alabama.gov/faqs/what-type-of-sales-are-made-where-no-sales-tax-is-due/"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-oak-700 underline"
          >
            ALDOR no-tax sales
          </a>
        </div>
        <p className="text-xs text-stone-500">
          Your decision per kind of sale. Lines of a kind with no rule stay flagged.
        </p>
        <div className="divide-y divide-stone-100">
          {ruleTypes.map((t) => {
            const rule = ruleByType.get(t);
            const treatment = rule?.treatment as SalesTaxTreatment | undefined;
            return (
              <div key={t} id={`rule-${t}`} className="scroll-mt-20 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-stone-900">{PRODUCT_TYPE_LABELS[t]}</span>
                  {treatment ? (
                    <Chip tone={treatmentTone[treatment]}>
                      {SALES_TAX_TREATMENT_LABELS[treatment]}
                    </Chip>
                  ) : (
                    <Chip tone="red">No rule</Chip>
                  )}
                </div>
                {rule ? (
                  <p className="text-xs text-stone-500">
                    {rule.approvedBy} · {formatDate(rule.approvedAt)}
                    {rule.rateClass !== "GENERAL"
                      ? ` · ${RATE_CLASS_LABELS[rule.rateClass as RateClass] ?? rule.rateClass}`
                      : ""}
                    {rule.exemptionReason ? ` · ${rule.exemptionReason}` : ""}
                    {rule.requiresEvidence ? " · needs a document" : ""}
                  </p>
                ) : RULE_HINTS[t] ? (
                  <p className="text-xs text-stone-500">{RULE_HINTS[t]}</p>
                ) : null}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs font-medium text-oak-700">
                    {rule ? "Change" : "Decide"}
                  </summary>
                  <form action={saveRule} className="mt-2 space-y-3">
                    <input type="hidden" name="productType" value={t} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Treatment *">
                        <select
                          name="treatment"
                          required
                          defaultValue={rule?.treatment ?? ""}
                          className={inputCls}
                        >
                          <option value="" disabled>
                            Choose…
                          </option>
                          {TAX_TREATMENTS_SALES.map((x) => (
                            <option key={x} value={x}>
                              {SALES_TAX_TREATMENT_LABELS[x]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Rate class">
                        <select
                          name="rateClass"
                          defaultValue={rule?.rateClass ?? "GENERAL"}
                          className={inputCls}
                        >
                          {RATE_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              {RATE_CLASS_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Reason (exempt / wholesale)">
                      <input
                        name="exemptionReason"
                        defaultValue={rule?.exemptionReason ?? ""}
                        className={inputCls}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-stone-700">
                      <input
                        type="checkbox"
                        name="requiresEvidence"
                        defaultChecked={rule?.requiresEvidence ?? false}
                        className="accent-oak-700"
                      />
                      Each sale needs a document on file
                    </label>
                    <Field label="Approved by *">
                      <input name="approvedBy" required defaultValue={me} className={inputCls} />
                    </Field>
                    <Field label="Notes">
                      <input name="notes" defaultValue={rule?.notes ?? ""} className={inputCls} />
                    </Field>
                    <button type="submit" className={`${btnPrimaryCls} w-full`}>
                      Save rule
                    </button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AuthorityFields({
  defaults,
}: {
  defaults?: {
    name: string;
    level: string;
    jurisdictionCode: string;
    taxType: string;
    notes: string | null;
  };
}) {
  return (
    <>
      <Field label="Name *">
        <input
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
          placeholder="Houston County"
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Level *">
          <select
            name="level"
            required
            defaultValue={defaults?.level ?? "COUNTY"}
            className={inputCls}
          >
            {TAX_AUTHORITY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {TAX_AUTHORITY_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tax type *">
          <input
            name="taxType"
            required
            defaultValue={defaults?.taxType ?? "ST"}
            placeholder="SS state · ST local"
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="Jurisdiction code">
        <input
          name="jurisdictionCode"
          defaultValue={defaults?.jurisdictionCode ?? ""}
          placeholder="As ALDOR publishes it"
          className={inputCls}
        />
      </Field>
      <Field label="Notes">
        <input name="notes" defaultValue={defaults?.notes ?? ""} className={inputCls} />
      </Field>
    </>
  );
}
