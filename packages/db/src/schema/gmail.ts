import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// gmail_accounts — one row per connected Google account
// ---------------------------------------------------------------------------
export const gmailAccounts = sqliteTable(
  "gmail_accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    historyId: text("history_id"),
    watchExpiration: integer("watch_expiration", { mode: "number" }),
    lastWatchHistoryId: text("last_watch_history_id"),
    lastWatchRenewedAt: text("last_watch_renewed_at"),
    lastNotificationHistoryId: text("last_notification_history_id"),
    lastNotificationAt: text("last_notification_at"),
    needsFullResync: integer("needs_full_resync", { mode: "boolean" })
      .notNull()
      .default(false),
    lastFullSyncAt: text("last_full_sync_at"),
    lastIncrementalSyncAt: text("last_incremental_sync_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_accounts_provider_idx").on(table.providerAccountId),
  ],
);

// ---------------------------------------------------------------------------
// gmail_labels — system + user labels per account
// ---------------------------------------------------------------------------
export const gmailLabels = sqliteTable(
  "gmail_labels",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    gmailId: text("gmail_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // "system" | "user"
    color: text("color"), // JSON { textColor, backgroundColor }
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_labels_account_gmail_idx").on(
      table.accountId,
      table.gmailId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// gmail_threads — thread metadata, labels as JSON array
// ---------------------------------------------------------------------------
export const gmailThreads = sqliteTable(
  "gmail_threads",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    lastMessageAt: text("last_message_at"),
    messageCount: integer("message_count").notNull().default(0),
    labels: text("labels").notNull().default("[]"), // JSON string[]
    historyId: text("history_id"),
    isProcessed: integer("is_processed", { mode: "boolean" })
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
    uniqueIndex("gmail_threads_account_thread_idx").on(
      table.accountId,
      table.gmailThreadId,
    ),
    index("gmail_threads_account_date_idx").on(
      table.accountId,
      table.lastMessageAt,
    ),
    index("gmail_threads_account_processed_idx").on(
      table.accountId,
      table.isProcessed,
    ),
  ],
);

// ---------------------------------------------------------------------------
// gmail_messages — full message content
// ---------------------------------------------------------------------------
export const gmailMessages = sqliteTable(
  "gmail_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => gmailThreads.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    fromName: text("from_name").notNull().default(""),
    fromEmail: text("from_email").notNull().default(""),
    toHeader: text("to_header").notNull().default(""),
    ccHeader: text("cc_header").notNull().default(""),
    subject: text("subject").notNull().default(""),
    date: text("date").notNull(),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    snippet: text("snippet").notNull().default(""),
    labels: text("labels").notNull().default("[]"), // JSON string[]
    messageIdHeader: text("message_id_header"),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    gmailDraftId: text("gmail_draft_id"),
    historyId: text("history_id"),
    rawSizeEstimate: integer("raw_size_estimate"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_messages_account_msg_idx").on(
      table.accountId,
      table.gmailMessageId,
    ),
    index("gmail_messages_thread_idx").on(table.threadId),
    index("gmail_messages_account_date_idx").on(table.accountId, table.date),
  ],
);

// ---------------------------------------------------------------------------
// gmail_attachments — metadata only (content stays in Gmail)
// ---------------------------------------------------------------------------
export const gmailAttachments = sqliteTable(
  "gmail_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),
    gmailAttachmentId: text("gmail_attachment_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("gmail_attachments_message_idx").on(table.messageId)],
);

// ---------------------------------------------------------------------------
// gmail_sync_state — live sync progress per account
// ---------------------------------------------------------------------------
export const gmailSyncState = sqliteTable(
  "gmail_sync_state",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("idle"), // idle|running|paused|completed|error
    mode: text("mode"), // full|incremental
    totalThreads: integer("total_threads").notNull().default(0),
    fetchedThreads: integer("fetched_threads").notNull().default(0),
    processableThreads: integer("processable_threads").notNull().default(0),
    processedThreads: integer("processed_threads").notNull().default(0),
    failedThreads: integer("failed_threads").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_sync_state_account_idx").on(table.accountId),
  ],
);

// ---------------------------------------------------------------------------
// gmail_fetch_state — fetch progress per account and sync mode
// ---------------------------------------------------------------------------
export const gmailFetchState = sqliteTable(
  "gmail_fetch_state",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // full|incremental
    status: text("status").notNull().default("idle"), // idle|running|paused|interrupted|completed|error
    totalThreads: integer("total_threads").notNull().default(0),
    fetchedThreads: integer("fetched_threads").notNull().default(0),
    failedThreads: integer("failed_threads").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_fetch_state_account_mode_idx").on(
      table.accountId,
      table.mode,
    ),
  ],
);

// ---------------------------------------------------------------------------
// gmail_analysis_state — inbox analysis progress per account
// ---------------------------------------------------------------------------
export const gmailAnalysisState = sqliteTable(
  "gmail_analysis_state",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("idle"), // idle|running|paused|completed|error
    totalThreads: integer("total_threads").notNull().default(0),
    analyzedThreads: integer("analyzed_threads").notNull().default(0),
    failedThreads: integer("failed_threads").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gmail_analysis_state_account_idx").on(table.accountId),
  ],
);

// ---------------------------------------------------------------------------
// gmail_sync_failures — dead-letter queue
// ---------------------------------------------------------------------------
export const gmailSyncFailures = sqliteTable(
  "gmail_sync_failures",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    stage: text("stage").notNull(), // fetch|extract|resolve|ingest
    errorMessage: text("error_message").notNull(),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(1),
    lastAttemptAt: text("last_attempt_at").notNull(),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("gmail_sync_failures_account_idx").on(
      table.accountId,
      table.resolvedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// gmail_agent_workflows — user-defined background workflows for Gmail sync
// ---------------------------------------------------------------------------
export const gmailAgentWorkflows = sqliteTable(
  "gmail_agent_workflows",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    trigger: text("trigger").notNull().default("incremental_sync"),
    prompt: text("prompt").notNull().default(""),
    agentConfig: text("agent_config").notNull().default("{}"),
    disabledToolNames: text("disabled_tool_names").notNull().default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("gmail_agent_workflows_account_idx").on(
      table.accountId,
      table.enabled,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
export type GmailAccountRow = typeof gmailAccounts.$inferSelect;
export type GmailLabelRow = typeof gmailLabels.$inferSelect;
export type GmailThreadRow = typeof gmailThreads.$inferSelect;
export type GmailMessageRow = typeof gmailMessages.$inferSelect;
export type GmailAttachmentRow = typeof gmailAttachments.$inferSelect;
export type GmailSyncStateRow = typeof gmailSyncState.$inferSelect;
export type GmailFetchStateRow = typeof gmailFetchState.$inferSelect;
export type GmailAnalysisStateRow = typeof gmailAnalysisState.$inferSelect;
export type GmailSyncFailureRow = typeof gmailSyncFailures.$inferSelect;
export type GmailAgentWorkflowRow = typeof gmailAgentWorkflows.$inferSelect;
