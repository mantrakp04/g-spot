import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const relayEvents = sqliteTable(
  "relay_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    pubsubMessageId: text("pubsub_message_id"),
    emailAddress: text("email_address").notNull(),
    historyId: text("history_id").notNull(),
    publishTime: text("publish_time"),
    receivedAt: text("received_at").notNull(),
    drainedAt: text("drained_at"),
    attempts: integer("attempts").notNull().default(0),
    lastSentAt: text("last_sent_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("relay_events_message_user_idx").on(
      table.pubsubMessageId,
      table.userId,
    ),
    index("relay_events_user_pending_idx").on(
      table.userId,
      table.drainedAt,
      table.createdAt,
    ),
  ],
);

export type RelayEventRow = typeof relayEvents.$inferSelect;
