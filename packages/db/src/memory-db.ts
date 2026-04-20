import { env } from "@g-spot/env/server";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { getLoadablePath as getSqliteVecPath } from "sqlite-vec";

export type MemoryNativeDb = {
  loadExtension(path: string): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  close(): void;
};

const EMBEDDING_DIM = 768;

// bun:sqlite ships with a SQLite build that has extension loading disabled.
// We point it at a system SQLite (typically Homebrew) that was compiled with
// SQLITE_ENABLE_LOAD_EXTENSION so we can load sqlite-vec.
const SQLITE_CANDIDATES: readonly string[] = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // macOS (Apple Silicon)
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // macOS (Intel)
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0", // Debian/Ubuntu x86_64
  "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0", // Debian/Ubuntu arm64
  "/usr/lib64/libsqlite3.so.0", // Fedora/RHEL
];

let nativeDb: MemoryNativeDb | null = null;

// Bun's `Database.setCustomSQLite()` can only run once per process — a second
// call throws "SQLite already loaded". Module scope isn't enough because
// bun --hot reloads our file while the process (and Bun's SQLite state) lives
// on. Track it on globalThis so hot-reload doesn't forget.
const SQLITE_FLAG = Symbol.for("@g-spot/db/custom-sqlite-loaded");
type SqliteFlagHolder = { [SQLITE_FLAG]?: boolean };

function resolveSystemSqlite(): string {
  const override = process.env.SQLITE_LIB_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `SQLITE_LIB_PATH is set to "${override}" but that file does not exist.`,
      );
    }
    return override;
  }

  for (const candidate of SQLITE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "bun:sqlite is built without extension loading and no system SQLite was found. " +
      "Install one (macOS: `brew install sqlite`) or set SQLITE_LIB_PATH. " +
      `Searched: ${SQLITE_CANDIDATES.join(", ")}`,
  );
}

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

function ensureCustomSqlite(): void {
  const holder = globalThis as SqliteFlagHolder;
  if (holder[SQLITE_FLAG]) return;
  try {
    Database.setCustomSQLite(resolveSystemSqlite());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Another module beat us to it — either a previous pass in this same
    // process (hot reload) or the default Bun sqlite was opened first. If
    // the former, we're fine. If the latter, `loadExtension` below will
    // fail with a clearer error than this one.
    if (!/already loaded/i.test(message)) throw error;
  }
  holder[SQLITE_FLAG] = true;
}

function loadVectorExtension(db: MemoryNativeDb) {
  const extensionPath = getSqliteVecPath();
  if (!existsSync(extensionPath)) {
    throw new Error(
      `sqlite-vec loadable extension missing at ${extensionPath}. ` +
        `Run 'bun install' in the repo root to pull the platform-specific binary.`,
    );
  }
  db.loadExtension(extensionPath);
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
    ensureCustomSqlite();
    const db = new Database(resolveMainDbPath()) as unknown as MemoryNativeDb;
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    loadVectorExtension(db);
    initializeVectorTables(db);
    nativeDb = db;
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
