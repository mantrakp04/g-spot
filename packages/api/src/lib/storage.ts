import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BUCKET = "file-storage";
const LOCAL_STORAGE_PATH = "./local-storage";
const CONTENT_TYPE_SUFFIX = ".content-type";

export function getLocalObjectPath(key: string): string {
  return path.resolve(LOCAL_STORAGE_PATH, BUCKET, key);
}

function getContentTypePath(key: string): string {
  return `${getLocalObjectPath(key)}${CONTENT_TYPE_SUFFIX}`;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const normalizedBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const filePath = getLocalObjectPath(key);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, normalizedBody);
  await writeFile(getContentTypePath(key), contentType);
}

export async function getObject(
  key: string,
): Promise<{ body: NodeJS.ReadableStream; contentType: string }> {
  const contentType = await readFile(getContentTypePath(key), "utf8").catch(
    () => "application/octet-stream",
  );

  return {
    body: createReadStream(getLocalObjectPath(key)),
    contentType,
  };
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await stat(getLocalObjectPath(key));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectSize(key: string): Promise<number | null> {
  try {
    const result = await stat(getLocalObjectPath(key));
    return result.size;
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await Promise.all([
    rm(getLocalObjectPath(key), { force: true }),
    rm(getContentTypePath(key), { force: true }),
  ]);
}
