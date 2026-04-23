import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getLoadablePath as getSqliteVecPath } from "sqlite-vec";

/**
 * bun:sqlite ships with SQLITE_ENABLE_LOAD_EXTENSION disabled, so we point it
 * at a system SQLite compiled with extension support (Homebrew on mac, distro
 * package on Linux).
 */
const SQLITE_CANDIDATES: readonly string[] = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // macOS (Apple Silicon)
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // macOS (Intel)
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0", // Debian/Ubuntu x86_64
  "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0", // Debian/Ubuntu arm64
  "/usr/lib64/libsqlite3.so.0", // Fedora/RHEL
];

// `Database.setCustomSQLite()` is a one-shot per process. Track on globalThis
// so bun --hot reloads don't re-enter it after the first pass.
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

function ensureCustomSqlite(): void {
  const holder = globalThis as SqliteFlagHolder;
  if (holder[SQLITE_FLAG]) return;
  try {
    Database.setCustomSQLite(resolveSystemSqlite());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already loaded/i.test(message)) throw error;
  }
  holder[SQLITE_FLAG] = true;
}

function loadVectorExtension(db: Database): void {
  const extensionPath = getSqliteVecPath();
  if (!existsSync(extensionPath)) {
    throw new Error(
      `sqlite-vec loadable extension missing at ${extensionPath}. ` +
        "Run `bun install` to pull the platform-specific binary.",
    );
  }
  db.loadExtension(extensionPath);
}

/** Open a bun:sqlite Database with sqlite-vec loaded and WAL enabled. */
export function openNativeDb(filePath: string): Database {
  ensureCustomSqlite();
  const db = new Database(filePath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  loadVectorExtension(db);
  return db;
}

export function resolveDbFilePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      `DATABASE_URL must be a file: URL for local-first operation, got "${databaseUrl}"`,
    );
  }
  return databaseUrl.slice("file:".length);
}
