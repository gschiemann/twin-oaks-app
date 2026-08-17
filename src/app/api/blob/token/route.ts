// Hands the browser a short-lived token so it can upload a receipt STRAIGHT
// to blob storage.
//
// Why this exists: Vercel caps a serverless request body at ~4.5 MB, which a
// single iPhone photo can exceed. Posting the file through our own function
// therefore fails on exactly the files the operator cares about. Client
// uploads skip the function entirely, so size stops being our problem.
//
// This route sits behind the login gate (middleware), so only a signed-in
// owner can ever mint an upload token.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: "Blob storage is not configured on this deployment." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "image/heif",
          "image/gif",
          "application/pdf",
        ],
        addRandomSuffix: true,
        maximumSizeInBytes: 25 * 1024 * 1024,
      }),
      // Nothing to do here: the receipt row is created by the client's
      // follow-up call, which carries the categorization fields too.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (e) {
    console.error("[blob-token]", e);
    return Response.json({ error: "Could not start the upload." }, { status: 400 });
  }
}
