import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, btnSecondaryCls } from "@/components/ui";
import PasskeyEnroll from "@/components/PasskeyEnroll";
import { deletePasskey } from "./actions";

export const dynamic = "force-dynamic";

export default async function PasskeysPage() {
  const passkeys = await prisma.passkey.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div>
      <PageHeader
        title="Face ID sign-in"
        sub="Skip the password on devices you trust."
      />

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">Add this device</h2>
        <p className="mb-3 text-sm text-stone-500">
          Set this up once per device. Your phone stores the key in its secure
          hardware — Twin Oaks only ever sees the public half.
        </p>
        <PasskeyEnroll />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-semibold text-stone-900">
          Registered devices {passkeys.length > 0 ? `(${passkeys.length})` : ""}
        </h2>
        {passkeys.length === 0 ? (
          <p className="text-sm text-stone-500">
            None yet — add one above and Face ID appears on the sign-in screen.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {passkeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium text-stone-900">{k.label}</div>
                  <div className="text-sm text-stone-500">
                    Added {formatDate(k.createdAt)}
                    {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : " · never used"}
                  </div>
                </div>
                <form action={deletePasskey} className="shrink-0">
                  <input type="hidden" name="id" value={k.id} />
                  <button type="submit" className="text-sm font-medium text-red-600">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4 border-stone-200 bg-stone-50">
        <h2 className="mb-1 font-semibold text-stone-900">Good to know</h2>
        <ul className="space-y-1 text-sm text-stone-600">
          <li>• Your password never stops working — Face ID is an extra door, not a replacement.</li>
          <li>• Losing a device costs you nothing: remove it here and sign in with your password.</li>
          <li>• Each device needs its own setup (iPhone, iPad, laptop).</li>
          <li>• Requires the site to be opened over https — it is, on Vercel.</li>
        </ul>
      </Card>

      <Link href="/more" className={btnSecondaryCls}>
        Back to More
      </Link>
    </div>
  );
}
