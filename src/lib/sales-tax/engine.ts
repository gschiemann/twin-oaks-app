// Sales tax engine — one month, one reporting basis, in; the accountant's
// workpaper out. PURE: no database, no clock (generatedAt is injected), no
// Date objects in the result. That is what makes every rule below testable
// and every saved return reproducible from its snapshot.
//
// The shape of the problem (Alabama state + local sales tax):
//   1. Build the sales ledger ONCE — one row per actual sale line.
//   2. Allocate each line to the state and EVERY applicable local authority
//      (one tax component per line per authority), at the rate in force on
//      the sale date for that line's rate class.
//   3. Group components into filing rows (authority + rate type).
//   4. Refuse "ready to file" while anything is unknown, unapproved, or
//      doesn't reconcile — and say exactly what, in plain words.
//
// Invariants the tests hold this to:
//   • gross sales are counted once; tax is the only figure summed across
//     authorities (state and county both see the same $750 — never $1,500);
//   • every component belongs to exactly one reported line, every line to
//     exactly one period;
//   • tax collected, as allocated to components, sums back to the invoice;
//   • nothing here changes a record's treatment — it only reads decisions.

import {
  DERIVED_PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  RATE_CLASS_LABELS,
  TAX_TREATMENTS_SALES,
  type ProductType,
  type RateClass,
  type SalesTaxTreatment,
} from "@/lib/domain";
import {
  dayLabel,
  daysBetween,
  isoDay,
  periodDays,
  periodOf,
  ppmToPercentLabel,
  taxOn,
} from "./format";
import type {
  AuthorityIn,
  EngineInput,
  EngineResult,
  Exclusion,
  InvoiceIn,
  InvoiceLineIn,
  Issue,
  IssueFix,
  LocationIn,
  RateIn,
  SalesLine,
  SummaryRow,
  TaxComponent,
} from "./types";

const LEVEL_ORDER: Record<string, number> = {
  STATE: 0,
  COUNTY: 1,
  CITY: 2,
  POLICE_JURISDICTION: 3,
  OTHER: 4,
};

/** An open-ended rate not re-confirmed within this many days blocks filing. */
export const RATE_STALE_DAYS = 365;

/** Income categories that are sales (INCOME_CATEGORIES) — if booked only as income, flagged. */
const SALES_INCOME_CATEGORIES: ReadonlySet<string> = new Set([
  "3D-printed product sales",
  "Design / CAD services",
  "Custom manufacturing",
  "Livestock sales",
]);

const TREATMENTS: ReadonlySet<string> = new Set(TAX_TREATMENTS_SALES);

function usd(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${s}` : s;
}

function typeLabel(productType: string): string {
  return PRODUCT_TYPE_LABELS[productType as ProductType] ?? productType;
}

function classLabel(rateClass: string): string {
  return (RATE_CLASS_LABELS[rateClass as RateClass] ?? rateClass).toLowerCase();
}

// ——————————————————————————— issue collection ———————————————————————————

class Issues {
  private seen = new Set<string>();
  readonly blockers: Issue[] = [];
  readonly warnings: Issue[] = [];

  add(severity: Issue["severity"], code: string, message: string, fix: IssueFix) {
    const key = `${severity}|${code}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    (severity === "BLOCKER" ? this.blockers : this.warnings).push({ code, severity, message, fix });
  }
  block(code: string, message: string, fix: IssueFix) {
    this.add("BLOCKER", code, message, fix);
  }
  warn(code: string, message: string, fix: IssueFix) {
    this.add("WARNING", code, message, fix);
  }
}

// ——————————————————————————— treatment resolution ———————————————————————————

type Resolved = {
  treatment: SalesTaxTreatment;
  source: SalesLine["treatmentSource"];
  reason: string;
  evidence: string;
  rateClass: string;
  approvedBy: string;
  requiresEvidence: boolean;
};

function asTreatment(v: string | null | undefined): SalesTaxTreatment | null {
  return v && TREATMENTS.has(v) ? (v as SalesTaxTreatment) : null;
}

// ——————————————————————————— the engine ———————————————————————————

