import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Entity — persons, orgs, projects, concepts, tools
// ---------------------------------------------------------------------------
export const memoryEntities = sqliteTable(
  "memory_entities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(), // person, organization, project, concept, tool, event, preference
    description: text("description").notNull(),
    aliases: text("aliases").notNull().default("[]"), // JSON string[]
    hash: text("hash").notNull(), // MD5(name+type) for dedup
    // Temporal
    validFrom: integer("valid_from").notNull(), // epoch ms
    validTo: integer("valid_to"), // null = still active
    version: integer("version").notNull().default(1),
    // Decay
    salience: real("salience").notNull().default(1.0),
    decayRate: real("decay_rate").notNull().default(0.005),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    // Embedding stored as BLOB via sqlite-vector
    embedding: blob("embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_entities_user_idx").on(table.userId),
    index("mem_entities_name_idx").on(table.userId, table.name),
    index("mem_entities_hash_idx").on(table.userId, table.hash),
    index("mem_entities_valid_idx").on(table.validTo),
    index("mem_entities_type_idx").on(table.userId, table.entityType),
  ],
);

// ---------------------------------------------------------------------------
// Observation — atomic facts, events, beliefs, preferences, procedures
// ---------------------------------------------------------------------------
export const memoryObservations = sqliteTable(
  "memory_observations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    content: text("content").notNull(),
    observationType: text("observation_type").notNull(), // fact, event, preference, belief, procedure, reflection
    confidence: real("confidence").notNull().default(0.8),
    sourceMessageId: text("source_message_id"),
    entityIds: text("entity_ids").notNull().default("[]"), // JSON string[]
    hash: text("hash").notNull(), // MD5(content) for dedup
    // Temporal
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    version: integer("version").notNull().default(1),
    // Decay
    salience: real("salience").notNull().default(1.0),
    decayRate: real("decay_rate").notNull().default(0.005),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    // Embedding
    embedding: blob("embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_obs_user_idx").on(table.userId),
    index("mem_obs_type_idx").on(table.userId, table.observationType),
    index("mem_obs_hash_idx").on(table.userId, table.hash),
    index("mem_obs_valid_idx").on(table.validTo),
    index("mem_obs_entity_idx").on(table.entityIds),
  ],
);

// ---------------------------------------------------------------------------
// Edge — relationships between entities and/or observations
// ---------------------------------------------------------------------------
export const memoryEdges = sqliteTable(
  "memory_edges",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id").notNull(),
    sourceType: text("source_type").notNull(), // "entity" | "observation"
    targetType: text("target_type").notNull(),
    relationshipType: text("relationship_type").notNull(),
    description: text("description").notNull(),
    weight: real("weight").notNull().default(1.0),
    confidence: real("confidence").notNull().default(0.8),
    tripletText: text("triplet_text").notNull(), // "Alice -> works_at -> Google"
    // Temporal
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    // Triplet embedding
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

// ---------------------------------------------------------------------------
// Block — Letta-style agent-editable scratchpad blocks
// ---------------------------------------------------------------------------
export const memoryBlocks = sqliteTable(
  "memory_blocks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(), // user_profile, active_context, task_state, system_notes
    value: text("value").notNull().default(""),
    limit: integer("limit").notNull().default(2000),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mem_blocks_user_idx").on(table.userId),
    index("mem_blocks_label_idx").on(table.userId, table.label),
  ],
);

// ---------------------------------------------------------------------------
// BlockHistory — undo/redo support for scratchpad blocks
// ---------------------------------------------------------------------------
export const memoryBlockHistory = sqliteTable(
  "memory_block_history",
  {
    id: text("id").primaryKey(),
    blockId: text("block_id")
      .notNull()
      .references(() => memoryBlocks.id, { onDelete: "cascade" }),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    changedBy: text("changed_by").notNull(), // "agent" | "system" | "user"
    changedAt: integer("changed_at").notNull(),
    seq: integer("seq").notNull(), // monotonic within block
  },
  (table) => [
    index("mem_block_hist_block_idx").on(table.blockId),
    index("mem_block_hist_seq_idx").on(table.blockId, table.seq),
  ],
);

// ---------------------------------------------------------------------------
// AuditEntry — logs every mutation to the graph
// ---------------------------------------------------------------------------
export const memoryAuditLog = sqliteTable(
  "memory_audit_log",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull(),
    targetType: text("target_type").notNull(), // entity, observation, edge
    event: text("event").notNull(), // ADD, UPDATE, DELETE, MERGE, DECAY, CONTRADICT
    oldValue: text("old_value"), // JSON
    newValue: text("new_value"), // JSON
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("mem_audit_target_idx").on(table.targetId),
    index("mem_audit_time_idx").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
export type MemoryEntity = typeof memoryEntities.$inferSelect;
export type MemoryObservation = typeof memoryObservations.$inferSelect;
export type MemoryEdge = typeof memoryEdges.$inferSelect;
export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type MemoryBlockHistory = typeof memoryBlockHistory.$inferSelect;
export type MemoryAuditEntry = typeof memoryAuditLog.$inferSelect;
