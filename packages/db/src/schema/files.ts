import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Content-addressed storage: one row per unique file content (SHA-256). */
export const fileHashes = sqliteTable("file_hashes", {
  hash: text("hash").primaryKey(),
  s3Key: text("s3_key").notNull(),
  size: integer("size").notNull(),
  refCount: integer("ref_count").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/** File metadata; many metadata rows can point to one hash. */
export const fileMetadata = sqliteTable(
  "file_metadata",
  {
    id: text("id").primaryKey(),
    hash: text("hash")
      .notNull()
      .references(() => fileHashes.hash),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("file_metadata_hash_idx").on(table.hash)],
);
