import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export { chats, chatMessages } from "./chat";
export { fileExtractions, fileHashes, fileMetadata } from "./files";
export { piState } from "./pi";
export { projects } from "./projects";
export { notes, noteLinks } from "./notes";
export {
  memoryEntities,
  memoryObservations,
  memoryEdges,
  memoryBlocks,
  memoryBlockHistory,
  memoryAuditLog,
} from "./memory";
export {
  gmailAccounts,
  gmailLabels,
  gmailThreads,
  gmailMessages,
  gmailAttachments,
  gmailSyncState,
  gmailFetchState,
  gmailAnalysisState,
  gmailSyncFailures,
} from "./gmail";

export const sections = sqliteTable(
  "sections",
  {
    id: text("id").primaryKey(),
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
  (table) => [index("sections_position_idx").on(table.position)],
);
