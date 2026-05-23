import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chatStateSubscriptions = sqliteTable(
  "chat_state_subscriptions",
  {
    keyPrefix: text("key_prefix").notNull(),
    threadId: text("thread_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.keyPrefix, table.threadId] })],
);

export const chatStateLocks = sqliteTable(
  "chat_state_locks",
  {
    keyPrefix: text("key_prefix").notNull(),
    threadId: text("thread_id").notNull(),
    token: text("token").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyPrefix, table.threadId] }),
    index("chat_state_locks_expires_idx").on(table.expiresAt),
  ],
);

export const chatStateCache = sqliteTable(
  "chat_state_cache",
  {
    keyPrefix: text("key_prefix").notNull(),
    cacheKey: text("cache_key").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyPrefix, table.cacheKey] }),
    index("chat_state_cache_expires_idx").on(table.expiresAt),
  ],
);

export const chatStateLists = sqliteTable(
  "chat_state_lists",
  {
    keyPrefix: text("key_prefix").notNull(),
    listKey: text("list_key").notNull(),
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    value: text("value").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    index("chat_state_lists_key_idx").on(table.keyPrefix, table.listKey, table.seq),
    index("chat_state_lists_expires_idx").on(table.expiresAt),
  ],
);

export const chatStateQueues = sqliteTable(
  "chat_state_queues",
  {
    keyPrefix: text("key_prefix").notNull(),
    threadId: text("thread_id").notNull(),
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    value: text("value").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("chat_state_queues_key_idx").on(table.keyPrefix, table.threadId, table.seq),
    index("chat_state_queues_expires_idx").on(table.expiresAt),
  ],
);
