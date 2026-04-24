import {
  createFileExtraction,
  getFileExtractionByHash,
  type getFileById,
} from "@g-spot/db/files";

import { getLocalObjectPath, getObject, putObject } from "./storage";

export const MAX_INLINE_EXTRACTED_TEXT_CHARS = 20_000;

const EXTRACTOR_VERSION = 1;

type StoredFile = NonNullable<Awaited<ReturnType<typeof getFileById>>>;

export type CachedFileExtraction = {
  text: string;
  charCount: number;
  localPath: string;
  textS3Key: string;
  inlineText: string;
  truncated: boolean;
};

function safeExtractedFilename(filename: string) {
  const basename = filename.split(/[\\/]/).pop()?.trim() || "attachment";
  return `${basename}.extracted.txt`;
}

async function readObjectText(key: string) {
  const { body } = await getObject(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getExtractionKey(file: StoredFile) {
  return `${file.s3Key}.${safeExtractedFilename(file.filename)}`;
}

export async function getOrCreateFileExtraction(
  file: StoredFile,
  extractText: () => Promise<string>,
): Promise<CachedFileExtraction> {
  const cached = await getFileExtractionByHash(file.hash);
  if (cached && cached.extractorVersion === EXTRACTOR_VERSION) {
    const text = await readObjectText(cached.textS3Key);
    return toCachedFileExtraction(cached.textS3Key, text);
  }

  const text = await extractText();
  const textS3Key = getExtractionKey(file);
  await putObject(textS3Key, Buffer.from(text), "text/plain; charset=utf-8");
  await createFileExtraction({
    hash: file.hash,
    extractorVersion: EXTRACTOR_VERSION,
    filename: file.filename,
    mimeType: file.mimeType,
    textS3Key,
    charCount: text.length,
  });

  const winner = await getFileExtractionByHash(file.hash);
  if (winner && winner.textS3Key !== textS3Key) {
    const winnerText = await readObjectText(winner.textS3Key);
    return toCachedFileExtraction(winner.textS3Key, winnerText);
  }

  return toCachedFileExtraction(textS3Key, text);
}

function toCachedFileExtraction(
  textS3Key: string,
  text: string,
): CachedFileExtraction {
  const truncated = text.length > MAX_INLINE_EXTRACTED_TEXT_CHARS;
  return {
    text,
    charCount: text.length,
    localPath: getLocalObjectPath(textS3Key),
    textS3Key,
    inlineText: truncated
      ? text.slice(0, MAX_INLINE_EXTRACTED_TEXT_CHARS)
      : text,
    truncated,
  };
}
