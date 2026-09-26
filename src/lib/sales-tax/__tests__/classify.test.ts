// Guessing older invoice lines' kinds from their wording.
//   pnpm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARRIER_EXEMPT, EXEMPT_SALE_DELIVERY, guessKinds } from "../classify";

const kinds = (division: string, ...lines: [string, number][]) =>
  guessKinds(
    lines.map(([description, totalCents]) => ({ description, totalCents })),
    division,
  ).map((g) => (g ? g.productType + (g.exemptReason ? " (exempt)" : "") : null));

test("tech lines: parts, labor, repair, and service words left for a person", () => {
  assert.deepEqual(
    kinds(
      "TECH",
      ["PETG bracket x4", 4_000],
      ["Assembly labor", 2_500],
      ["Installation", 5_000],
      ["Repair labor — printer", 3_000],
      ["Consulting, 2 hours", 10_000],
      ["Rush fee", 1_500],
      ["Printed parts for resale", 12_000],
    ),
    [
      "PRINTED_PART",
      "FABRICATION_LABOR",
      "REPAIR_LABOR",
      "REPAIR_LABOR",
      null,
      "PRINTED_PART",
      null, // resale needs the buyer's certificate — a person's call
    ],
  );
});

test("design is part of the product when one is sold; alone, it's a service", () => {
  assert.deepEqual(kinds("TECH", ["CAD design", 20_000], ["Printed housing", 8_000]), [
    "DESIGN_WITH_PRODUCT",
    "PRINTED_PART",
  ]);
  assert.deepEqual(kinds("TECH", ["3D modeling", 15_000], ["Shipping", 900]), [
    "DESIGN_STANDALONE",
    "SHIPPING (exempt)",
  ]);
  assert.deepEqual(
    kinds("TECH", ["Design work", 10_000], ["Consultation", 5_000]),
    [null, null],
    "unclear siblings leave the design undecided",
  );
  assert.deepEqual(kinds("TECH", ["Custom designed bracket", 3_000]), ["PRINTED_PART"]);
});

test("shipping: a carrier billed separately is exempt; own delivery and handling are not", () => {
  assert.deepEqual(
    kinds(
      "TECH",
      ["Part", 5_000],
      ["USPS Priority", 1_200],
      ["Shipping & handling", 1_500],
      ["Delivery to Dothan", 2_000],
      ["Set ups", 1_000],
    ),
    ["PRINTED_PART", "SHIPPING (exempt)", "SHIPPING", "SHIPPING", "PRINTED_PART"],
  );
  const [, usps] = guessKinds(
    [
      { description: "Part", totalCents: 5_000 },
      { description: "UPS Ground", totalCents: 1_100 },
    ],
    "TECH",
  );
  assert.equal(usps?.exemptReason, CARRIER_EXEMPT);
});

test("farm: live animals are livestock; meat, wool and the unclear stay for a person", () => {
  assert.deepEqual(
    kinds(
      "FARM",
      ["Ram lamb, registered", 45_000],
      ["Lamb — processed, wrapped", 30_000],
      ["Wool fleece", 4_000],
      ["Hay", 800],
      ["Labor", 2_000],
    ),
    ["LIVE_LIVESTOCK", null, null, null, null],
  );
  const [, delivery] = guessKinds(
    [
      { description: "Ewe", totalCents: 40_000 },
      { description: "Delivery", totalCents: 5_000 },
    ],
    "FARM",
  );
  assert.equal(delivery?.productType, "SHIPPING");
  assert.equal(delivery?.exemptReason, EXEMPT_SALE_DELIVERY, "delivering an exempt sale");
  assert.deepEqual(kinds("TECH", ["Sheep ear tag holder", 1_200]), ["PRINTED_PART"]);
});

test("a kind someone already set is taken as given", () => {
  const [design] = guessKinds(
    [
      { description: "Design", totalCents: 10_000 },
      { description: "Consulting", totalCents: 5_000, productType: "OTHER_GOODS" },
    ],
    "TECH",
  );
  assert.equal(design?.productType, "DESIGN_WITH_PRODUCT");
});

test("negative lines are discounts unless they read like a refund or deposit", () => {
  assert.deepEqual(
    kinds("TECH", ["Part", 5_000], ["10% off", -500], ["Deposit paid", -2_000], ["Refund", -100]),
    ["PRINTED_PART", "DISCOUNT", null, null],
  );
});
