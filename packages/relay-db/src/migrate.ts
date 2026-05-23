import { Database } from "bun:sqlite";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const migrationsFolder = path.resolve(import.meta.dirname, "./migrations");

export function runMigrations(client?: Database): void {
  const ownsClient = !client;
  const db = client ?? new Database(resolveDefaultPath(), { create: true });

  try {
    if (ownsClient) db.exec("PRAGMA journal_mode = WAL;");
    migrate(drizzle(db), { migrationsFolder });
  } finally {
    if (ownsClient) db.close();
  }
}

function resolveDefaultPath(): string {
  const { relayDatabaseFilePath } = require("@g-spot/env/relay") as typeof import("@g-spot/env/relay");
  return relayDatabaseFilePath();
}

if (import.meta.main) {
  runMigrations();
  console.log("relay-db migrations applied");
}
