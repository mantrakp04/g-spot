import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { fileExtractions, fileHashes, fileMetadata } from "./schema";

/** Ensure a hash row exists; if it already exists, bump refCount. Returns the s3Key. */
export async function ensureFileHash(
  hash: string,
  size: number,
): Promise<string> {
  const s3Key = hash;
  await db
    .insert(fileHashes)
    .values({ hash, s3Key, size, refCount: 1 })
    .onConflictDoUpdate({
      target: fileHashes.hash,
      set: { refCount: sql`${fileHashes.refCount} + 1` },
    });
  return s3Key;
}

/** Create a metadata record pointing to an existing hash. Returns the file ID. */
export async function createFileMetadata(input: {
  hash: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<string> {
  const id = nanoid();
  await db.insert(fileMetadata).values({
    id,
    hash: input.hash,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
  });
  return id;
}

/**
 * Look up the most recently uploaded file by filename. Used for vault-style
 * `![[name.ext]]` embeds where the markdown only knows the bare filename.
 * Most-recent-wins is a deliberate trade-off — if two uploads share a name,
 * the latest replaces the older in the rendered output.
 */
export async function getFileByFilename(filename: string) {
  const [row] = await db
    .select({
      id: fileMetadata.id,
      filename: fileMetadata.filename,
      mimeType: fileMetadata.mimeType,
      size: fileMetadata.size,
      hash: fileMetadata.hash,
      s3Key: fileHashes.s3Key,
    })
    .from(fileMetadata)
    .innerJoin(fileHashes, eq(fileMetadata.hash, fileHashes.hash))
    .where(eq(fileMetadata.filename, filename))
    .orderBy(sql`${fileMetadata.createdAt} desc`)
    .limit(1);
  return row ?? null;
}

/** Look up a file by its metadata ID. Returns metadata + s3Key, or null. */
export async function getFileById(fileId: string) {
  const [row] = await db
    .select({
      id: fileMetadata.id,
      filename: fileMetadata.filename,
      mimeType: fileMetadata.mimeType,
      size: fileMetadata.size,
      hash: fileMetadata.hash,
      s3Key: fileHashes.s3Key,
    })
    .from(fileMetadata)
    .innerJoin(fileHashes, eq(fileMetadata.hash, fileHashes.hash))
    .where(eq(fileMetadata.id, fileId));
  return row ?? null;
}

export async function getFileExtractionByHash(hash: string) {
  const [row] = await db
    .select({
      hash: fileExtractions.hash,
      extractorVersion: fileExtractions.extractorVersion,
      filename: fileExtractions.filename,
      mimeType: fileExtractions.mimeType,
      textS3Key: fileExtractions.textS3Key,
      charCount: fileExtractions.charCount,
    })
    .from(fileExtractions)
    .where(eq(fileExtractions.hash, hash));
  return row ?? null;
}

export async function createFileExtraction(input: {
  hash: string;
  extractorVersion: number;
  filename: string;
  mimeType: string;
  textS3Key: string;
  charCount: number;
}) {
  await db
    .insert(fileExtractions)
    .values(input)
    .onConflictDoNothing({ target: fileExtractions.hash });
}

/** Delete a file metadata record and handle hash ref counting.
 *  Returns the s3Key if the S3 object should be deleted, or null. */
export async function deleteFile(fileId: string): Promise<string | null> {
  const file = await getFileById(fileId);
  if (!file) return null;

  await db.delete(fileMetadata).where(eq(fileMetadata.id, fileId));

  // Decrement refCount; delete hash row + S3 object if it reaches 0
  await db
    .update(fileHashes)
    .set({ refCount: sql`${fileHashes.refCount} - 1` })
    .where(eq(fileHashes.hash, file.hash));

  const [row] = await db
    .select({ refCount: fileHashes.refCount })
    .from(fileHashes)
    .where(eq(fileHashes.hash, file.hash));

  if (row && row.refCount <= 0) {
    await db.delete(fileHashes).where(eq(fileHashes.hash, file.hash));
    return file.s3Key;
  }
  return null;
}
