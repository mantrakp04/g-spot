import { env } from "@g-spot/env/server";
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";

import { openNativeDb } from "./native-sqlite";

export type MemoryNativeDb = Database;

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

function initializeVectorTables(db: MemoryNativeDb) {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(
       id TEXT PRIMARY KEY,
       embedding FLOAT[${EMBEDDING_DIM}] distance_metric=cosine
     )`,
  );
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_observations USING vec0(
       id TEXT PRIMARY KEY,
       embedding FLOAT[${EMBEDDING_DIM}] distance_metric=cosine
     )`,
  );
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_edges USING vec0(
       id TEXT PRIMARY KEY,
       embedding FLOAT[${EMBEDDING_DIM}] distance_metric=cosine
     )`,
  );
}

function getOrCreateNativeDb(): MemoryNativeDb {
  if (!nativeDb) {
    nativeDb = openNativeDb(resolveMainDbPath());
    initializeVectorTables(nativeDb);
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
