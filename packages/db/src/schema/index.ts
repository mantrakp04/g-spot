import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const sections = sqliteTable(
  "sections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    source: text("source", { enum: ["github_pr", "github_issue", "gmail"] }).notNull(),
    filters: text("filters").notNull().default("[]"),
    repos: text("repos").notNull().default("[]"),
    columns: text("columns").notNull().default("[]"),
    accountId: text("account_id"),
    position: integer("position").notNull(),
    showBadge: integer("show_badge", { mode: "boolean" }).notNull().default(true),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("sections_user_position_idx").on(table.userId, table.position)],
);
