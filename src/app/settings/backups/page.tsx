import Link from "next/link";
import { BACKUP_KEEP, BACKUP_PREFIX } from "@/lib/backup";
import { fileSrc } from "@/lib/storage";
import { Card, PageHeader, btnPrimaryCls, btnSecondaryCls } from "@/components/ui";
import { backupNow } from "./actions";

export const dynamic = "force-dynamic";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function BackupsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { done, error } = await searchParams;

  const configured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  let backups: { url: string; pathname: string; size: number; uploadedAt: Date }[] = [];
  let listError: string | null = null;

  if (configured) {
    try {
      const { list } = await import("@vercel/blob");
      const res = await list({ prefix: BACKUP_PREFIX });
      backups = res.blobs
        .map((b) => ({ url: b.url, pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }))
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    } catch (e) {
      listError = e instanceof Error ? e.message : "Could not list backups.";
    }
  }

  return (
    <div>
      <PageHeader
        title="Backups"
        sub="Your records, copied somewhere safe — automatically, every day."
      />

      {done ? (
        <Card className="mb-4 border-oak-200 bg-oak-50 text-sm text-oak-900">
          ✅ Backup saved.
        </Card>
      ) : null}
      {error === "blob" ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          Blob storage isn&apos;t connected to this deployment, so there&apos;s nowhere to put a
          backup yet.
        </Card>
      ) : null}
      {error === "failed" ? (
        <Card className="mb-4 border-red-300 bg-red-50 text-sm text-red-900">
          That backup didn&apos;t finish. Try again — nothing was lost.
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-1 font-semibold text-stone-900">How this works</h2>
        <ul className="space-y-1 text-sm text-stone-600">
          <li>• A complete copy of every record is saved automatically each morning.</li>
          <li>• The newest {BACKUP_KEEP} are kept; older ones are cleaned up.</li>
          <li>• Backups hold your data (receipt details, expenses, invoices…). The receipt
            images themselves stay in storage and are referenced by each record.</li>
          <li>• Download one any time — it&apos;s plain JSON, readable forever.</li>
        </ul>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <form action={backupNow}>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Back up now
          </button>
        </form>
        <a href="/api/export" className={btnSecondaryCls}>
          Download current
        </a>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold text-stone-900">
          Saved backups {backups.length > 0 ? `(${backups.length})` : ""}
        </h2>

        {!configured ? (
          <p className="text-sm text-stone-500">
            Automatic backups start once a Blob store is connected to this project in Vercel.
            Until then use “Download current” and keep the file somewhere safe.
          </p>
        ) : listError ? (
          <p className="text-sm text-red-600">{listError}</p>
        ) : backups.length === 0 ? (
          <p className="text-sm text-stone-500">
            None yet — the first automatic backup runs tomorrow morning, or tap “Back up now”.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {backups.map((b) => (
              <a
                key={b.url}
                href={fileSrc(b.url)}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-900">
                    {b.pathname.replace(BACKUP_PREFIX, "")}
                  </span>
                  <span className="text-sm text-stone-500">
                    {new Date(b.uploadedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-oak-700">
                  {formatBytes(b.size)} ⬇
                </span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Link href="/more" className={`${btnSecondaryCls} mt-4`}>
        Back to More
      </Link>
    </div>
  );
}
