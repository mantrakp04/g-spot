import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    name: text("name").notNull(),
    path: text("path").notNull(),
    customInstructions: text("custom_instructions"),
    appendPrompt: text("append_prompt"),
    agentConfig: text("agent_config").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [uniqueIndex("projects_path_idx").on(table.path)],
);
