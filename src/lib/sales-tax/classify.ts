// Reads an invoice line's kind from its wording — only where the words leave
// no real doubt. Anything else stays "Not classified" for a person to decide.
// Pure; used by the owner's one-time classification of older lines.

import type { ProductType } from "@/lib/domain";

/** productType, when a person already set it, is taken as given. */
export type LineToGuess = { description: string; totalCents: number; productType?: string };

export type Guess = {
  productType: ProductType;
  /** Set when this one line is exempt although its kind's rule taxes it. */
  exemptReason?: string;
};

export const CARRIER_EXEMPT =
  "Shipped by carrier and billed separately — not taxable (Ala. Admin. Code r. 810-6-1-.178)";
export const EXEMPT_SALE_DELIVERY = "Delivery of an exempt sale (livestock) — not taxable";

const NOT_A_SALE = /\b(refund|return|deposit|credit|payment|paid)\b/i;
const DESIGN = /\b(design|cad|modell?ing|drawings?|renderings?)\b/i;
const REPAIR = /\binstall(ation|ing)\b|\brepair (labor|labour|service|work)\b/i;
const FABRICATION = /\b(labor|labour|assembly|fabricat\w*|welding|machining)\b/i;
const CARRIER = /\b(shipping|postage|freight|fedex)\b/i;
const CARRIER_NAME = /\b(UPS|USPS|DHL|FedEx)\b/; // capitals only: "set ups" isn't UPS
const HANDLING = /\bhandling\b/i;
const DELIVERY = /\bdeliver(y|ed)\b/i;
const LIVESTOCK =
  /\b(lambs?|sheep|ewes?|rams?|wethers?|livestock|goats?|cattle|calf|calves|steers?|heifers?|hogs?|pigs?)\b/i;
const NOT_LIVE =
  /\b(meat|cuts?|wrapped|processed|processing|share|wool|yarn|fleece|hides?|pelts?|chops?|ground|sausage|roast|leg|shoulder|rack|frozen|lbs?|pounds?)\b/i;
const SERVICE_WORDS =
  /\b(service|consult\w*|training|support|hours?|hourly|subscription|licen[cs]e|rental|rent)\b/i;
const RESALE = /\b(re-?sale|wholesale)\b/i; // needs the buyer's certificate — a person's call

const PRODUCT: ReadonlySet<ProductType> = new Set([
  "PRINTED_PART",
  "OTHER_GOODS",
  "FABRICATION_LABOR",
]);

const LIVE: ReadonlySet<ProductType> = new Set(["LIVE_LIVESTOCK"]);

type Own = Guess | "DESIGN" | null;

function guessOne(line: LineToGuess, division: string): Own {
  if (line.productType && line.productType !== "UNCLASSIFIED")
    return { productType: line.productType as ProductType };
  const d = line.description;
  if (RESALE.test(d)) return null;
  if (line.totalCents < 0) return NOT_A_SALE.test(d) ? null : { productType: "DISCOUNT" };
  if (DESIGN.test(d)) return "DESIGN";
  if (REPAIR.test(d)) return { productType: "REPAIR_LABOR" };
  if (division === "TECH" && FABRICATION.test(d)) return { productType: "FABRICATION_LABOR" };
  const carrier = CARRIER.test(d) || CARRIER_NAME.test(d);
  // Handling, and delivery in our own vehicle, are part of the sale.
  if (carrier && !HANDLING.test(d) && !DELIVERY.test(d))
    return { productType: "SHIPPING", exemptReason: CARRIER_EXEMPT };
  if (carrier || DELIVERY.test(d)) return { productType: "SHIPPING" };
  if (division !== "TECH" && LIVESTOCK.test(d) && !NOT_LIVE.test(d))
    return { productType: "LIVE_LIVESTOCK" };
  if (division === "TECH" && !SERVICE_WORDS.test(d) && !NOT_A_SALE.test(d))
    return { productType: "PRINTED_PART" };
  return null;
}

/**
 * One guess per line of an invoice (null = leave it for a person). Design
 * work is part of the product when the invoice also sells one; on its own it
 * is a service — and when the other lines are unclear, so is the design.
 * Delivering an exempt sale is exempt too.
 */
export function guessKinds(lines: LineToGuess[], division: string): (Guess | null)[] {
  const own = lines.map((l) => guessOne(l, division));
  return own.map((g, i) => {
    const others = own.filter((_, j) => j !== i && lines[j].totalCents > 0);
    const is = (o: Own, types: ReadonlySet<ProductType>) =>
      o !== null && o !== "DESIGN" && types.has(o.productType);
    if (g === "DESIGN") {
      if (others.some((o) => is(o, PRODUCT))) return { productType: "DESIGN_WITH_PRODUCT" };
      if (others.some((o) => o === null)) return null;
      return { productType: "DESIGN_STANDALONE" };
    }
    if (
      g?.productType === "SHIPPING" &&
      !g.exemptReason &&
      others.length > 0 &&
      others.every((o) => is(o, LIVE))
    )
      return { productType: "SHIPPING", exemptReason: EXEMPT_SALE_DELIVERY };
    return g;
  });
}
