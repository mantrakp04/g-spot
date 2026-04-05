import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "mock-aws-s3-v3";

const BUCKET = "file-storage";
const LOCAL_STORAGE_PATH = "./local-storage";

const s3 = createS3Client({
  localDirectory: LOCAL_STORAGE_PATH,
  bucket: BUCKET,
});

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(
  key: string,
): Promise<{ body: NodeJS.ReadableStream; contentType: string }> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  return {
    body: result.Body as NodeJS.ReadableStream,
    contentType: result.ContentType ?? "application/octet-stream",
  };
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
