import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PI_STATE_SINGLETON_ID = "singleton";

export const piState = sqliteTable("pi_state", {
  id: text("id").primaryKey().default(PI_STATE_SINGLETON_ID),
  chatDefaults: text("chat_defaults").notNull().default("{}"),
  workerDefaults: text("worker_defaults").notNull().default("{}"),
  credentials: text("credentials").notNull().default("{}"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type PiStateRow = typeof piState.$inferSelect;
