// Settings → Try it with sample data.
//
// Practice records for every part of the app, and one honest way to take them
// out again. The whole job of this screen is that the operator can always see
// which records are his and which the app made up, and is never in any doubt
// about which of the two a button is about to touch.
//
// All of the real work lives in src/lib/sample-data.ts. This page counts,
// explains, asks once, and reports back the numbers that library returns.

import Link from "next/link";
import { requireAccountId } from "@/lib/auth";
import { dataOverview } from "@/lib/sample-data";
import {
  Card,
  Chip,
  EmptyState,
  FormError,
  PageHeader,
  SavedBanner,
  StatCard,
  btnPrimaryCls,
  btnSecondaryCls,
} from "@/components/ui";
import { addSampleData, removeAllSampleData } from "./actions";
import { decodeKept, keptTotal } from "./kept-report";

export const dynamic = "force-dynamic";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A count that arrived in the URL. Anything that is not a plain whole number
 *  is treated as absent rather than shown. */
function count(v: string | undefined): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 1e9 ? n : null;
}

export default async function SampleDataPage({
  searchParams,
}: {
  searchParams: Promise<{
    added?: string;
    removed?: string;
    real?: string;
    kept?: string;
    confirm?: string;
    error?: string;
  }>;
}) {
  const accountId = await requireAccountId();
  const { added, removed, real, kept, confirm, error } = await searchParams;

  // The live truth. Every number on this page except the two in the "removed"
  // banner is counted fresh, right now, for this account.
  const overview = await dataOverview(accountId);
  const hasSample = overview.sampleTotal > 0;
  const hasReal = overview.realTotal > 0;
  const rows = overview.rows.filter((r) => r.sample > 0 || r.real > 0);

  const addedCount = count(added);
  const removedCount = count(removed);
  const realAfter = count(real);
  const keptLines = decodeKept(kept);
  const keptCount = keptTotal(keptLines);
  const asking = confirm === "1" && hasSample;

  // Said in three places, and it has to read like a sentence in each — so it
  // is written out once, in words, rather than glued together from fragments.
  const yoursAreSafe =
    overview.realTotal === 0
      ? "The app can only take back records it made up itself."
      : overview.realTotal === 1
        ? "Your one real record stays exactly as it is — the app can only take back records it made up itself."
        : `Your ${overview.realTotal} real records stay exactly as they are — the app can only take back records it made up itself.`;

  const yoursNotPartOfThis =
    overview.realTotal === 0
      ? "You have no records of your own, so there is nothing else here to lose."
      : overview.realTotal === 1
        ? "Your own record is not part of this. It stays exactly where it is."
        : `Your own records are not part of this. All ${overview.realTotal} of them stay exactly where they are.`;

  return (
    <div>
      <PageHeader
        title="Try it with sample data"
        sub="Practice on made-up records. Your own records are never touched."
      />

      {addedCount !== null ? (
        <SavedBanner
          title={`Added ${plural(addedCount, "practice record", "practice records")}.`}
          hint="They are labeled (sample) everywhere they appear, and the list below shows exactly where they went. Nothing you entered yourself was changed."
          actionHref="/"
          actionLabel="Take a look around"
        />
      ) : null}

      {removedCount !== null && removedCount > 0 ? (
        <SavedBanner
          title={`Removed ${plural(removedCount, "practice record", "practice records")}.`}
          hint={
            realAfter === null
              ? "Your own records were not touched."
              : realAfter === 0
                ? "You have no records of your own yet — nothing else was touched."
                : `Your ${realAfter} real record${realAfter === 1 ? " was" : "s were"} not touched.`
          }
        />
      ) : null}

      {removedCount === 0 && keptCount === 0 ? (
        <FormError>
          There was nothing left to remove — the practice records had already gone.
        </FormError>
      ) : null}

      {error ? (
        <FormError>
          {error === "exists"
            ? `There ${overview.sampleTotal === 1 ? "is" : "are"} already ${plural(overview.sampleTotal, "practice record", "practice records")} here. Remove those first, then add a fresh set.`
            : error === "none"
              ? "There was no practice data left to remove — it has already gone."
              : "Something went wrong at our end, so nothing was changed. Please try again in a moment."}
        </FormError>
      ) : null}

      {/* Whatever the removal deliberately left alone, said out loud. */}
      {keptCount > 0 ? (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <p className="text-base font-semibold text-amber-900">
            {plural(keptCount, "practice record was kept", "practice records were kept")}.
          </p>
          {removedCount === 0 ? (
            <p className="mt-1 text-sm font-medium text-amber-900">
              Nothing else was removed this time.
            </p>
          ) : null}
          <p className="mt-1 text-sm text-amber-900">
            Each of these has a record of your own attached to it. Removing it would have taken
            your record with it, or left your record pointing at something that is no longer there —
            so it was left exactly where it is.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {keptLines.map((line) => (
              <li key={line.label}>
                <span className="font-semibold text-amber-900">
                  {line.label} — {line.count} kept
                </span>
                <ul className="mt-0.5 space-y-0.5 text-amber-800">
                  {(line.reasons.length > 0
                    ? line.reasons
                    : ["one of your own records is attached to it"]
                  ).map((reason) => (
                    <li key={reason}>• Because {reason}.</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-amber-900">
            Nothing is wrong. To get rid of one of these as well, open it on its own screen, move or
            delete your own record first, then come back and press Remove again. While any practice
            records are still here, a fresh set cannot be added.
          </p>
        </Card>
      ) : null}

      {/* Step two of the removal: the two numbers, then the button. */}
      {asking ? (
        <Card className="mb-4 border-2 border-amber-400 bg-amber-50">
          <p className="text-base font-semibold text-amber-900">
            Remove {plural(overview.sampleTotal, "practice record", "practice records")}?
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {yoursNotPartOfThis} Anything you typed into a practice record while you were practicing
            goes with it.
          </p>
          <form action={removeAllSampleData} className="mt-3">
            <input type="hidden" name="confirm" value="yes" />
            <button type="submit" className={`${btnPrimaryCls} w-full`}>
              Yes, remove {plural(overview.sampleTotal, "practice record", "practice records")}
            </button>
          </form>
          <Link href="/settings/testing" className={`${btnSecondaryCls} mt-2 w-full`}>
            No, keep {overview.sampleTotal === 1 ? "it" : "them"}
          </Link>
        </Card>
      ) : null}

      {/* A brand-new set of books must never be mistaken for a full one. */}
      {!hasReal ? (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <p className="text-base font-semibold text-amber-900">Nothing here is yours yet.</p>
          <p className="mt-1 text-sm text-amber-900">
            {hasSample
              ? "You have not entered a single record of your own. Everything in the app right now is practice data marked (sample) — none of it is real, and none of it belongs in your books. Remove it before you start entering real work."
              : "You have not entered any records of your own yet. If you add sample data, everything you then see in the app is made up and marked (sample) — it is not your books. Remove it again before you start entering real work."}
          </p>
        </Card>
      ) : null}

      <div className="mb-2 grid grid-cols-2 gap-2">
        <StatCard
          label="Your records"
          value={String(overview.realTotal)}
          sub="Entered by you"
          tone={hasReal ? "green" : undefined}
        />
        <StatCard
          label="Practice records"
          value={String(overview.sampleTotal)}
          sub={hasSample ? "Made up by the app" : "None right now"}
        />
      </div>

      {rows.length === 0 ? (
        <div className="mb-4">
          <EmptyState
            title="Nothing in the app yet."
            hint="This is where your records and any practice records get counted, side by side. Add sample data below if you would like a look around first."
          />
        </div>
      ) : (
        <Card className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-stone-900">Where they are</h2>
            <span className="flex shrink-0 gap-1">
              <Chip tone="green">Yours</Chip>
              <Chip tone="amber">Practice</Chip>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 pb-1 text-xs font-medium uppercase tracking-wide text-stone-500">
            <span>Record type</span>
            <span className="flex shrink-0 gap-2">
              <span className="w-16 text-right">Yours</span>
              <span className="w-16 text-right">Practice</span>
            </span>
          </div>
          <div className="divide-y divide-stone-100">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-stone-800">{r.label}</span>
                <span className="flex shrink-0 gap-2 text-sm tabular-nums">
                  <span
                    className={`w-16 text-right ${r.real > 0 ? "font-semibold text-oak-800" : "text-stone-400"}`}
                  >
                    {r.real > 0 ? r.real : "—"}
                  </span>
                  <span
                    className={`w-16 text-right ${r.sample > 0 ? "font-semibold text-amber-700" : "text-stone-400"}`}
                  >
                    {r.sample > 0 ? r.sample : "—"}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-stone-200 pt-2 text-sm font-semibold text-stone-900">
            <span>Everything</span>
            <span className="flex shrink-0 gap-2 tabular-nums">
              <span className="w-16 text-right text-oak-800">{overview.realTotal}</span>
              <span className="w-16 text-right text-amber-700">{overview.sampleTotal}</span>
            </span>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">What sample data is</h2>
        <ul className="space-y-1 text-sm text-stone-600">
          <li>
            • A set of made-up records — a few receipts, an invoice, some sheep, a print job, a
            couple of bills — put into the app so you can practice on them.
          </li>
          <li>
            • Every one of them is labeled <span className="font-medium">(sample)</span> wherever
            it appears, so you can always tell them apart from your own work.
          </li>
          <li>
            • They are counted separately here: your records on one side, the practice ones on the
            other.
          </li>
          <li>
            • Removing them cannot touch anything you entered yourself. The app only takes back the
            records it made up, and it knows exactly which ones those are.
          </li>
          <li>
            • While they are here they behave like ordinary records, so they count in your lists and
            your totals. That is the reason to take them out before you start keeping your real
            books.
          </li>
        </ul>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Add sample data</h2>
        {hasSample ? (
          <p className="text-sm text-stone-600">
            Already added —{" "}
            {plural(overview.sampleTotal, "practice record is", "practice records are")} here now.
            The app will not put a second set on top of them, so you cannot end up with two of
            everything. To start again with a fresh set, remove these first and then add again.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-stone-600">
              One tap fills every part of the app with a small, sensible set of made-up records:
              receipts waiting in the Inbox, an invoice half paid, a few sheep, a print job, some
              regular bills. Practice on them as much as you like.
            </p>
            <form action={addSampleData}>
              <button type="submit" className={`${btnPrimaryCls} w-full`}>
                Add sample data
              </button>
            </form>
            <p className="mt-2 text-xs text-stone-500">
              Takes a few seconds. Nothing you have entered yourself is changed.
            </p>
          </>
        )}
      </Card>

      {hasSample && !asking ? (
        <Card className="mb-4">
          <h2 className="mb-1 font-semibold text-stone-900">Remove all sample data</h2>
          <p className="mb-3 text-sm text-stone-600">
            This takes out the{" "}
            {plural(overview.sampleTotal, "practice record", "practice records")} and nothing else.{" "}
            {yoursAreSafe} If one practice record has something of yours attached to it, that one is
            left alone and this screen will tell you which and why. You will be asked once more
            before anything goes.
          </p>
          <form action={removeAllSampleData}>
            <button type="submit" className={`${btnSecondaryCls} w-full`}>
              Remove all sample data
            </button>
          </form>
        </Card>
      ) : null}

      <Link href="/more" className={`${btnSecondaryCls} mt-4`}>
        Back to More
      </Link>
    </div>
  );
}
