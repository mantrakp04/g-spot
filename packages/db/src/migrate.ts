/**
 * Custom migrate runner.
 *
 * Uses bun:sqlite with sqlite-vec loaded so migrations share the app's
 * runtime connection. drizzle-kit's own `migrate` can't introspect past our
 * `vec_*` virtual tables (its libsql client doesn't load extensions); this
 * runner sidesteps that.
 *
 * Also bootstraps the `__drizzle_migrations` journal for pre-existing DBs
 * — if the journal table is empty but app tables already exist, we seed
 * the journal with every migration currently in `src/migrations/` and skip
 * running their SQL. This lets repos that predate the migrations workflow
 * adopt it without manual reconciliation.
 *
 * Usage: `bun run db:migrate`
 */

import { env } from "@g-spot/env/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { openNativeDb, resolveDbFilePath } from "./native-sqlite";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const migrationsFolder = path.resolve(import.meta.dirname, "./migrations");

type MigrationLogger = Pick<typeof console, "log">;

export function runMigrations(logger: MigrationLogger = console): void {
  const rawDb = openNativeDb(resolveDbFilePath(env.DATABASE_URL));

  try {
    bootstrapJournalIfNeeded(rawDb, logger);

    migrate(drizzle(rawDb), { migrationsFolder });

    logger.log("migrations applied");
  } finally {
    rawDb.close();
  }
}

if (import.meta.main) {
  runMigrations();
}

function bootstrapJournalIfNeeded(
  db: ReturnType<typeof openNativeDb>,
  logger: MigrationLogger,
): void {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  let journal: Journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  } catch {
    return; // no journal — let migrate() error if it wants
  }

  const journalExistsRow = db
    .prepare(
      `SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(DRIZZLE_MIGRATIONS_TABLE) as { count: number } | null;
  const journalExists = (journalExistsRow?.count ?? 0) > 0;

  const journalRowCount = journalExists
    ? ((db
        .prepare(`SELECT count(*) AS count FROM ${DRIZZLE_MIGRATIONS_TABLE}`)
        .get() as { count: number } | null)?.count ?? 0)
    : 0;

  const appRow = db
    .prepare(
      `SELECT count(*) AS count FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'vec_%'
         AND name NOT LIKE '__drizzle_%'`,
    )
    .get() as { count: number } | null;
  const appTables = appRow?.count ?? 0;

  logger.log(
    `[migrate] bootstrap check: journalExists=${journalExists} journalRows=${journalRowCount} appTables=${appTables}`,
  );

  // Case 1: journal already populated — normal incremental path
  if (journalRowCount > 0) return;

  // Case 2: fresh DB with no app tables — let migrate() create everything
  if (appTables === 0) return;

  // Case 3: pre-existing DB — seed the journal
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${DRIZZLE_MIGRATIONS_TABLE} (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash TEXT NOT NULL,
       created_at NUMERIC
     )`,
  );

  const insert = db.prepare(
    `INSERT INTO ${DRIZZLE_MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`,
  );

  const seededTags: string[] = [];
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    insert.run(hash, entry.when);
    seededTags.push(entry.tag);
  }
  logger.log(
    `bootstrapped journal with ${seededTags.length} existing migration(s): ${seededTags.join(", ")}`,
  );
}
