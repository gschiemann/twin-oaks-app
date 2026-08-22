// Every file this account has stored, newest first — "where's that manual I
// scanned?" answered in one place. Filterable by kind; each row links back to
// the record it belongs to.
//
// Owner links are plain URL strings on purpose: those pages live in other
// parts of the app and are never imported from here.

import Link from "next/link";
import { requireAccountId } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { humanSize } from "@/lib/image-shrink";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/domain";
import {
  DOCUMENT_OWNER_LABELS,
  documentGlyph,
  documentOwnerNames,
  isDocumentKind,
  isDocumentOwnerType,
  isImageDocument,
  listAllDocuments,
  ownerHref,
} from "@/lib/documents";
import { fileSrc } from "@/lib/storage";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const accountId = await requireAccountId();
  const { kind: rawKind } = await searchParams;
  const kind = isDocumentKind(rawKind) ? rawKind : null;

  const docs = await listAllDocuments(accountId, kind ?? undefined);
  const ownerNames = await documentOwnerNames(accountId, docs);

  const totalBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);

  return (
    <div>
      <PageHeader
        title="Documents"
        sub="Every photo, manual, warranty and file you've attached to a record."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/documents"
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
            kind === null ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"
          }`}
        >
          All
        </Link>
        {DOCUMENT_KINDS.map((k) => (
          <Link
            key={k}
            href={`/documents?kind=${k}`}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              kind === k ? "bg-oak-700 text-white" : "border border-stone-300 bg-white text-stone-600"
            }`}
          >
            {DOCUMENT_KIND_LABELS[k]}
          </Link>
        ))}
      </div>

      {docs.length === 0 ? (
        <EmptyState
          title={kind ? `No ${DOCUMENT_KIND_LABELS[kind].toLowerCase()} files yet.` : "No documents yet."}
          hint="Open a piece of equipment, a customer, an animal or a print job and use “Photos & documents” to attach the first file."
          actionHref="/assets"
          actionLabel="Go to equipment"
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-stone-500">
            {docs.length} {docs.length === 1 ? "file" : "files"} · {humanSize(totalBytes)} stored
          </p>
          <div className="space-y-2">
            {docs.map((doc) => {
              const ownerLabel = isDocumentOwnerType(doc.ownerType)
                ? DOCUMENT_OWNER_LABELS[doc.ownerType]
                : doc.ownerType;
              const ownerName = ownerNames[`${doc.ownerType}:${doc.ownerId}`];
              return (
                <Card key={doc.id} className="flex items-center gap-3">
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
                      {humanSize(doc.fileSize)} · added {formatDate(doc.createdAt)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip tone={doc.kind === "PHOTO" ? "green" : "stone"}>
                        {DOCUMENT_KIND_LABELS[doc.kind as DocumentKind] ?? doc.kind}
                      </Chip>
                      <Link
                        href={ownerHref(doc.ownerType, doc.ownerId)}
                        className="truncate text-sm font-medium text-oak-700 underline underline-offset-2"
                      >
                        {ownerLabel}
                        {ownerName ? `: ${ownerName}` : ""}
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
