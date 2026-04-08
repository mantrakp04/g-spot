import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { projects } from "./projects";

/**
 * Skills are reusable prompt bundles. They come in two scopes:
 *
 * - **Project-scoped** (`projectId` is set): visible only to chats inside that
 *   project. On name collision they shadow the user's global skill with the
 *   same name.
 * - **Global** (`projectId` is NULL): visible to every project the user owns.
 *
 * Name uniqueness has to be enforced per-scope because SQLite treats NULL as
 * distinct in regular unique indexes. Two partial unique indexes handle each
 * scope separately.
 */
export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    content: text("content").notNull().default(""),
    /** JSON-encoded string array used only for local slash-command ranking. */
    triggerKeywords: text("trigger_keywords").notNull().default("[]"),
    disableModelInvocation: integer("disable_model_invocation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("skills_user_idx").on(table.userId),
    index("skills_project_idx").on(table.projectId),
    uniqueIndex("skills_global_name_unique")
      .on(table.userId, table.name)
      .where(sql`${table.projectId} IS NULL`),
    uniqueIndex("skills_project_name_unique")
      .on(table.projectId, table.name)
      .where(sql`${table.projectId} IS NOT NULL`),
  ],
);
