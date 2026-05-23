import { Database } from "bun:sqlite";
import { ConsoleLogger, type Lock, type Logger, type QueueEntry, type StateAdapter } from "chat";
import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { runMigrations } from "./migrate";
import * as schema from "./schema";
import {
  chatStateCache,
  chatStateLists,
  chatStateLocks,
  chatStateQueues,
  chatStateSubscriptions,
} from "./schema";

export * as schema from "./schema";
export { runMigrations } from "./migrate";

export interface RelayStateAdapterOptions {
  /** SQLite file path (or `:memory:`). Defaults to the relay env path. */
  path?: string;
  /** Existing bun:sqlite Database instance. Takes precedence over `path`. */
  client?: Database;
  /** Key prefix for all rows (default: "chat-sdk"). */
  keyPrefix?: string;
  /** Logger instance for error reporting. */
  logger?: Logger;
  /** Enable WAL journal mode when opening a fresh client (default: true). */
  wal?: boolean;
}

type RelayDrizzle = BunSQLiteDatabase<typeof schema>;

export class RelayStateAdapter implements StateAdapter {
  private readonly raw: Database;
  private readonly db: RelayDrizzle;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;

  constructor(options: RelayStateAdapterOptions = {}) {
    if (options.client) {
      this.raw = options.client;
      this.ownsClient = false;
    } else {
      const path = options.path ?? resolveDefaultPath();
      this.raw = new Database(path, { create: true });
      this.ownsClient = true;
      if (options.wal !== false) {
        this.raw.exec("PRAGMA journal_mode = WAL;");
      }
    }

    this.db = drizzle(this.raw, { schema });
    this.keyPrefix = options.keyPrefix ?? "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("relay-db");
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      runMigrations(this.raw);
      this.connected = true;
    } catch (error) {
      this.logger.error("relay-db connect failed", { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    if (this.ownsClient) this.raw.close();
    this.connected = false;
  }

  async subscribe(threadId: string): Promise<void> {
    this.db
      .insert(chatStateSubscriptions)
      .values({ keyPrefix: this.keyPrefix, threadId, createdAt: now() })
      .onConflictDoNothing()
      .run();
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.db
      .delete(chatStateSubscriptions)
      .where(
        and(
          eq(chatStateSubscriptions.keyPrefix, this.keyPrefix),
          eq(chatStateSubscriptions.threadId, threadId),
        ),
      )
      .run();
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const row = this.db
      .select({ one: sql<number>`1` })
      .from(chatStateSubscriptions)
      .where(
        and(
          eq(chatStateSubscriptions.keyPrefix, this.keyPrefix),
          eq(chatStateSubscriptions.threadId, threadId),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const token = generateToken();
    const nowMs = now();
    const expiresAt = nowMs + ttlMs;

    const inserted = this.db
      .insert(chatStateLocks)
      .values({
        keyPrefix: this.keyPrefix,
        threadId,
        token,
        expiresAt,
        updatedAt: nowMs,
      })
      .onConflictDoNothing()
      .returning({
        threadId: chatStateLocks.threadId,
        token: chatStateLocks.token,
        expiresAt: chatStateLocks.expiresAt,
      })
      .get();

    if (inserted) return inserted;

    const updated = this.db
      .update(chatStateLocks)
      .set({ token, expiresAt, updatedAt: nowMs })
      .where(
        and(
          eq(chatStateLocks.keyPrefix, this.keyPrefix),
          eq(chatStateLocks.threadId, threadId),
          lte(chatStateLocks.expiresAt, nowMs),
        ),
      )
      .returning({
        threadId: chatStateLocks.threadId,
        token: chatStateLocks.token,
        expiresAt: chatStateLocks.expiresAt,
      })
      .get();

    return updated ?? null;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.db
      .delete(chatStateLocks)
      .where(
        and(
          eq(chatStateLocks.keyPrefix, this.keyPrefix),
          eq(chatStateLocks.threadId, threadId),
        ),
      )
      .run();
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.db
      .delete(chatStateLocks)
      .where(
        and(
          eq(chatStateLocks.keyPrefix, this.keyPrefix),
          eq(chatStateLocks.threadId, lock.threadId),
          eq(chatStateLocks.token, lock.token),
        ),
      )
      .run();
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const nowMs = now();
    const result = this.db
      .update(chatStateLocks)
      .set({ expiresAt: nowMs + ttlMs, updatedAt: nowMs })
      .where(
        and(
          eq(chatStateLocks.keyPrefix, this.keyPrefix),
          eq(chatStateLocks.threadId, lock.threadId),
          eq(chatStateLocks.token, lock.token),
          sql`${chatStateLocks.expiresAt} > ${nowMs}`,
        ),
      )
      .returning({ threadId: chatStateLocks.threadId })
      .get();
    return result !== undefined;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const nowMs = now();
    const row = this.db
      .select({ value: chatStateCache.value })
      .from(chatStateCache)
      .where(
        and(
          eq(chatStateCache.keyPrefix, this.keyPrefix),
          eq(chatStateCache.cacheKey, key),
          or(
            sql`${chatStateCache.expiresAt} IS NULL`,
            sql`${chatStateCache.expiresAt} > ${nowMs}`,
          ),
        ),
      )
      .limit(1)
      .get();

    if (!row) {
      this.db
        .delete(chatStateCache)
        .where(
          and(
            eq(chatStateCache.keyPrefix, this.keyPrefix),
            eq(chatStateCache.cacheKey, key),
            isNotNull(chatStateCache.expiresAt),
            lte(chatStateCache.expiresAt, nowMs),
          ),
        )
        .run();
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const nowMs = now();
    const expiresAt = ttlMs ? nowMs + ttlMs : null;
    this.db
      .insert(chatStateCache)
      .values({
        keyPrefix: this.keyPrefix,
        cacheKey: key,
        value: JSON.stringify(value),
        expiresAt,
        updatedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [chatStateCache.keyPrefix, chatStateCache.cacheKey],
        set: {
          value: sql`excluded.value`,
          expiresAt: sql`excluded.expires_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    const nowMs = now();
    const expiresAt = ttlMs ? nowMs + ttlMs : null;
    const result = this.db
      .insert(chatStateCache)
      .values({
        keyPrefix: this.keyPrefix,
        cacheKey: key,
        value: JSON.stringify(value),
        expiresAt,
        updatedAt: nowMs,
      })
      .onConflictDoNothing()
      .returning({ cacheKey: chatStateCache.cacheKey })
      .get();
    return result !== undefined;
  }

  async delete(key: string): Promise<void> {
    this.db
      .delete(chatStateCache)
      .where(
        and(
          eq(chatStateCache.keyPrefix, this.keyPrefix),
          eq(chatStateCache.cacheKey, key),
        ),
      )
      .run();
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    const expiresAt = options?.ttlMs ? now() + options.ttlMs : null;
    const maxLength = options?.maxLength ?? 0;
    const serialized = JSON.stringify(value);

    this.db.transaction((tx) => {
      tx.insert(chatStateLists)
        .values({ keyPrefix: this.keyPrefix, listKey: key, value: serialized, expiresAt })
        .run();

      if (maxLength > 0) {
        tx.run(sql`
          DELETE FROM chat_state_lists
          WHERE seq IN (
            SELECT seq FROM chat_state_lists
            WHERE key_prefix = ${this.keyPrefix} AND list_key = ${key}
            ORDER BY seq ASC
            LIMIT max(
              0,
              (SELECT count(*) FROM chat_state_lists WHERE key_prefix = ${this.keyPrefix} AND list_key = ${key}) - ${maxLength}
            )
          )
        `);
      }

      if (expiresAt !== null) {
        tx.update(chatStateLists)
          .set({ expiresAt })
          .where(
            and(
              eq(chatStateLists.keyPrefix, this.keyPrefix),
              eq(chatStateLists.listKey, key),
            ),
          )
          .run();
      }
    });
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const nowMs = now();
    const rows = this.db
      .select({ value: chatStateLists.value })
      .from(chatStateLists)
      .where(
        and(
          eq(chatStateLists.keyPrefix, this.keyPrefix),
          eq(chatStateLists.listKey, key),
          or(
            sql`${chatStateLists.expiresAt} IS NULL`,
            sql`${chatStateLists.expiresAt} > ${nowMs}`,
          ),
        ),
      )
      .orderBy(asc(chatStateLists.seq))
      .all();
    return rows.map((row) => JSON.parse(row.value) as T);
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    const serialized = JSON.stringify(entry);
    const expiresAt = entry.expiresAt;

    return this.db.transaction((tx) => {
      const nowMs = now();
      tx.delete(chatStateQueues)
        .where(
          and(
            eq(chatStateQueues.keyPrefix, this.keyPrefix),
            eq(chatStateQueues.threadId, threadId),
            lte(chatStateQueues.expiresAt, nowMs),
          ),
        )
        .run();

      tx.insert(chatStateQueues)
        .values({ keyPrefix: this.keyPrefix, threadId, value: serialized, expiresAt })
        .run();

      if (maxSize > 0) {
        const trimNow = now();
        tx.run(sql`
          DELETE FROM chat_state_queues
          WHERE seq IN (
            SELECT seq FROM chat_state_queues
            WHERE key_prefix = ${this.keyPrefix} AND thread_id = ${threadId} AND expires_at > ${trimNow}
            ORDER BY seq ASC
            LIMIT max(
              0,
              (SELECT count(*) FROM chat_state_queues
                 WHERE key_prefix = ${this.keyPrefix} AND thread_id = ${threadId} AND expires_at > ${trimNow}) - ${maxSize}
            )
          )
        `);
      }

      const depthRow = tx
        .select({ depth: sql<number>`count(*)`.as("depth") })
        .from(chatStateQueues)
        .where(
          and(
            eq(chatStateQueues.keyPrefix, this.keyPrefix),
            eq(chatStateQueues.threadId, threadId),
            sql`${chatStateQueues.expiresAt} > ${now()}`,
          ),
        )
        .get();
      return depthRow?.depth ?? 0;
    });
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    return this.db.transaction((tx) => {
      const nowMs = now();
      tx.delete(chatStateQueues)
        .where(
          and(
            eq(chatStateQueues.keyPrefix, this.keyPrefix),
            eq(chatStateQueues.threadId, threadId),
            lte(chatStateQueues.expiresAt, nowMs),
          ),
        )
        .run();

      const row = tx.get<[string] | undefined>(sql`
        DELETE FROM chat_state_queues
        WHERE seq = (
          SELECT seq FROM chat_state_queues
          WHERE key_prefix = ${this.keyPrefix} AND thread_id = ${threadId} AND expires_at > ${now()}
          ORDER BY seq ASC
          LIMIT 1
        )
        RETURNING value
      `);
      return row ? (JSON.parse(row[0]) as QueueEntry) : null;
    });
  }

  async queueDepth(threadId: string): Promise<number> {
    const row = this.db
      .select({ depth: sql<number>`count(*)`.as("depth") })
      .from(chatStateQueues)
      .where(
        and(
          eq(chatStateQueues.keyPrefix, this.keyPrefix),
          eq(chatStateQueues.threadId, threadId),
          sql`${chatStateQueues.expiresAt} > ${now()}`,
        ),
      )
      .get();
    return row?.depth ?? 0;
  }

  getClient(): Database {
    return this.raw;
  }

  getDrizzle(): RelayDrizzle {
    return this.db;
  }
}

function resolveDefaultPath(): string {
  // Lazy require so importing this package doesn't trigger relay-env
  // validation (createEnv) in contexts that don't have STACK_*/GMAIL_* set
  // — e.g. the desktop bun runtime, which passes an explicit path.
  const { relayDatabaseFilePath } = require("@g-spot/env/relay") as typeof import("@g-spot/env/relay");
  return relayDatabaseFilePath();
}

function now(): number {
  return Date.now();
}

function generateToken(): string {
  return `relay_${crypto.randomUUID()}`;
}

export function createRelayState(options: RelayStateAdapterOptions = {}): RelayStateAdapter {
  return new RelayStateAdapter(options);
}