export function computeSalesTax(input: EngineInput): EngineResult {
  const { period } = input;
  const { last: periodLast } = periodDays(period);
  const issues = new Issues();
  const excluded: Exclusion[] = [];
  const basis = input.basis;

  const authorities = new Map(input.authorities.map((a) => [a.id, a]));
  const locations = new Map(input.locations.map((l) => [l.id, l]));
  const rules = new Map(input.rules.map((r) => [r.productType, r]));
  const lineIndex = new Map<string, { line: InvoiceLineIn; invoice: InvoiceIn }>();
  for (const inv of input.invoices) {
    for (const line of inv.lines) lineIndex.set(line.id, { line, invoice: inv });
  }

  // ————— setup —————
  if (input.authorities.length === 0) {
    issues.block("SETUP_NONE", "Sales tax isn't set up yet.", { kind: "SETUP" });
  }
  if (!basis) {
    issues.block("BASIS_NONE", "Choose your reporting basis (sale date or payment date).", {
      kind: "SETUP",
    });
  }

  // ————— rates —————
  const usedRates = new Map<string, RateIn>();

  function findRate(
    authority: AuthorityIn,
    rateClass: string,
    day: string,
  ): { rate: RateIn | null; overlap: boolean } {
    const matches = input.rates.filter(
      (r) =>
        r.authorityId === authority.id &&
        r.rateClass === rateClass &&
        isoDay(r.effectiveFrom) <= day &&
        (r.effectiveTo === null || day <= isoDay(r.effectiveTo)),
    );
    if (matches.length === 0) return { rate: null, overlap: false };
    // Latest start wins, but two rows claiming the same day is a data error.
    matches.sort((a, b) => (isoDay(b.effectiveFrom) < isoDay(a.effectiveFrom) ? -1 : 1));
    return { rate: matches[0], overlap: matches.length > 1 };
  }

  // ————— location → authorities —————
  function authoritiesFor(
    locationId: string | null,
    label: string,
    fix: IssueFix,
  ): { location: LocationIn | null; list: AuthorityIn[] } {
    if (!locationId) {
      issues.block("NO_LOCATION", `${label} has no “taxed at” location.`, fix);
      return { location: null, list: [] };
    }
    const location = locations.get(locationId) ?? null;
    if (!location) {
      issues.block("LOCATION_GONE", `${label}'s “taxed at” location was deleted.`, fix);
      return { location: null, list: [] };
    }
    const list: AuthorityIn[] = [];
    for (const id of location.authorityIds) {
      const a = authorities.get(id);
      if (a) list.push(a);
      else
        issues.block(
          "AUTHORITY_GONE",
          `“${location.name}” lists a tax authority that was deleted.`,
          {
            kind: "LOCATION",
            id: location.id,
          },
        );
    }
    if (location.authorityIds.length === 0) {
      issues.block("LOCATION_EMPTY", `“${location.name}” has no tax authorities.`, {
        kind: "LOCATION",
        id: location.id,
      });
    }
    list.sort(
      (a, b) =>
        (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || a.name.localeCompare(b.name),
    );
    return { location, list };
  }

  // ————— treatment of one line —————
  function resolveLine(line: InvoiceLineIn, inv: InvoiceIn): Resolved {
    const override = asTreatment(line.taxTreatmentOverride);
    const rule = rules.get(line.productType);
    const rateClass = rule?.rateClass ?? "GENERAL";
    if (override) {
      return {
        treatment: override,
        source: "LINE",
        reason: line.exemptionReason ?? "",
        evidence: line.evidenceDocumentId ?? "",
        rateClass,
        approvedBy: "",
        requiresEvidence: override === "WHOLESALE" || (rule?.requiresEvidence ?? false),
      };
    }
    if (DERIVED_PRODUCT_TYPES.includes(line.productType as ProductType) || !rule) {
      return {
        treatment: "NEEDS_REVIEW",
        source: "NONE",
        reason: "",
        evidence: line.evidenceDocumentId ?? "",
        rateClass,
        approvedBy: "",
        requiresEvidence: false,
      };
    }
    const ruleTreatment = asTreatment(rule.treatment) ?? "NEEDS_REVIEW";
    // A tax-exempt CUSTOMER (resale / exempt-organization certificate) turns
    // an otherwise-taxable sale exempt — and must have the certificate.
    if (ruleTreatment === "TAXABLE" && inv.customerTaxTreatment === "EXEMPT") {
      return {
        treatment: "EXEMPT",
        source: "CUSTOMER",
        reason: inv.customerExemptReason ?? "",
        evidence: line.evidenceDocumentId ?? inv.customerDocumentIds[0] ?? "",
        rateClass,
        approvedBy: rule.approvedBy,
        requiresEvidence: true,
      };
    }
    return {
      treatment: ruleTreatment,
      source: "RULE",
      reason: rule.exemptionReason ?? "",
      evidence: line.evidenceDocumentId ?? "",
      rateClass,
      approvedBy: rule.approvedBy,
      requiresEvidence: ruleTreatment === "WHOLESALE" || rule.requiresEvidence,
    };
  }

  function checkDecision(
    r: Resolved,
    what: string,
    fix: IssueFix,
    customerName: string,
    invoiceId: string,
  ) {
    if (r.treatment === "NEEDS_REVIEW") {
      issues.block("NEEDS_DECISION", `${what} needs a tax decision.`, fix);
      return;
    }
    if (r.treatment === "EXEMPT" || r.treatment === "WHOLESALE") {
      if (!r.reason.trim()) {
        if (r.source === "CUSTOMER") {
          issues.block(
            "CUSTOMER_NO_REASON",
            `${customerName} is marked tax-exempt with no reason.`,
            {
              kind: "INVOICE",
              id: invoiceId,
            },
          );
        } else {
          issues.block(
            "EXEMPT_NO_REASON",
            `${what} is ${r.treatment === "WHOLESALE" ? "wholesale" : "exempt"} but has no reason.`,
            fix,
          );
        }
      }
      if (r.requiresEvidence && !r.evidence) {
        if (r.source === "CUSTOMER") {
          issues.block(
            "CUSTOMER_NO_CERT",
            `${customerName} is marked tax-exempt but has no certificate on file.`,
            {
              kind: "INVOICE",
              id: invoiceId,
            },
          );
        } else {
          issues.block("NEEDS_EVIDENCE", `${what} needs a supporting document on file.`, fix);
        }
      }
    }
  }

  // ————— components for one line —————
  function componentsFor(args: {
    lineId: string;
    transactionId: string;
    invoiceNumber: string;
    status: SalesLine["status"];
    pretaxCents: number;
    r: Resolved;
    rateDay: string;
    authorityList: AuthorityIn[];
  }): TaxComponent[] {
    const { r, status, pretaxCents } = args;
    const out: TaxComponent[] = [];
    for (const a of args.authorityList) {
      let gross: number;
      let deduction: number;
      if (status === "RETURN") {
        // Returns are taken as a deduction, never negative gross: a return
        // of a taxable sale reduces taxable sales; a return of an exempt sale
        // was never in taxable sales, so it changes nothing.
        gross = 0;
        deduction = r.treatment === "EXEMPT" || r.treatment === "WHOLESALE" ? 0 : 0 - pretaxCents;
      } else {
        gross = pretaxCents;
        deduction = r.treatment === "EXEMPT" || r.treatment === "WHOLESALE" ? pretaxCents : 0;
      }
      const taxable = gross - deduction;
      const { rate, overlap } = findRate(a, r.rateClass, args.rateDay);
      if (overlap) {
        issues.block(
          "RATE_OVERLAP",
          `Two ${a.name} ${classLabel(r.rateClass)} rates overlap on ${dayLabel(args.rateDay)}.`,
          {
            kind: "RATE",
            authorityId: a.id,
          },
        );
      }
      if (!rate && taxable !== 0) {
        issues.block(
          "NO_RATE",
          `No ${a.name} ${classLabel(r.rateClass)} rate on ${dayLabel(args.rateDay)}.`,
          {
            kind: "RATE",
            authorityId: a.id,
          },
        );
      }
      if (rate && taxable !== 0) usedRates.set(rate.id, rate);
      const expected = rate ? taxOn(taxable, rate.ratePpm) : 0;
      out.push({
        componentId: `${args.lineId}:${a.id}`,
        lineId: args.lineId,
        transactionId: args.transactionId,
        invoiceNumber: args.invoiceNumber,
        reportPeriod: period,
        authorityId: a.id,
        authority: a.name,
        level: a.level,
        jurisdictionCode: a.jurisdictionCode,
        taxType: a.taxType,
        rateType: rate?.rateTypeCode ?? "",
        rateClass: r.rateClass,
        grossCents: gross,
        deductionCents: deduction,
        taxableCents: taxable,
        ratePpm: rate?.ratePpm ?? null,
        rateEffectiveDate: rate ? isoDay(rate.effectiveFrom) : "",
        rateSource: rate?.source ?? "",
        expectedTaxCents: expected,
        collectedTaxCents: 0, // allocated per invoice below
        differenceCents: 0,
        taxTreatment: r.treatment,
        exemptionReason: r.reason,
        evidenceDocumentId: r.evidence,
        reviewStatus: r.treatment === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "OK",
      });
    }
    return out;
  }

  function locationFields(location: LocationIn | null) {
    return {
      taxLocationId: location?.id ?? "",
      locationName: location?.name ?? "",
      deliveryAddress: location?.address ?? "",
      deliveryCity: location?.city ?? "",
      deliveryCounty: location?.county ?? "",
      deliveryState: location?.state ?? "",
      deliveryPostalCode: location?.postalCode ?? "",
      insideCity: location ? location.insideCity : null,
      policeJurisdiction: location?.policeJurisdiction ?? "",
    };
  }

  const salesLines: SalesLine[] = [];
  const components: TaxComponent[] = [];
  let unallocatedCollectedCents = 0;
  const reportedInvoices: InvoiceIn[] = [];

  // ————— which invoices belong to this period —————
  for (const inv of input.invoices) {
    if (inv.kind !== "INVOICE") continue; // quotes are never sales
    const issueDay = isoDay(inv.issueDate);
    const label = inv.number;
    if (inv.status === "CANCELLED") {
      if (periodOf(inv.issueDate) === period) {
        excluded.push({ transactionId: inv.id, label, reason: "Cancelled" });
      }
      continue;
    }
    if (inv.status !== "SENT") {
      if (periodOf(inv.issueDate) === period) {
        excluded.push({ transactionId: inv.id, label, reason: "Draft — not sent" });
      }
      continue;
    }

    const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const payDays = inv.payments.map((p) => isoDay(p.date)).sort();
    const lastPayDay = payDays.length ? payDays[payDays.length - 1] : "";
    const fullyPaid = inv.totalCents > 0 && paid >= inv.totalCents;
    const isCredit = inv.totalCents <= 0; // a return / credit invoice
    let reportPeriod: string;
    let paymentDate = fullyPaid ? lastPayDay : "";

    if (basis === "PAYMENT_DATE" && !isCredit) {
      if (paid === 0) {
        if (issueDay <= periodLast && periodOf(inv.issueDate) <= period) {
          excluded.push({ transactionId: inv.id, label, reason: "Unpaid — reported when paid" });
        }
        continue;
      }
      const payPeriods = new Set(inv.payments.map((p) => periodOf(p.date)));
      if (!fullyPaid) {
        if (payPeriods.has(period)) {
          issues.block(
            "PARTIAL_PAYMENT",
            `${label} is only partly paid — decide how to report it.`,
            {
              kind: "INVOICE",
              id: inv.id,
            },
          );
          excluded.push({ transactionId: inv.id, label, reason: "Partly paid — needs a decision" });
        }
        continue;
      }
      reportPeriod = periodOf(new Date(`${lastPayDay}T12:00:00`));
      if (reportPeriod === period && payPeriods.size > 1) {
        issues.block(
          "INSTALLMENTS",
          `${label} was paid across months — confirm which month it belongs to.`,
          {
            kind: "INVOICE",
            id: inv.id,
          },
        );
      }
    } else {
      // Sale-date basis (also the preview while no basis is chosen).
      reportPeriod = periodOf(inv.issueDate);
      if (basis === "PAYMENT_DATE" && isCredit && reportPeriod === period) {
        issues.warn("RETURN_BASIS", `${label} is a credit — reported on its own date.`, {
          kind: "INVOICE",
          id: inv.id,
        });
      }
      if (!fullyPaid) paymentDate = "";
    }
    if (reportPeriod !== period) continue;
    reportedInvoices.push(inv);

    if (paid > inv.totalCents && inv.totalCents > 0) {
      issues.warn("OVERPAID", `${label} was overpaid by ${usd(paid - inv.totalCents)}.`, {
        kind: "INVOICE",
        id: inv.id,
      });
    }
    // Issued in one month, paid in another: the basis decides the month, so
    // say so where it matters.
    if (lastPayDay && lastPayDay.slice(0, 7) !== issueDay.slice(0, 7)) {
      issues.warn(
        "CROSS_MONTH",
        `${label} was issued ${dayLabel(issueDay)} and paid ${dayLabel(lastPayDay)} — your basis puts it in this month.`,
        { kind: "INVOICE", id: inv.id },
      );
    }

    // ————— invoice arithmetic must reconcile before anything else —————
    const lineSum = inv.lines.reduce((s, l) => s + l.totalCents, 0);
    if (lineSum !== inv.subtotalCents) {
      issues.block("LINES_SUBTOTAL", `${label}'s lines don't add up to its subtotal.`, {
        kind: "INVOICE",
        id: inv.id,
      });
    }
    if (inv.subtotalCents + inv.salesTaxCents !== inv.totalCents) {
      issues.block("TOTAL_MISMATCH", `${label}'s total isn't subtotal plus tax.`, {
        kind: "INVOICE",
        id: inv.id,
      });
    }
    for (const l of inv.lines) {
      if (Math.round(l.quantity * l.unitPriceCents) !== l.totalCents) {
        issues.block("LINE_MATH", `A line on ${label} doesn't multiply out (qty × price).`, {
          kind: "INVOICE",
          id: inv.id,
        });
      }
    }

    const own = authoritiesFor(inv.taxLocationId, label, { kind: "INVOICE", id: inv.id });
    const saleDay = issueDay;
    const invComponents: TaxComponent[] = [];
    const invLines: SalesLine[] = [];

    // Pass 1: ordinary lines (their treatment is needed to settle discounts).
    const resolved = new Map<string, Resolved>();
    for (const line of inv.lines) {
      if (line.productType === "DISCOUNT" || line.productType === "REFUND") continue;
      resolved.set(line.id, resolveLine(line, inv));
    }

    const sortedLines = [...inv.lines].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const line of sortedLines) {
      const what = `“${line.description}” on ${label}`;
      const fix: IssueFix = { kind: "LINE", id: line.id, invoiceId: inv.id };
      let r: Resolved;
      let status: SalesLine["status"] = "POSTED";
      let rateDay = saleDay;
      let authList = own.list;
      let loc = own.location;

      if (line.productType === "REFUND") {
        status = "RETURN";
        if (line.totalCents > 0) {
          issues.block(
            "REFUND_POSITIVE",
            `The refund on ${label} should be a negative amount.`,
            fix,
          );
        }
        const orig = line.originalLineId ? lineIndex.get(line.originalLineId) : undefined;
        if (!line.originalLineId) {
          issues.block(
            "REFUND_NO_ORIGINAL",
            `The refund on ${label} doesn't say which sale it returns.`,
            fix,
          );
        } else if (!orig) {
          issues.block(
            "REFUND_ORIGINAL_GONE",
            `The refund on ${label} points at a sale that no longer exists.`,
            fix,
          );
        }
        if (orig && orig.line.productType !== "REFUND") {
          const origResolved = resolveLine(orig.line, orig.invoice);
          r = { ...origResolved, source: "ORIGINAL" };
          // Tax is refunded where, and at the rate at which, it was charged.
          rateDay = isoDay(orig.invoice.issueDate);
          const origLoc = authoritiesFor(orig.invoice.taxLocationId, orig.invoice.number, {
            kind: "INVOICE",
            id: orig.invoice.id,
          });
          authList = origLoc.list;
          loc = origLoc.location;
          if (inv.taxLocationId && inv.taxLocationId !== orig.invoice.taxLocationId) {
            issues.warn(
              "REFUND_LOCATION",
              `The refund on ${label} is taxed where the original sale was.`,
              fix,
            );
          }
        } else {
          r = {
            treatment: "NEEDS_REVIEW",
            source: "NONE",
            reason: "",
            evidence: "",
            rateClass: "GENERAL",
            approvedBy: "",
            requiresEvidence: false,
          };
          if (orig) issues.block("NEEDS_DECISION", `${what} needs a tax decision.`, fix);
        }
      } else if (line.productType === "DISCOUNT") {
        status = "DISCOUNT";
        const others = [...resolved.values()];
        const treatments = new Set(others.map((o) => o.treatment));
        const classes = new Set(others.map((o) => o.rateClass));
        if (line.taxTreatmentOverride) {
          r = resolveLine(line, inv);
        } else if (
          others.length > 0 &&
          treatments.size === 1 &&
          classes.size === 1 &&
          !treatments.has("NEEDS_REVIEW")
        ) {
          const base = others[0];
          r = { ...base, source: "INVOICE" };
        } else {
          r = {
            treatment: "NEEDS_REVIEW",
            source: "NONE",
            reason: "",
            evidence: "",
            rateClass: "GENERAL",
            approvedBy: "",
            requiresEvidence: false,
          };
          if (treatments.size > 1 || classes.size > 1) {
            issues.block(
              "DISCOUNT_MIXED",
              `The discount on ${label} covers items taxed differently — split it.`,
              fix,
            );
          }
        }
      } else {
        r = resolved.get(line.id)!;
      }

      checkDecision(r, what, fix, inv.customerName, inv.id);

      const comps = componentsFor({
        lineId: line.id,
        transactionId: inv.id,
        invoiceNumber: label,
        status,
        pretaxCents: line.totalCents,
        r,
        rateDay,
        authorityList: authList,
      });
      invComponents.push(...comps);
      invLines.push({
        reportPeriod: period,
        lineId: line.id,
        transactionId: inv.id,
        invoiceNumber: label,
        saleDate: saleDay,
        paymentDate,
        division: inv.division,
        description: line.description,
        productType: line.productType,
        customerId: inv.customerId,
        customerName: inv.customerName,
        ...locationFields(loc),
        pretaxCents: line.totalCents,
        taxCollectedCents: 0,
        totalCents: 0,
        status,
        originalLineId: line.originalLineId ?? "",
        sourceDocumentId: inv.id,
        treatment: r.treatment,
        treatmentSource: r.source,
        approvedBy: r.approvedBy,
        exemptionReason: r.reason,
        evidenceDocumentId: r.evidence,
        rateClass: r.rateClass,
        reviewStatus: r.treatment === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "OK",
      });
    }

    // ————— allocate the tax actually collected, and reconcile —————
    const expected = invComponents.reduce((s, c) => s + c.expectedTaxCents, 0);
    const collected = inv.salesTaxCents;
    const diff = collected - expected;
    if (invComponents.length === 0) {
      unallocatedCollectedCents += collected;
    } else {
      // Each component collects its expected tax plus a slice of any
      // invoice-level difference (largest remainder, so slices sum exactly).
      const slices = distribute(
        diff,
        invComponents.map((c) => Math.abs(c.expectedTaxCents)),
        invComponents.map((c) => Math.abs(c.grossCents) + Math.abs(c.deductionCents)),
      );
      invComponents.forEach((c, i) => {
        c.collectedTaxCents = c.expectedTaxCents + slices[i];
        c.differenceCents = slices[i];
      });
      const taxableCount = invComponents.filter((c) => c.taxableCents !== 0).length;
      const tolerance = Math.max(1, Math.ceil(taxableCount / 2));
      if (diff !== 0) {
        if (expected === 0) {
          issues.block(
            "TAX_ON_EXEMPT",
            `${label} charged ${usd(collected)} tax on sales that aren't taxable.`,
            {
              kind: "INVOICE",
              id: inv.id,
            },
          );
        } else if (Math.abs(diff) > tolerance) {
          issues.block(
            "TAX_MISMATCH",
            `${label} charged ${usd(collected)} tax; the rates say ${usd(expected)}.`,
            {
              kind: "INVOICE",
              id: inv.id,
            },
          );
        } else {
          issues.warn("TAX_ROUNDING", `${label}: ${Math.abs(diff)}¢ rounding difference.`, {
            kind: "INVOICE",
            id: inv.id,
          });
        }
      }
    }
    for (const sl of invLines) {
      sl.taxCollectedCents = invComponents
        .filter((c) => c.lineId === sl.lineId)
        .reduce((s, c) => s + c.collectedTaxCents, 0);
      sl.totalCents = sl.pretaxCents + sl.taxCollectedCents;
    }
    salesLines.push(...invLines);
    components.push(...invComponents);
  }

  // ————— livestock sales (paid at the sale, so both bases agree) —————
  const reportedLivestock = input.livestockSales.filter((s) => periodOf(s.date) === period);
  const livestockRule = rules.get("LIVE_LIVESTOCK");
  for (const sale of reportedLivestock) {
    const label = `The livestock sale${sale.animalLabel ? ` (${sale.animalLabel})` : ""}`;
    const fix: IssueFix = { kind: "LIVESTOCK", id: sale.id };
    const override = asTreatment(sale.taxTreatmentOverride);
    let r: Resolved;
    if (override) {
      r = {
        treatment: override,
        source: "LINE",
        reason: sale.exemptionReason ?? "",
        evidence: sale.animalDocumentIds[0] ?? "",
        rateClass: livestockRule?.rateClass ?? "GENERAL",
        approvedBy: "",
        requiresEvidence: override === "WHOLESALE",
      };
    } else if (livestockRule) {
      const t = asTreatment(livestockRule.treatment) ?? "NEEDS_REVIEW";
      r = {
        treatment: t,
        source: "RULE",
        reason: livestockRule.exemptionReason ?? "",
        evidence: sale.animalDocumentIds[0] ?? "",
        rateClass: livestockRule.rateClass,
        approvedBy: livestockRule.approvedBy,
        requiresEvidence: t === "WHOLESALE" || livestockRule.requiresEvidence,
      };
    } else {
      r = {
        treatment: "NEEDS_REVIEW",
        source: "NONE",
        reason: "",
        evidence: "",
        rateClass: "GENERAL",
        approvedBy: "",
        requiresEvidence: false,
      };
    }
    checkDecision(r, label, fix, sale.customerName ?? sale.buyerName ?? "", "");
    const own = authoritiesFor(sale.taxLocationId, label, fix);
    const day = isoDay(sale.date);
    const comps = componentsFor({
      lineId: sale.id,
      transactionId: sale.id,
      invoiceNumber: "",
      status: "POSTED",
      pretaxCents: sale.salePriceCents,
      r,
      rateDay: day,
      authorityList: own.list,
    });
    // No tax is recorded on a livestock sale; anything due is uncollected.
    for (const c of comps) {
      c.collectedTaxCents = 0;
      c.differenceCents = c.collectedTaxCents - c.expectedTaxCents;
    }
    const due = comps.reduce((s, c) => s + c.expectedTaxCents, 0);
    if (due !== 0) {
      issues.block("LIVESTOCK_UNCOLLECTED", `${label} is taxable but no tax was collected.`, fix);
    }
    components.push(...comps);
    salesLines.push({
      reportPeriod: period,
      lineId: sale.id,
      transactionId: sale.id,
      invoiceNumber: "",
      saleDate: day,
      paymentDate: day,
      division: "FARM",
      description: sale.animalLabel ? `Livestock sale — ${sale.animalLabel}` : "Livestock sale",
      productType: "LIVE_LIVESTOCK",
      customerId: sale.customerId ?? "",
      customerName: sale.customerName ?? sale.buyerName ?? "",
      ...locationFields(own.location),
      pretaxCents: sale.salePriceCents,
      taxCollectedCents: 0,
      totalCents: sale.salePriceCents,
      status: "POSTED",
      originalLineId: "",
      sourceDocumentId: sale.id,
      treatment: r.treatment,
      treatmentSource: r.source,
      approvedBy: r.approvedBy,
      exemptionReason: r.reason,
      evidenceDocumentId: r.evidence,
      rateClass: r.rateClass,
      reviewStatus: r.treatment === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "OK",
    });
  }

  // ————— the same sale counted twice? —————
  const linkedIncome = new Set<string>();
  for (const inv of input.invoices)
    for (const p of inv.payments) if (p.incomeId) linkedIncome.add(p.incomeId);
  for (const s of input.livestockSales) if (s.incomeId) linkedIncome.add(s.incomeId);

  for (const inc of input.incomes) {
    if (linkedIncome.has(inc.id) || periodOf(inc.date) !== period) continue;
    let twin = false;
    // An amount match only counts when the payer could be that customer —
    // filling in who paid clears a coincidence.
    const payer = (inc.source ?? "").trim().toLowerCase();
    for (const inv of reportedInvoices) {
      const mentions = inc.description.includes(inv.number);
      const sameAmount =
        inc.amountCents === inv.totalCents ||
        inv.payments.some((p) => p.amountCents === inc.amountCents);
      const payerFits = payer === "" || payer === inv.customerName.trim().toLowerCase();
      if (mentions || (sameAmount && inc.amountCents > 0 && payerFits)) {
        issues.block(
          "INCOME_DUPLICATE",
          `An income entry of ${usd(inc.amountCents)} on ${dayLabel(isoDay(inc.date))} looks like ${inv.number} entered twice.`,
          { kind: "INCOME", id: inc.id },
        );
        twin = true;
        break;
      }
    }
    for (const sale of reportedLivestock) {
      if (inc.amountCents === sale.salePriceCents && isoDay(inc.date) === isoDay(sale.date)) {
        issues.block(
          "INCOME_DUPLICATE",
          `An income entry of ${usd(inc.amountCents)} on ${dayLabel(isoDay(inc.date))} looks like a livestock sale entered twice.`,
          { kind: "INCOME", id: inc.id },
        );
        twin = true;
      }
    }
    // A sale booked only as income never reaches the return — say so.
    if (!twin && inc.category && SALES_INCOME_CATEGORIES.has(inc.category) && inc.amountCents > 0) {
      issues.warn(
        "INCOME_NOT_A_SALE",
        `Income of ${usd(inc.amountCents)} on ${dayLabel(isoDay(inc.date))} (${inc.description}) isn't an invoice or livestock sale, so it isn't in these figures.`,
        { kind: "INCOME", id: inc.id },
      );
    }
  }
  for (const sale of reportedLivestock) {
    for (const inv of reportedInvoices) {
      const sameBuyer =
        (sale.customerId && sale.customerId === inv.customerId) ||
        (sale.buyerName &&
          sale.buyerName.trim().toLowerCase() === inv.customerName.trim().toLowerCase());
      if (!sameBuyer) continue;
      const twin = inv.lines.find(
        (l) => l.productType === "LIVE_LIVESTOCK" && l.totalCents === sale.salePriceCents,
      );
      if (twin) {
        issues.block(
          "LIVESTOCK_DUPLICATE",
          `A livestock sale and a line on ${inv.number} look like the same sale.`,
          { kind: "LIVESTOCK", id: sale.id },
        );
      }
    }
  }

  // Tax collected is owed to the state — flag income that booked it as revenue.
  for (const inv of input.invoices) {
    if (inv.kind !== "INVOICE" || inv.salesTaxCents <= 0 || inv.totalCents <= 0) continue;
    const inPeriod = inv.payments.filter((p) => p.incomeId && periodOf(p.date) === period);
    if (inPeriod.length === 0) continue;
    const paidHere = inPeriod.reduce((s, p) => s + p.amountCents, 0);
    const taxShare = Math.round((paidHere * inv.salesTaxCents) / inv.totalCents);
    if (taxShare > 0) {
      issues.warn(
        "INCOME_INCLUDES_TAX",
        `Income for ${inv.number} includes ${usd(taxShare)} sales tax — that part is owed to the state, not income.`,
        { kind: "INVOICE", id: inv.id },
      );
    }
  }

  // ————— rates must be current —————
  for (const rate of usedRates.values()) {
    if (
      rate.effectiveTo === null &&
      daysBetween(isoDay(rate.confirmedAt), periodLast) > RATE_STALE_DAYS
    ) {
      const a = authorities.get(rate.authorityId);
      issues.block(
        "RATE_STALE",
        `Re-confirm the ${a?.name ?? "tax"} ${classLabel(rate.rateClass)} rate (last checked ${dayLabel(isoDay(rate.confirmedAt))}).`,
        { kind: "RATE", authorityId: rate.authorityId },
      );
    }
  }

  // ————— group into filing rows —————
  const groups = new Map<string, SummaryRow>();
  for (const c of components) {
    const key = `${c.authorityId}|${c.rateType}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        authorityId: c.authorityId,
        authority: c.authority,
        level: c.level,
        jurisdictionCode: c.jurisdictionCode,
        taxType: c.taxType,
        rateType: c.rateType,
        grossCents: 0,
        deductionCents: 0,
        taxableCents: 0,
        ratePpms: [],
        expectedTaxCents: 0,
        collectedTaxCents: 0,
        differenceCents: 0,
        componentCount: 0,
      };
      groups.set(key, row);
    }
    row.grossCents += c.grossCents;
    row.deductionCents += c.deductionCents;
    row.taxableCents += c.taxableCents;
    if (c.ratePpm !== null && c.taxableCents !== 0 && !row.ratePpms.includes(c.ratePpm)) {
      row.ratePpms.push(c.ratePpm);
    }
    row.expectedTaxCents += c.expectedTaxCents;
    row.collectedTaxCents += c.collectedTaxCents;
    row.differenceCents += c.differenceCents;
    row.componentCount += 1;
  }
  // Exempt-only rows still show their rate for reference.
  for (const row of groups.values()) {
    if (row.ratePpms.length === 0) {
      const any = components.find(
        (c) =>
          c.authorityId === row.authorityId && c.rateType === row.rateType && c.ratePpm !== null,
      );
      if (any?.ratePpm != null) row.ratePpms.push(any.ratePpm);
    }
    row.ratePpms.sort((a, b) => a - b);
    if (row.ratePpms.length > 1) {
      issues.warn(
        "MIXED_RATES",
        `${row.authority} had more than one rate this month (${row.ratePpms.map(ppmToPercentLabel).join(" and ")}).`,
        { kind: "RATE", authorityId: row.authorityId },
      );
    }
  }

  // A month with no sales still files: every authority the business files
  // for gets a zero row.
  const filedFor = new Set<string>();
  for (const loc of input.locations)
    for (const id of loc.authorityIds) if (authorities.has(id)) filedFor.add(id);
  for (const id of filedFor) {
    if ([...groups.values()].some((g) => g.authorityId === id)) continue;
    const a = authorities.get(id)!;
    const general = findRate(a, "GENERAL", periodLast).rate;
    groups.set(`${id}|zero`, {
      authorityId: id,
      authority: a.name,
      level: a.level,
      jurisdictionCode: a.jurisdictionCode,
      taxType: a.taxType,
      rateType: general?.rateTypeCode ?? "",
      grossCents: 0,
      deductionCents: 0,
      taxableCents: 0,
      ratePpms: general ? [general.ratePpm] : [],
      expectedTaxCents: 0,
      collectedTaxCents: 0,
      differenceCents: 0,
      componentCount: 0,
    });
    if (!general && !input.rates.some((r) => r.authorityId === id)) {
      issues.warn("NO_RATES_AUTHORITY", `No rates entered for ${a.name}.`, {
        kind: "RATE",
        authorityId: id,
      });
    }
  }

  const summary = [...groups.values()].sort(
    (a, b) =>
      (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) ||
      a.authority.localeCompare(b.authority) ||
      a.rateType.localeCompare(b.rateType),
  );

  // ————— stable ordering —————
  salesLines.sort(
    (a, b) =>
      a.saleDate.localeCompare(b.saleDate) ||
      a.invoiceNumber.localeCompare(b.invoiceNumber) ||
      a.transactionId.localeCompare(b.transactionId),
  );
  const lineOrder = new Map(salesLines.map((l, i) => [l.lineId, i]));
  components.sort(
    (a, b) =>
      (lineOrder.get(a.lineId) ?? 0) - (lineOrder.get(b.lineId) ?? 0) ||
      (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) ||
      a.authority.localeCompare(b.authority),
  );

  // ————— totals —————
  const grossSalesCents = salesLines
    .filter((l) => l.status !== "RETURN")
    .reduce((s, l) => s + l.pretaxCents, 0);
  const returnsCents =
    0 - salesLines.filter((l) => l.status === "RETURN").reduce((s, l) => s + l.pretaxCents, 0);
  const expectedTaxCents = components.reduce((s, c) => s + c.expectedTaxCents, 0);
  const collectedTaxCents = components.reduce((s, c) => s + c.collectedTaxCents, 0);
  const transactionCount = new Set(salesLines.map((l) => l.transactionId)).size;

  return {
    engineVersion: 1,
    period,
    basis,
    basisApprovedBy: input.basisApprovedBy ?? "",
    generatedAt: input.generatedAt.toISOString(),
    salesLines,
    components,
    summary,
    totals: {
      grossSalesCents,
      returnsCents,
      stateTaxableCents: components
        .filter((c) => c.level === "STATE")
        .reduce((s, c) => s + c.taxableCents, 0),
      expectedTaxCents,
      collectedTaxCents,
      differenceCents: collectedTaxCents - expectedTaxCents,
      unallocatedCollectedCents,
      customerTotalCents:
        salesLines.reduce((s, l) => s + l.totalCents, 0) + unallocatedCollectedCents,
      lineCount: salesLines.length,
      transactionCount,
    },
    blockers: withNumbers(issues.blockers, input.invoices),
    warnings: withNumbers(issues.warnings, input.invoices),
    excluded,
    readyToFile: issues.blockers.length === 0,
  };
}

/** Name the invoice on every fix, so an issue reads on its own (workbook, lists). */
function withNumbers(list: Issue[], invoices: InvoiceIn[]): Issue[] {
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));
  return list.map((i) => {
    const f = i.fix;
    if (f.kind === "INVOICE" && numberOf.has(f.id))
      return { ...i, fix: { ...f, number: numberOf.get(f.id) } };
    if (f.kind === "LINE" && numberOf.has(f.invoiceId)) {
      return { ...i, fix: { ...f, invoiceNumber: numberOf.get(f.invoiceId) } };
    }
    return i;
  });
}

/**
 * Split `amount` (may be negative) into integer slices in proportion to
 * `weights` (falling back to `fallback`, then to the first slot), using the
 * largest-remainder method so the slices always sum to exactly `amount`.
 */
export function distribute(amount: number, weights: number[], fallback: number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || amount === 0) return out;
  let w = weights;
  let total = w.reduce((s, x) => s + x, 0);
  if (total === 0) {
    w = fallback;
    total = w.reduce((s, x) => s + x, 0);
  }
  if (total === 0) {
    out[0] = amount;
    return out;
  }
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const raw = w.map((x) => (abs * x) / total);
  const floors = raw.map((x) => Math.floor(x));
  let left = abs - floors.reduce((s, x) => s + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((x) => (x === 0 ? 0 : sign * x));
}
