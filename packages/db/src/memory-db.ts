import { env } from "@g-spot/env/server";
import Database from "libsql";
import { existsSync } from "node:fs";
import path from "node:path";

export type MemoryNativeDb = {
  pragma(statement: string): unknown;
  loadExtension(path: string): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  close(): void;
};

const VECTOR_EXTENSION_PATH =
  env.VECTOR_EXTENSION_PATH ??
  path.resolve(import.meta.dirname, "../../../extensions/vector");
const EMBEDDING_DIM = 768;

let nativeDb: MemoryNativeDb | null = null;

function resolveMainDbPath(): string {
  if (!env.DATABASE_URL.startsWith("file:")) {
    throw new Error("Memory DB requires DATABASE_URL to point to a local file");
  }

  const rawPath = env.DATABASE_URL.slice("file:".length);
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const serverDir = path.resolve(repoRoot, "apps/server");
  const candidates = [
    path.resolve(process.cwd(), rawPath),
    path.resolve(serverDir, rawPath),
    path.resolve(repoRoot, rawPath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1]!;
}

function initializeVectorIndexes(db: MemoryNativeDb) {
  db.exec(
    `SELECT vector_init('memory_entities', 'embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
  );
  db.exec(
    `SELECT vector_init('memory_observations', 'embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
  );
  db.exec(
    `SELECT vector_init('memory_edges', 'triplet_embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
  );
}

function getOrCreateNativeDb() {
  if (!nativeDb) {
    nativeDb = new Database(resolveMainDbPath());
    nativeDb.pragma("journal_mode = WAL");
    nativeDb.pragma("foreign_keys = ON");
    nativeDb.loadExtension(VECTOR_EXTENSION_PATH);
    initializeVectorIndexes(nativeDb);
  }

  return nativeDb;
}

export function getMemoryNativeDb(): MemoryNativeDb {
  return getOrCreateNativeDb();
}

export function closeMemoryDb() {
  if (!nativeDb) return;
  nativeDb.close();
  nativeDb = null;
}
