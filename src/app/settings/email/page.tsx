import Link from "next/link";
import { Card, Chip, PageHeader, btnPrimaryCls, btnSecondaryCls } from "@/components/ui";

export const dynamic = "force-dynamic";

// Setup + help page for email receipt forwarding. Reads env at request time —
// the app can't receive mail itself, so an inbound-email provider POSTs to us.
const codeCls =
  "rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700";

export default function EmailReceiptsSettingsPage() {
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  const address = process.env.INBOUND_EMAIL_ADDRESS?.trim();
  const allowedSenders = (process.env.INBOUND_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://twin-oaks.vercel.app")
  ).replace(/\/+$/, "");

  const armed = Boolean(secret);
  const webhookUrl = `${base}/api/inbound/email/${secret ?? "<your-secret>"}`;

  return (
    <div>
      <PageHeader
        title="Email receipts"
        sub="Forward a receipt from your inbox — it lands in your Receipt Inbox."
      />

      {armed ? (
        <Card className="mb-4 border-oak-300 bg-oak-50">
          <h2 className="font-semibold text-oak-900">✅ Email ingest is armed</h2>

          {address ? (
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-oak-800">
                Forward receipts to
              </div>
              <div className="mt-1 rounded-xl border border-oak-200 bg-white px-3 py-2.5">
                <span className="select-all font-mono text-lg break-all text-stone-900">
                  {address}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-oak-800">
                Long-press to copy. Save it as a contact on your phone and forwarding becomes
                two taps.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-oak-900">
              Forward to whatever address your email provider assigned you when you signed up
              (see setup below). Add it as <code className={codeCls}>INBOUND_EMAIL_ADDRESS</code>{" "}
              and it will show up here so you never have to go hunting for it.
            </p>
          )}

          <div className="mt-3 border-t border-oak-200 pt-3">
            {allowedSenders.length > 0 ? (
              <>
                <div className="text-xs font-medium uppercase tracking-wide text-oak-800">
                  Only these senders are accepted
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {allowedSenders.map((sender) => (
                    <Chip key={sender} tone="green">
                      {sender}
                    </Chip>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-oak-800">
                Any sender accepted — set <code className={codeCls}>INBOUND_ALLOWED_SENDERS</code>{" "}
                to restrict this.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-amber-900">Not set up yet</h2>
          <p className="mt-1 text-sm text-amber-950">
            The app can&apos;t receive email on its own — it needs an inbound-email provider to
            catch the message and one environment variable to arm the webhook. The steps below
            take about five minutes.
          </p>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Setting it up</h2>
        <p className="mb-3 text-xs text-stone-500">
          Do this once, on a computer. After that it&apos;s forward-and-forget from your phone.
        </p>

        <ol className="list-decimal space-y-4 pl-5 text-sm marker:font-semibold marker:text-oak-700">
          <li>
            <span className="font-medium text-stone-900">Get an inbound email address.</span>
            <p className="mt-1 text-stone-500">
              Create a free account at CloudMailin. It hands you a working address like{" "}
              <span className="font-mono text-xs">xyz@cloudmailin.net</span> straight away — no
              domain to buy and no DNS to configure.
            </p>
            <p className="mt-1 text-xs text-stone-400">
              Postmark inbound, SendGrid Inbound Parse and Mailgun Routes all work the same way,
              but each one needs a domain you already own.
            </p>
          </li>

          <li>
            <span className="font-medium text-stone-900">Point it at this app.</span>
            <p className="mt-1 text-stone-500">
              In the provider&apos;s settings, set the target (sometimes called the POST or
              webhook) URL to:
            </p>
            <div className="mt-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5">
              <span className="select-all font-mono text-xs break-all text-stone-800">
                {webhookUrl}
              </span>
            </div>
            {armed ? null : (
              <p className="mt-1.5 text-xs text-stone-500">
                Replace <span className="font-mono">&lt;your-secret&gt;</span> with the secret you
                create in step 4 — the URL only works once those two match.
              </p>
            )}
            <p className="mt-1.5 text-xs text-amber-700">
              Treat this URL like a password. Anyone who has it can post receipts into your
              Inbox, so use a long random secret and don&apos;t paste the URL anywhere public.
            </p>
          </li>

          <li>
            <span className="font-medium text-stone-900">Choose the JSON format.</span>
            <p className="mt-1 text-stone-500">
              Set the provider&apos;s message format to <strong>JSON</strong>. If JSON
              isn&apos;t offered, multipart form-data works too.
            </p>
          </li>

          <li>
            <span className="font-medium text-stone-900">Add the environment variables.</span>
            <p className="mt-1 text-stone-500">
              In Vercel, open your project → Settings → Environment Variables and add:
            </p>
            <ul className="mt-2 space-y-2 text-stone-500">
              <li>
                <code className={codeCls}>INBOUND_EMAIL_SECRET</code>{" "}
                <span className="text-stone-400">— required.</span> Any long random string. This
                is the last piece of the webhook URL above.
              </li>
              <li>
                <code className={codeCls}>INBOUND_EMAIL_ADDRESS</code>{" "}
                <span className="text-stone-400">— optional.</span> The address the provider gave
                you, so it shows at the top of this page.
              </li>
              <li>
                <code className={codeCls}>INBOUND_ALLOWED_SENDERS</code>{" "}
                <span className="text-stone-400">— optional.</span> Comma-separated list of
                addresses allowed to send, usually just your own email. Leave it off and any
                sender is accepted.
              </li>
            </ul>
            <p className="mt-2 text-xs text-stone-400">
              Redeploy after saving — environment variables only take effect on a new deploy.
            </p>
          </li>

          <li>
            <span className="font-medium text-stone-900">Forward a receipt and check.</span>
            <p className="mt-1 text-stone-500">
              Forward any receipt email to the address, give it a few seconds, then open the
              Receipt Inbox. If it isn&apos;t there, the provider&apos;s dashboard shows whether
              the message was delivered and what this app answered.
            </p>
            <p className="mt-1 text-xs text-stone-400">
              To test the URL by itself, open it in a browser — a correct secret answers{" "}
              <span className="font-mono">{`{"ok": true}`}</span>. Anything else means the secret
              doesn&apos;t match.
            </p>
          </li>
        </ol>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">What gets pulled in</h2>
        <ul className="mt-2 space-y-2 text-sm text-stone-500">
          <li>
            The original email is stored as the receipt document, so you always keep the source.
          </li>
          <li>
            PDF and image attachments become the receipt image when the email has one.
          </li>
          <li>
            Vendor, total, sales tax, date and receipt number are read automatically when they
            can be found confidently — and left blank when they can&apos;t.
          </li>
          <li>
            Everything arrives in the{" "}
            <strong className="text-stone-700">Inbox — not categorized</strong>, waiting on you.
            Nothing is ever auto-trusted or auto-filed.
          </li>
        </ul>
        <p className="mt-3 text-xs text-stone-400">
          The app never guesses at tax treatment — you categorize in the Inbox.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href="/receipts?tab=inbox" className={btnPrimaryCls}>
          Open Receipt Inbox
        </Link>
        <Link href="/more" className={btnSecondaryCls}>
          Back to More
        </Link>
      </div>
    </div>
  );
}
