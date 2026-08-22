// The single card every owning page drops in to get file attachments.
//
//   <DocumentsCard ownerType="ASSET" ownerId={asset.id} />
//
// Server component: it reads the documents itself (accountId-scoped) and
// renders the client uploader underneath. Nothing here can throw a page
// render down — a signed-out or failed read simply shows the empty state.
//
// File links go through fileSrc(), which routes every original through
// /api/files: login-gated, and ownership-checked for database-stored files.
// A raw storage URL is never put on the page.

import Link from "next/link";
import { currentAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { humanSize } from "@/lib/image-shrink";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type DocumentOwnerType,
} from "@/lib/domain";
import {
  documentGlyph,
  isDocumentOwnerType,
  isImageDocument,
  listDocuments,
} from "@/lib/documents";
import { fileSrc } from "@/lib/storage";
import { removeDocument } from "@/app/documents/actions";
import DocumentUploader from "./DocumentUploader";
import { Card, Chip } from "./ui";

type Props = {
  /** Which table the record lives in — see DOCUMENT_OWNER_TYPES. */
  ownerType: DocumentOwnerType;
  ownerId: string;
  /** Heading — defaults to "Photos & documents". */
  title?: string;
};

export default async function DocumentsCard({ ownerType, ownerId, title }: Props) {
  // A mis-wired card (unknown owner type, or a record that hasn't been saved
  // yet) renders nothing rather than an uploader that could only ever fail.
  if (!isDocumentOwnerType(ownerType) || !ownerId) return null;

  const accountId = await currentAccountId();
  const docs = accountId ? await listDocuments(accountId, ownerType, ownerId) : [];

  return (
    <Card className="mb-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-stone-900">{title ?? "Photos & documents"}</h2>
        {docs.length > 0 ? (
          <span className="text-sm text-stone-500">
            {docs.length} {docs.length === 1 ? "file" : "files"}
          </span>
        ) : null}
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-stone-500">
          Nothing attached yet — photos, manuals, warranties and paperwork all live here.
        </p>
      ) : (
        <div className="divide-y divide-stone-100">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 py-2.5">
              <a
                href={fileSrc(doc.filePath)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0"
                aria-label={`Open ${doc.title}`}
              >
                {isImageDocument(doc.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileSrc(doc.filePath)}
                    alt={doc.title}
                    className="h-14 w-14 rounded-xl border border-stone-200 object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-2xl">
                    {documentGlyph(doc.mimeType, doc.fileName)}
                  </span>
                )}
              </a>

              <div className="min-w-0 flex-1">
                <a
                  href={fileSrc(doc.filePath)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-semibold text-stone-900 underline-offset-2 hover:underline"
                >
                  {doc.title}
                </a>
                <div className="truncate text-sm text-stone-500">
                  {doc.fileName} · {humanSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                </div>
                <div className="mt-1">
                  <Chip tone={doc.kind === "PHOTO" ? "green" : "stone"}>
                    {DOCUMENT_KIND_LABELS[doc.kind as DocumentKind] ?? doc.kind}
                  </Chip>
                </div>
              </div>

              {/* Two taps to delete, no JavaScript: a scanned manual must not
                  disappear on a stray thumb. */}
              <details className="shrink-0">
                <summary className="cursor-pointer px-1 py-1 text-xs text-stone-400">
                  Remove
                </summary>
                <form action={removeDocument} className="mt-1">
                  <input type="hidden" name="id" value={doc.id} />
                  <input type="hidden" name="ownerType" value={ownerType} />
                  <input type="hidden" name="ownerId" value={ownerId} />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                  >
                    Yes, remove
                  </button>
                </form>
              </details>
            </div>
          ))}
        </div>
      )}

      <DocumentUploader ownerType={ownerType} ownerId={ownerId} />

      {docs.length > 0 ? (
        <p className="mt-3 text-xs text-stone-400">
          Every file is also listed under{" "}
          <Link href="/documents" className="underline">
            all documents
          </Link>
          .
        </p>
      ) : null}
    </Card>
  );
}
