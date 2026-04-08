import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Projects (workspaces). Every chat belongs to a project. A project's `path`
 * is the absolute filesystem directory the Pi agent uses as its working
 * directory, and is immutable after creation — enforced at the router layer
 * (no `path` on the update input) and again at the db helper layer (explicit
 * whitelist in `updateProject`).
 */
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** Absolute filesystem path; canonicalized via fs.realpath on create. Immutable. */
    path: text("path").notNull(),
    /** Replaces Pi's default system prompt when set. */
    customInstructions: text("custom_instructions"),
    /** Appended to the system prompt when set. */
    appendPrompt: text("append_prompt"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("projects_user_idx").on(table.userId),
    uniqueIndex("projects_user_path_idx").on(table.userId, table.path),
  ],
);
