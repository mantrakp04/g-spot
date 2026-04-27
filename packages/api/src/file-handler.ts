import {
  createFileMetadata,
  ensureFileHash,
  getFileById,
  getFileByFilename,
} from "@g-spot/db/files";

import { detectDocumentKind, extractDocumentText } from "./lib/extract-document";
import { getOrCreateFileExtraction } from "./lib/file-extraction-cache";
import {
  getLocalObjectPath,
  getObject,
  getObjectSize,
  objectExists,
  putObject,
} from "./lib/storage";

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type DownloadBody =
  | ReadableStream
  | {
      transformToByteArray?: () => Promise<Uint8Array>;
      transformToWebStream?: () => ReadableStream;
    };

async function toDownloadStream(body: DownloadBody): Promise<ReadableStream> {
  if (body instanceof ReadableStream) {
    return body;
  }

  if (typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  throw new Error("Unsupported object body");
}

/** POST /api/files/upload — accepts multipart/form-data with a "file" field. */
export async function handleFileUpload(request: Request): Promise<Response> {
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
  const storedSize = exists ? await getObjectSize(hash) : null;
  if (!exists || storedSize !== buffer.length) {
    await putObject(hash, buffer, mimeType);
  }

  await ensureFileHash(hash, buffer.length);
  const fileId = await createFileMetadata({
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
  const stream = await toDownloadStream(body as DownloadBody);

  return new Response(stream, {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

/**
 * GET /api/notes/attachments/:filename — resolves vault-style `![[file]]`
 * embeds. Looks up the most recent upload with this filename and streams it.
 * 404 if no upload matches.
 */
export async function handleAttachmentByName(filename: string): Promise<Response> {
  const file = await getFileByFilename(decodeURIComponent(filename));
  if (!file) return new Response("Not found", { status: 404 });
  return handleFileDownload(file.id);
}

/** GET /api/files/:fileId/extracted-text — extracts preview text on demand. */
export async function handleFileExtractedText(fileId: string): Promise<Response> {
  const file = await getFileById(fileId);
  if (!file) return new Response("Not found", { status: 404 });

  const kind = detectDocumentKind(file.mimeType, file.filename);
  if (!kind) {
    return new Response(
      JSON.stringify({ error: "No text extractor for this file type" }),
      { status: 415, headers: { "content-type": "application/json" } },
    );
  }

  const { body } = await getObject(file.s3Key);
  const stream = await toDownloadStream(body as DownloadBody);
  const extraction = await getOrCreateFileExtraction(file, async () => {
    const buffer = await new Response(stream).arrayBuffer();
    return extractDocumentText(buffer, kind, file.filename);
  });

  return new Response(
    JSON.stringify({
      fileId,
      filename: file.filename,
      mediaType: file.mimeType,
      localPath: getLocalObjectPath(file.s3Key),
      extractedTextPath: extraction.localPath,
      text: extraction.text,
    }),
    { headers: { "content-type": "application/json" } },
  );
}
