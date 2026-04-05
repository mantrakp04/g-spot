import {
  createFileMetadata,
  ensureFileHash,
  getFileById,
} from "@g-spot/db/files";

import { verifyStackToken } from "./lib/verify-token";
import { getObject, objectExists, putObject } from "./lib/storage";

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** POST /api/files/upload — accepts multipart/form-data with a "file" field. */
export async function handleFileUpload(request: Request): Promise<Response> {
  const accessToken = request.headers.get("x-stack-access-token");
  if (!accessToken) return new Response("Unauthorized", { status: 401 });
  const userId = await verifyStackToken(accessToken);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const hash = await sha256(arrayBuffer);
  const mimeType = file.type || "application/octet-stream";

  // Content-addressed dedup: only write to S3 if new hash
  const exists = await objectExists(hash);
  if (!exists) {
    await putObject(hash, buffer, mimeType);
  }

  await ensureFileHash(hash, buffer.length);
  const fileId = await createFileMetadata({
    userId,
    hash,
    filename: file.name,
    mimeType,
    size: buffer.length,
  });

  return new Response(
    JSON.stringify({
      fileId,
      url: `/api/files/${fileId}`,
      filename: file.name,
      mimeType,
      size: buffer.length,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}

/** GET /api/files/:fileId — streams the file back to the client. */
export async function handleFileDownload(fileId: string): Promise<Response> {
  const file = await getFileById(fileId);
  if (!file) return new Response("Not found", { status: 404 });

  const { body } = await getObject(file.s3Key);

  return new Response(body as unknown as ReadableStream, {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
