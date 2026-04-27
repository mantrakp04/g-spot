import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Obsidian-style notes vault.
 *
 * One table for both files and folders to keep the tree simple. `kind`
 * discriminates. Folders have empty `content`. `parentId` is a self-FK; root
 * entries have `parentId = null`.
 */
export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    kind: text("kind", { enum: ["note", "folder"] }).notNull().default("note"),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "notes_parent_fk",
    }).onDelete("cascade"),
    index("notes_parent_idx").on(table.parentId),
    index("notes_title_idx").on(table.title),
    uniqueIndex("notes_note_title_unique_idx")
      .on(table.title)
      .where(sql`${table.kind} = 'note'`),
  ],
);

/**
 * Resolved + unresolved [[wikilinks]] extracted from note content. Rebuilt on
 * every note save so backlinks and graph queries stay in sync without parsing
 * markdown at read time. `targetId` is null for unresolved links (target note
 * doesn't exist yet) — we still store the title so creating that note later
 * resolves all dangling refs.
 */
export const noteLinks = sqliteTable(
  "note_links",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetId: text("target_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    targetTitle: text("target_title").notNull(),
  },
  (table) => [
    index("note_links_source_idx").on(table.sourceId),
    index("note_links_target_idx").on(table.targetId),
    index("note_links_target_title_idx").on(table.targetTitle),
  ],
);
