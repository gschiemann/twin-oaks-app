// Small shared pieces for the livestock pages — the plain-English refusal
// messages (THE SAVE RULE: a rejected save always says why) and the profile
// row used on the animal and sale pages.

import type { ReactNode } from "react";

export function animalErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "tag") {
    return "Every animal needs a tag number — that's how you'll find it. Type the number on its ear tag, then tap Save again.";
  }
  if (error === "sex") {
    return "Pick whether this one is a ewe, a ram, or a wether, then tap Save again.";
  }
  if (error === "duplicate") {
    return "Another animal in your flock already has that tag number. Two animals can't share a tag — check the number and try again.";
  }
  return "Something on the form wasn't filled in right. Check the tag number and try again.";
}

export function saleErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "price") {
    return "Type what the animal sold for — the sale price can't be blank or zero.";
  }
  if (error === "buyer") {
    return "Say who bought it: pick one of your customers, or just type the buyer's name.";
  }
  if (error === "animal") {
    return "That animal isn't in your flock any more. Pick one from the list, or leave it on “No particular animal.”";
  }
  return "Something on the form wasn't filled in right. Check the price and the buyer, then try again.";
}

export function eventErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "kind") return "Pick what happened (weighed, treated, lambed…) before adding it.";
  return "That didn't get added. Check the date and what happened, then try again.";
}

export function animalStatusTone(status: string): string {
  if (status === "ACTIVE") return "green";
  if (status === "SOLD") return "blue";
  if (status === "DECEASED") return "red";
  return "stone";
}

/** One label/value line in a profile card. Blank values hide themselves. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 last:border-b-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}
