import Database from "libsql";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";

import * as schema from "./schema";

const MEMORY_DB_PATH = process.env.MEMORY_DB_PATH ?? "memory.db";
const VECTOR_EXTENSION_PATH =
  process.env.VECTOR_EXTENSION_PATH ??
  path.resolve(import.meta.dirname, "../../../extensions/vector");

const EMBEDDING_DIM = 768;

let _nativeDb: InstanceType<typeof Database> | null = null;
let _memoryDb: ReturnType<typeof drizzle> | null = null;

function getNativeDb() {
  if (!_nativeDb) {
    _nativeDb = new Database(MEMORY_DB_PATH);
    _nativeDb.pragma("journal_mode = WAL");
    _nativeDb.pragma("foreign_keys = ON");

    // Load sqlite-vector extension
    _nativeDb.loadExtension(VECTOR_EXTENSION_PATH);

    // Create tables if they don't exist
    _nativeDb.exec(`
      CREATE TABLE IF NOT EXISTS memory_entities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        description TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        hash TEXT NOT NULL,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        salience REAL NOT NULL DEFAULT 1.0,
        decay_rate REAL NOT NULL DEFAULT 0.005,
        last_accessed_at INTEGER NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_entities_user_idx ON memory_entities(user_id);
      CREATE INDEX IF NOT EXISTS mem_entities_name_idx ON memory_entities(user_id, name);
      CREATE INDEX IF NOT EXISTS mem_entities_hash_idx ON memory_entities(user_id, hash);
      CREATE INDEX IF NOT EXISTS mem_entities_valid_idx ON memory_entities(valid_to);
      CREATE INDEX IF NOT EXISTS mem_entities_type_idx ON memory_entities(user_id, entity_type);

      CREATE TABLE IF NOT EXISTS memory_observations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        source_message_id TEXT,
        entity_ids TEXT NOT NULL DEFAULT '[]',
        hash TEXT NOT NULL,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        salience REAL NOT NULL DEFAULT 1.0,
        decay_rate REAL NOT NULL DEFAULT 0.005,
        last_accessed_at INTEGER NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_obs_user_idx ON memory_observations(user_id);
      CREATE INDEX IF NOT EXISTS mem_obs_type_idx ON memory_observations(user_id, observation_type);
      CREATE INDEX IF NOT EXISTS mem_obs_hash_idx ON memory_observations(user_id, hash);
      CREATE INDEX IF NOT EXISTS mem_obs_valid_idx ON memory_observations(valid_to);

      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        description TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 0.8,
        triplet_text TEXT NOT NULL,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        triplet_embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_edges_source_idx ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS mem_edges_target_idx ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS mem_edges_valid_idx ON memory_edges(valid_to);
      CREATE INDEX IF NOT EXISTS mem_edges_rel_idx ON memory_edges(relationship_type);

      CREATE TABLE IF NOT EXISTS memory_blocks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        "limit" INTEGER NOT NULL DEFAULT 2000,
        read_only INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_blocks_user_idx ON memory_blocks(user_id);
      CREATE INDEX IF NOT EXISTS mem_blocks_label_idx ON memory_blocks(user_id, label);

      CREATE TABLE IF NOT EXISTS memory_block_history (
        id TEXT PRIMARY KEY,
        block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
        old_value TEXT NOT NULL,
        new_value TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        seq INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_block_hist_block_idx ON memory_block_history(block_id);
      CREATE INDEX IF NOT EXISTS mem_block_hist_seq_idx ON memory_block_history(block_id, seq);

      CREATE TABLE IF NOT EXISTS memory_audit_log (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        event TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS mem_audit_target_idx ON memory_audit_log(target_id);
      CREATE INDEX IF NOT EXISTS mem_audit_time_idx ON memory_audit_log(created_at);
    `);

    // Initialize vector columns
    _nativeDb.exec(
      `SELECT vector_init('memory_entities', 'embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
    );
    _nativeDb.exec(
      `SELECT vector_init('memory_observations', 'embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
    );
    _nativeDb.exec(
      `SELECT vector_init('memory_edges', 'triplet_embedding', 'dimension=${EMBEDDING_DIM},type=FLOAT32,distance=COSINE')`,
    );
  }
  return _nativeDb;
}

/**
 * Get the raw libsql Database handle for vector operations.
 * This is needed because Drizzle doesn't expose sqlite-vector functions.
 */
export function getMemoryNativeDb() {
  return getNativeDb();
}

/**
 * Get a Drizzle ORM instance backed by the memory DB.
 * Used for typed CRUD operations on the memory tables.
 */
export function getMemoryDb() {
  if (!_memoryDb) {
    const nativeDb = getNativeDb();
    // drizzle-orm/libsql works with the native Database instance
    _memoryDb = drizzle(nativeDb as any, { schema });
  }
  return _memoryDb;
}

/**
 * Close the memory database connection.
 */
export function closeMemoryDb() {
  if (_nativeDb) {
    _nativeDb.close();
    _nativeDb = null;
    _memoryDb = null;
  }
}
