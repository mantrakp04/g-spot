import { Database, type Statement } from "bun:sqlite";
import { ConsoleLogger, type Lock, type Logger, type QueueEntry, type StateAdapter } from "chat";

export interface SqliteStateAdapterOptions {
  /** SQLite file path (or `:memory:`) */
  path: string;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Enable WAL journal mode (default: true — recommended for concurrent readers) */
  wal?: boolean;
}

export interface SqliteStateClientOptions {
  /** Existing bun:sqlite Database instance */
  client: Database;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreateSqliteStateOptions =
  | (Partial<SqliteStateAdapterOptions> & { client?: never })
  | (Partial<Omit<SqliteStateClientOptions, "client">> & { client: Database });

type PreparedStatements = {
  subscribe: Statement;
  unsubscribe: Statement;
  isSubscribed: Statement;
  acquireLockInsert: Statement;
  acquireLockUpdate: Statement;
  forceReleaseLock: Statement;
  releaseLock: Statement;
  extendLock: Statement;
  cacheGet: Statement;
  cacheDeleteExpired: Statement;
  cacheUpsert: Statement;
  cacheInsertIfAbsent: Statement;
  cacheDelete: Statement;
  listInsert: Statement;
  listTrim: Statement;
  listTouchTtl: Statement;
  listGet: Statement;
  queuePurgeExpired: Statement;
  queueInsert: Statement;
  queueTrim: Statement;
  queueDepth: Statement;
  queueDequeue: Statement;
};

const CURRENT_SCHEMA_VERSION = 1;

const schemaMigrations: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, thread_id)
    );

    CREATE TABLE IF NOT EXISTS chat_state_locks (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, thread_id)
    );
    CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
      ON chat_state_locks (expires_at);

    CREATE TABLE IF NOT EXISTS chat_state_cache (
      key_prefix TEXT NOT NULL,
      cache_key  TEXT NOT NULL,
      value      TEXT NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key_prefix, cache_key)
    );
    CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
      ON chat_state_cache (expires_at);

    CREATE TABLE IF NOT EXISTS chat_state_lists (
      key_prefix TEXT NOT NULL,
      list_key   TEXT NOT NULL,
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      value      TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS chat_state_lists_key_idx
      ON chat_state_lists (key_prefix, list_key, seq);
    CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
      ON chat_state_lists (expires_at);

    CREATE TABLE IF NOT EXISTS chat_state_queues (
      key_prefix TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_state_queues_key_idx
      ON chat_state_queues (key_prefix, thread_id, seq);
    CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx
      ON chat_state_queues (expires_at);
  `,
};

export function migrateSqliteStateSchema(db: Database): void {
  const versionRow = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | null;
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `SQLite state schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  if (currentVersion === CURRENT_SCHEMA_VERSION) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (
      let nextVersion = currentVersion + 1;
      nextVersion <= CURRENT_SCHEMA_VERSION;
      nextVersion += 1
    ) {
      const sql = schemaMigrations[nextVersion];
      if (!sql) throw new Error(`Missing SQLite state migration ${nextVersion}`);
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${nextVersion}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export class SqliteStateAdapter implements StateAdapter {
  private readonly db: Database;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private stmts: PreparedStatements | null = null;
  private connected = false;

  constructor(options: SqliteStateAdapterOptions | SqliteStateClientOptions) {
    if ("client" in options) {
      this.db = options.client;
      this.ownsClient = false;
    } else {
      this.db = new Database(options.path, { create: true });
      this.ownsClient = true;
      if (options.wal !== false) {
        this.db.exec("PRAGMA journal_mode = WAL;");
      }
    }

    this.keyPrefix = options.keyPrefix ?? "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("sqlite");
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      this.ensureSchema();
      this.stmts = this.prepareStatements();
      this.connected = true;
    } catch (error) {
      this.logger.error("SQLite connect failed", { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.stmts = null;
    if (this.ownsClient) {
      this.db.close();
    }
    this.connected = false;
  }

  async subscribe(threadId: string): Promise<void> {
    this.stmt().subscribe.run(this.keyPrefix, threadId, now());
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.stmt().unsubscribe.run(this.keyPrefix, threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const row = this.stmt().isSubscribed.get(this.keyPrefix, threadId);
    return row !== null;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const token = generateToken();
    const nowMs = now();
    const expiresAt = nowMs + ttlMs;

    const inserted = this.stmt().acquireLockInsert.get(
      this.keyPrefix,
      threadId,
      token,
      expiresAt,
      nowMs,
    ) as LockRow | null;

    if (inserted) return rowToLock(inserted);

    const updated = this.stmt().acquireLockUpdate.get(
      token,
      expiresAt,
      nowMs,
      this.keyPrefix,
      threadId,
      nowMs,
    ) as LockRow | null;

    return updated ? rowToLock(updated) : null;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.stmt().forceReleaseLock.run(this.keyPrefix, threadId);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.stmt().releaseLock.run(this.keyPrefix, lock.threadId, lock.token);
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const nowMs = now();
    const result = this.stmt().extendLock.get(
      nowMs + ttlMs,
      nowMs,
      this.keyPrefix,
      lock.threadId,
      lock.token,
      nowMs,
    );
    return result !== null;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = this.stmt().cacheGet.get(this.keyPrefix, key, now()) as
      | { value: string }
      | null;

    if (!row) {
      this.stmt().cacheDeleteExpired.run(this.keyPrefix, key, now());
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? now() + ttlMs : null;
    this.stmt().cacheUpsert.run(
      this.keyPrefix,
      key,
      serialized,
      expiresAt,
      now(),
    );
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? now() + ttlMs : null;
    const result = this.stmt().cacheInsertIfAbsent.get(
      this.keyPrefix,
      key,
      serialized,
      expiresAt,
      now(),
    );
    return result !== null;
  }

  async delete(key: string): Promise<void> {
    this.stmt().cacheDelete.run(this.keyPrefix, key);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    const serialized = JSON.stringify(value);
    const expiresAt = options?.ttlMs ? now() + options.ttlMs : null;
    const maxLength = options?.maxLength ?? 0;

    this.db.transaction(() => {
      this.stmt().listInsert.run(this.keyPrefix, key, serialized, expiresAt);
      if (maxLength > 0) {
        this.stmt().listTrim.run(this.keyPrefix, key, this.keyPrefix, key, maxLength);
      }
      if (expiresAt !== null) {
        this.stmt().listTouchTtl.run(expiresAt, this.keyPrefix, key);
      }
    })();
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const rows = this.stmt().listGet.all(this.keyPrefix, key, now()) as {
      value: string;
    }[];
    return rows.map((row) => JSON.parse(row.value) as T);
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    const serialized = JSON.stringify(entry);
    const expiresAt = entry.expiresAt;

    return this.db.transaction(() => {
      this.stmt().queuePurgeExpired.run(this.keyPrefix, threadId, now());
      this.stmt().queueInsert.run(this.keyPrefix, threadId, serialized, expiresAt);
      if (maxSize > 0) {
        const nowMs = now();
        this.stmt().queueTrim.run(
          this.keyPrefix,
          threadId,
          nowMs,
          this.keyPrefix,
          threadId,
          nowMs,
          maxSize,
        );
      }
      const row = this.stmt().queueDepth.get(this.keyPrefix, threadId, now()) as
        | { depth: number }
        | null;
      return row?.depth ?? 0;
    })();
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    return this.db.transaction(() => {
      this.stmt().queuePurgeExpired.run(this.keyPrefix, threadId, now());
      const row = this.stmt().queueDequeue.get(
        this.keyPrefix,
        threadId,
        now(),
      ) as { value: string } | null;
      return row ? (JSON.parse(row.value) as QueueEntry) : null;
    })();
  }

  async queueDepth(threadId: string): Promise<number> {
    const row = this.stmt().queueDepth.get(this.keyPrefix, threadId, now()) as
      | { depth: number }
      | null;
    return row?.depth ?? 0;
  }

  getClient(): Database {
    return this.db;
  }

  private stmt(): PreparedStatements {
    if (!this.stmts) {
      throw new Error(
        "SqliteStateAdapter is not connected. Call connect() first.",
      );
    }
    return this.stmts;
  }

  private ensureSchema(): void {
    migrateSqliteStateSchema(this.db);
  }

  private prepareStatements(): PreparedStatements {
    const db = this.db;
    return {
      subscribe: db.prepare(
        `INSERT INTO chat_state_subscriptions (key_prefix, thread_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      ),
      unsubscribe: db.prepare(
        `DELETE FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?`,
      ),
      isSubscribed: db.prepare(
        `SELECT 1 FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?
         LIMIT 1`,
      ),
      acquireLockInsert: db.prepare(
        `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING thread_id, token, expires_at`,
      ),
      acquireLockUpdate: db.prepare(
        `UPDATE chat_state_locks
         SET token = ?, expires_at = ?, updated_at = ?
         WHERE key_prefix = ? AND thread_id = ?
           AND expires_at <= ?
         RETURNING thread_id, token, expires_at`,
      ),
      forceReleaseLock: db.prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ?`,
      ),
      releaseLock: db.prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ? AND token = ?`,
      ),
      extendLock: db.prepare(
        `UPDATE chat_state_locks
         SET expires_at = ?, updated_at = ?
         WHERE key_prefix = ?
           AND thread_id = ?
           AND token = ?
           AND expires_at > ?
         RETURNING thread_id`,
      ),
      cacheGet: db.prepare(
        `SELECT value FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
      ),
      cacheDeleteExpired: db.prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?
           AND expires_at IS NOT NULL AND expires_at <= ?`,
      ),
      cacheUpsert: db.prepare(
        `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key_prefix, cache_key) DO UPDATE
           SET value = excluded.value,
               expires_at = excluded.expires_at,
               updated_at = excluded.updated_at`,
      ),
      cacheInsertIfAbsent: db.prepare(
        `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key_prefix, cache_key) DO NOTHING
         RETURNING cache_key`,
      ),
      cacheDelete: db.prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?`,
      ),
      listInsert: db.prepare(
        `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
         VALUES (?, ?, ?, ?)`,
      ),
      listTrim: db.prepare(
        `DELETE FROM chat_state_lists
         WHERE seq IN (
           SELECT seq FROM chat_state_lists
           WHERE key_prefix = ? AND list_key = ?
           ORDER BY seq ASC
           LIMIT max(
             0,
             (SELECT count(*) FROM chat_state_lists WHERE key_prefix = ? AND list_key = ?) - ?
           )
         )`,
      ),
      listTouchTtl: db.prepare(
        `UPDATE chat_state_lists
         SET expires_at = ?
         WHERE key_prefix = ? AND list_key = ?`,
      ),
      listGet: db.prepare(
        `SELECT value FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ?
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY seq ASC`,
      ),
      queuePurgeExpired: db.prepare(
        `DELETE FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`,
      ),
      queueInsert: db.prepare(
        `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
         VALUES (?, ?, ?, ?)`,
      ),
      queueTrim: db.prepare(
        `DELETE FROM chat_state_queues
         WHERE seq IN (
           SELECT seq FROM chat_state_queues
           WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
           ORDER BY seq ASC
           LIMIT max(
             0,
             (SELECT count(*) FROM chat_state_queues
                WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?) - ?
           )
         )`,
      ),
      queueDepth: db.prepare(
        `SELECT count(*) AS depth FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`,
      ),
      queueDequeue: db.prepare(
        `DELETE FROM chat_state_queues
         WHERE seq = (
           SELECT seq FROM chat_state_queues
           WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
           ORDER BY seq ASC
           LIMIT 1
         )
         RETURNING value`,
      ),
    };
  }
}

type LockRow = { thread_id: string; token: string; expires_at: number };

function rowToLock(row: LockRow): Lock {
  return {
    threadId: row.thread_id,
    token: row.token,
    expiresAt: row.expires_at,
  };
}

function now(): number {
  return Date.now();
}

function generateToken(): string {
  return `sqlite_${crypto.randomUUID()}`;
}

export function createSqliteState(
  options: CreateSqliteStateOptions = {},
): SqliteStateAdapter {
  if ("client" in options && options.client) {
    return new SqliteStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const path = options.path ?? process.env.SQLITE_PATH;
  if (!path) {
    throw new Error(
      "SQLite path is required. Set SQLITE_PATH or provide it in options.",
    );
  }

  return new SqliteStateAdapter({
    path,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
    wal: options.wal,
  });
}
