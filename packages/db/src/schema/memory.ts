import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const memoryEntities = sqliteTable(
  "memory_entities",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(),
    description: text("description").notNull(),
    aliases: text("aliases").notNull().default("[]"),
    hash: text("hash").notNull(),
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    version: integer("version").notNull().default(1),
    salience: real("salience").notNull().default(1.0),
    decayRate: real("decay_rate").notNull().default(0.005),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    embedding: blob("embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_entities_name_idx").on(table.name),
    index("mem_entities_hash_idx").on(table.hash),
    index("mem_entities_valid_idx").on(table.validTo),
    index("mem_entities_type_idx").on(table.entityType),
  ],
);

export const memoryObservations = sqliteTable(
  "memory_observations",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    observationType: text("observation_type").notNull(),
    confidence: real("confidence").notNull().default(0.8),
    sourceMessageId: text("source_message_id"),
    entityIds: text("entity_ids").notNull().default("[]"),
    hash: text("hash").notNull(),
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    version: integer("version").notNull().default(1),
    salience: real("salience").notNull().default(1.0),
    decayRate: real("decay_rate").notNull().default(0.005),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    embedding: blob("embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_obs_type_idx").on(table.observationType),
    index("mem_obs_hash_idx").on(table.hash),
    index("mem_obs_valid_idx").on(table.validTo),
    index("mem_obs_entity_idx").on(table.entityIds),
  ],
);

export const memoryEdges = sqliteTable(
  "memory_edges",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id").notNull(),
    sourceType: text("source_type").notNull(),
    targetType: text("target_type").notNull(),
    relationshipType: text("relationship_type").notNull(),
    description: text("description").notNull(),
    weight: real("weight").notNull().default(1.0),
    confidence: real("confidence").notNull().default(0.8),
    tripletText: text("triplet_text").notNull(),
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    tripletEmbedding: blob("triplet_embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_edges_source_idx").on(table.sourceId),
    index("mem_edges_target_idx").on(table.targetId),
    index("mem_edges_valid_idx").on(table.validTo),
    index("mem_edges_rel_idx").on(table.relationshipType),
  ],
);

export const memoryBlocks = sqliteTable(
  "memory_blocks",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull().unique(),
    value: text("value").notNull().default(""),
    limit: integer("limit").notNull().default(2000),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const memoryBlockHistory = sqliteTable(
  "memory_block_history",
  {
    id: text("id").primaryKey(),
    blockId: text("block_id")
      .notNull()
      .references(() => memoryBlocks.id, { onDelete: "cascade" }),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: integer("changed_at").notNull(),
    seq: integer("seq").notNull(),
  },
  (table) => [
    index("mem_block_hist_block_idx").on(table.blockId),
    index("mem_block_hist_seq_idx").on(table.blockId, table.seq),
  ],
);

export const memoryAuditLog = sqliteTable(
  "memory_audit_log",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull(),
    targetType: text("target_type").notNull(),
    event: text("event").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("mem_audit_target_idx").on(table.targetId),
    index("mem_audit_time_idx").on(table.createdAt),
  ],
);

export type MemoryEntity = typeof memoryEntities.$inferSelect;
export type MemoryObservation = typeof memoryObservations.$inferSelect;
export type MemoryEdge = typeof memoryEdges.$inferSelect;
export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type MemoryBlockHistory = typeof memoryBlockHistory.$inferSelect;
export type MemoryAuditEntry = typeof memoryAuditLog.$inferSelect;
