import { Database } from "bun:sqlite";
import type { QueueEntry } from "chat";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSqliteState, migrateSqliteStateSchema } from ".";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createLegacySchema(db: Database): void {
  db.exec(`
    CREATE TABLE chat_state_subscriptions (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, thread_id)
    );

    CREATE TABLE chat_state_locks (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, thread_id)
    );
    CREATE INDEX chat_state_locks_expires_idx
      ON chat_state_locks (expires_at);

    CREATE TABLE chat_state_cache (
      key_prefix TEXT NOT NULL,
      cache_key  TEXT NOT NULL,
      value      TEXT NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, cache_key)
    );
    CREATE INDEX chat_state_cache_expires_idx
      ON chat_state_cache (expires_at);

    CREATE TABLE chat_state_lists (
      key_prefix TEXT NOT NULL,
      list_key   TEXT NOT NULL,
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      value      TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX chat_state_lists_key_idx
      ON chat_state_lists (key_prefix, list_key, seq);
    CREATE INDEX chat_state_lists_expires_idx
      ON chat_state_lists (expires_at);

    CREATE TABLE chat_state_queues (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX chat_state_queues_key_idx
      ON chat_state_queues (key_prefix, thread_id, seq);
    CREATE INDEX chat_state_queues_expires_idx
      ON chat_state_queues (expires_at);
  `);
}

async function verifyFreshDb(dbPath: string): Promise<void> {
  const state = createSqliteState({ path: dbPath, keyPrefix: "relay" });
  await state.connect();
  await state.set("fresh-cache", { ok: true });
  await state.enqueue(
    "relay:user:fresh",
    {
      enqueuedAt: 1,
      expiresAt: Date.now() + 60_000,
      message: { raw: { id: "fresh" } } as unknown as QueueEntry["message"],
    },
    100,
  );
  assert((await state.get<{ ok: boolean }>("fresh-cache"))?.ok === true, "fresh cache read failed");
  assert((await state.queueDepth("relay:user:fresh")) === 1, "fresh queue depth failed");
  await state.disconnect();

  const db = new Database(dbPath);
  const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
  db.close();
  assert(version.user_version === 1, "fresh DB schema version was not recorded");
}

async function verifyLegacyDb(dbPath: string): Promise<void> {
  const db = new Database(dbPath, { create: true });
  createLegacySchema(db);
  db.prepare(
    `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("relay", "legacy-cache", JSON.stringify({ preserved: true }), null, 1);
  db.prepare(
    `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    "relay",
    "relay:user:legacy",
    JSON.stringify({
      enqueuedAt: 1,
      expiresAt: Date.now() + 60_000,
      message: { raw: { id: "legacy" } },
    }),
    Date.now() + 60_000,
  );
  migrateSqliteStateSchema(db);
  const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
  db.close();
  assert(version.user_version === 1, "legacy DB schema version was not recorded");

  const state = createSqliteState({ path: dbPath, keyPrefix: "relay" });
  await state.connect();
  assert(
    (await state.get<{ preserved: boolean }>("legacy-cache"))?.preserved === true,
    "legacy cache value was not preserved",
  );
  assert((await state.queueDepth("relay:user:legacy")) === 1, "legacy queue row was not preserved");
  const dequeued = await state.dequeue("relay:user:legacy");
  assert(dequeued !== null, "legacy queue row could not be dequeued");
  await state.disconnect();
}

const tempDir = mkdtempSync(path.join(tmpdir(), "chat-state-sqlite-"));

try {
  await verifyFreshDb(path.join(tempDir, "fresh.db"));
  await verifyLegacyDb(path.join(tempDir, "legacy.db"));
  console.log("sqlite state migrations compatible");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
