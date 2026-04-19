import { getMemoryNativeDb } from "@g-spot/db/memory-db";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

import { embed, embedOne, toF32Buffer } from "./embeddings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "concept"
  | "tool"
  | "event"
  | "preference";

export type ObservationType =
  | "fact"
  | "event"
  | "preference"
  | "belief"
  | "procedure"
  | "reflection";

interface ExtractedEntity {
  name: string;
  entityType: EntityType;
  description: string;
  aliases?: string[];
}

interface ExtractedObservation {
  content: string;
  observationType: ObservationType;
  entityNames: string[];
}

interface ExtractedEdge {
  sourceName: string;
  targetName: string;
  relationshipType: string;
  description: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  observations: ExtractedObservation[];
  edges: ExtractedEdge[];
}

export interface ResolveAction {
  index: number;
  action: "ADD" | "UPDATE" | "DELETE" | "NONE";
  existingId?: string;
  reason: string;
}

export interface QueryOptions {
  topK?: number;
  threshold?: number;
  includeGraph?: boolean;
  includeScratchpad?: boolean;
  timeRange?: { from: number; to: number };
  hopDepth?: number;
}

interface ScoredResult {
  id: string;
  type: "observation" | "triplet";
  content: string;
  score: number;
  similarity: number;
  salience: number;
  graphWeight: number;
  recency: number;
  confidence: number;
}

export interface QueryResult {
  observations: ScoredResult[];
  triplets: ScoredResult[];
  graphContext: string;
  scratchpad: string;
  timingMs: number;
}

export interface DecayStats {
  decayed: number;
  pruned: number;
  edgesPruned: number;
  consolidated: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ENTITY_DECAY_RATES: Record<EntityType, number> = {
  person: 0.003,
  organization: 0.003,
  project: 0.01,
  concept: 0.005,
  tool: 0.005,
  event: 0.02,
  preference: 0.002,
};

const OBSERVATION_DECAY_RATES: Record<ObservationType, number> = {
  fact: 0.005,
  event: 0.025,
  preference: 0.002,
  belief: 0.008,
  procedure: 0.006,
  reflection: 0.001,
};

const DEDUP_COSINE_THRESHOLD = 0.85;
const QUERY_ENTITY_MATCH_THRESHOLD = 0.70;

const DEFAULT_BLOCKS = [
  { label: "user_profile", limit: 3000, readOnly: false },
  { label: "active_context", limit: 2000, readOnly: false },
  { label: "task_state", limit: 1500, readOnly: false },
  { label: "system_notes", limit: 1000, readOnly: true },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function now(): number {
  return Date.now();
}

function daysSince(epochMs: number): number {
  return (now() - epochMs) / (1000 * 60 * 60 * 24);
}

function db() {
  return getMemoryNativeDb();
}

// ---------------------------------------------------------------------------
// Scratchpad
// ---------------------------------------------------------------------------

export function ensureDefaultBlocks(): void {
  const existing = db()
    .prepare("SELECT label FROM memory_blocks")
    .all() as { label: string }[];

  const existingLabels = new Set(existing.map((r) => r.label));

  for (const block of DEFAULT_BLOCKS) {
    if (!existingLabels.has(block.label)) {
      const ts = now();
      db()
        .prepare(
          `INSERT INTO memory_blocks (id, label, value, "limit", read_only, version, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, 1, ?, ?)`,
        )
        .run(nanoid(), block.label, block.limit, block.readOnly ? 1 : 0, ts, ts);
    }
  }
}

export function scratchpadRead(label: string): string {
  const row = db()
    .prepare("SELECT value FROM memory_blocks WHERE label = ?")
    .get(label) as { value: string } | undefined;
  return row?.value ?? "";
}

export function scratchpadAppend(
  label: string,
  content: string,
  changedBy: "agent" | "system" | "user" = "agent",
): void {
  const block = db()
    .prepare("SELECT id, value, \"limit\", read_only, version FROM memory_blocks WHERE label = ?")
    .get(label) as { id: string; value: string; limit: number; read_only: number; version: number } | undefined;

  if (!block) throw new Error(`Block "${label}" not found`);
  if (block.read_only && changedBy !== "system") throw new Error(`Block "${label}" is read-only`);

  const newValue = block.value + content;
  if (newValue.length > block.limit) {
    throw new Error(`Block "${label}" would exceed limit (${block.limit} chars)`);
  }

  const ts = now();
  const maxSeq = db()
    .prepare("SELECT COALESCE(MAX(seq), 0) as s FROM memory_block_history WHERE block_id = ?")
    .get(block.id) as { s: number };

  db().prepare("BEGIN").run();
  try {
    db()
      .prepare("UPDATE memory_blocks SET value = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(newValue, ts, block.id);
    db()
      .prepare("INSERT INTO memory_block_history (id, block_id, old_value, new_value, changed_by, changed_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nanoid(), block.id, block.value, newValue, changedBy, ts, maxSeq.s + 1);
    db().prepare("COMMIT").run();
  } catch (err) {
    db().prepare("ROLLBACK").run();
    throw err;
  }
}

export function scratchpadReplace(
  label: string,
  oldText: string,
  newText: string,
  changedBy: "agent" | "system" | "user" = "agent",
): void {
  const block = db()
    .prepare("SELECT id, value, \"limit\", read_only FROM memory_blocks WHERE label = ?")
    .get(label) as { id: string; value: string; limit: number; read_only: number } | undefined;

  if (!block) throw new Error(`Block "${label}" not found`);
  if (block.read_only && changedBy !== "system") throw new Error(`Block "${label}" is read-only`);
  if (!block.value.includes(oldText)) throw new Error(`Text not found in block "${label}"`);

  const newValue = block.value.replace(oldText, newText);
  if (newValue.length > block.limit) {
    throw new Error(`Block "${label}" would exceed limit (${block.limit} chars)`);
  }

  const ts = now();
  const maxSeq = db()
    .prepare("SELECT COALESCE(MAX(seq), 0) as s FROM memory_block_history WHERE block_id = ?")
    .get(block.id) as { s: number };

  db().prepare("BEGIN").run();
  try {
    db()
      .prepare("UPDATE memory_blocks SET value = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(newValue, ts, block.id);
    db()
      .prepare("INSERT INTO memory_block_history (id, block_id, old_value, new_value, changed_by, changed_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nanoid(), block.id, block.value, newValue, changedBy, ts, maxSeq.s + 1);
    db().prepare("COMMIT").run();
  } catch (err) {
    db().prepare("ROLLBACK").run();
    throw err;
  }
}

export function scratchpadRewrite(
  label: string,
  newValue: string,
  changedBy: "agent" | "system" | "user" = "agent",
): void {
  const block = db()
    .prepare("SELECT id, value, \"limit\", read_only FROM memory_blocks WHERE label = ?")
    .get(label) as { id: string; value: string; limit: number; read_only: number } | undefined;

  if (!block) throw new Error(`Block "${label}" not found`);
  if (block.read_only && changedBy !== "system") throw new Error(`Block "${label}" is read-only`);
  if (newValue.length > block.limit) {
    throw new Error(`Block "${label}" would exceed limit (${block.limit} chars)`);
  }

  const ts = now();
  const maxSeq = db()
    .prepare("SELECT COALESCE(MAX(seq), 0) as s FROM memory_block_history WHERE block_id = ?")
    .get(block.id) as { s: number };

  db().prepare("BEGIN").run();
  try {
    db()
      .prepare("UPDATE memory_blocks SET value = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(newValue, ts, block.id);
    db()
      .prepare("INSERT INTO memory_block_history (id, block_id, old_value, new_value, changed_by, changed_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nanoid(), block.id, block.value, newValue, changedBy, ts, maxSeq.s + 1);
    db().prepare("COMMIT").run();
  } catch (err) {
    db().prepare("ROLLBACK").run();
    throw err;
  }
}

export function scratchpadUndo(label: string, steps = 1): void {
  const block = db()
    .prepare("SELECT id, value FROM memory_blocks WHERE label = ?")
    .get(label) as { id: string; value: string } | undefined;

  if (!block) throw new Error(`Block "${label}" not found`);

  const history = db()
    .prepare(
      "SELECT old_value, seq FROM memory_block_history WHERE block_id = ? ORDER BY seq DESC LIMIT ?",
    )
    .all(block.id, steps) as { old_value: string; seq: number }[];

  if (history.length === 0) throw new Error(`No history to undo for block "${label}"`);

  const target = history[history.length - 1]!;
  const ts = now();

  db()
    .prepare("UPDATE memory_blocks SET value = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .run(target.old_value, ts, block.id);
}

// ---------------------------------------------------------------------------
// Vector search helpers (raw SQL via sqlite-vector)
// ---------------------------------------------------------------------------

function vectorSearchEntities(
  queryVec: Buffer,
  topK: number,
): { id: string; distance: number }[] {
  const k = (topK * 3) | 0;
  const results = db()
    .prepare(
      `SELECT e.id, v.distance
       FROM memory_entities AS e
       JOIN vector_full_scan('memory_entities', 'embedding', ?, CAST(? AS INTEGER)) AS v ON e.rowid = v.rowid
       WHERE e.valid_to IS NULL AND e.embedding IS NOT NULL`,
    )
    .all(queryVec, k) as { id: string; distance: number }[];
  return results;
}

function vectorSearchObservations(
  queryVec: Buffer,
  topK: number,
  timeRange?: { from: number; to: number },
): { id: string; distance: number; content: string; salience: number; confidence: number; observation_type: string; created_at: number }[] {
  const k = (topK * 3) | 0;
  let sql = `
    SELECT e.id, v.distance, e.content, e.salience, e.confidence, e.observation_type, e.created_at
    FROM memory_observations AS e
    JOIN vector_full_scan('memory_observations', 'embedding', ?, CAST(? AS INTEGER)) AS v ON e.rowid = v.rowid
    WHERE e.valid_to IS NULL AND e.embedding IS NOT NULL
      AND e.salience >= 0.05`;
  const params: any[] = [queryVec, k];

  if (timeRange) {
    sql += " AND e.valid_from <= ? AND (e.valid_to IS NULL OR e.valid_to >= ?)";
    params.push(timeRange.to, timeRange.from);
  }

  return db().prepare(sql).all(...params) as any[];
}

function vectorSearchTriplets(
  queryVec: Buffer,
  topK: number,
): { id: string; distance: number; triplet_text: string; weight: number; confidence: number; created_at: number }[] {
  const k = (topK * 3) | 0;
  return db()
    .prepare(
      `SELECT e.id, v.distance, e.triplet_text, e.weight, e.confidence, e.created_at
       FROM memory_edges AS e
       JOIN vector_full_scan('memory_edges', 'triplet_embedding', ?, CAST(? AS INTEGER)) AS v ON e.rowid = v.rowid
       WHERE e.valid_to IS NULL AND e.triplet_embedding IS NOT NULL`,
    )
    .all(queryVec, k) as any[];
}

// ---------------------------------------------------------------------------
// Graph traversal (BFS)
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  weight: number;
}

function bfsTraverse(
  startIds: string[],
  maxDepth: number,
): Map<string, number> {
  const visited = new Map<string, number>();
  let frontier = startIds.map((id) => ({ id, weight: 1.0 }));

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: GraphNode[] = [];

    for (const node of frontier) {
      if (visited.has(node.id) && visited.get(node.id)! >= node.weight) continue;
      visited.set(node.id, node.weight);

      const edges = db()
        .prepare(
          `SELECT target_id, weight FROM memory_edges
           WHERE source_id = ? AND valid_to IS NULL AND weight >= 0.1
           UNION
           SELECT source_id, weight FROM memory_edges
           WHERE target_id = ? AND valid_to IS NULL AND weight >= 0.1`,
        )
        .all(node.id, node.id) as { target_id: string; weight: number }[];

      for (const edge of edges) {
        const hopWeight = node.weight * 0.8 * edge.weight;
        if (hopWeight >= 0.1) {
          nextFrontier.push({ id: edge.target_id, weight: hopWeight });
        }
      }
    }

    frontier = nextFrontier;
  }

  return visited;
}

// ---------------------------------------------------------------------------
// Ingest — the write path
// ---------------------------------------------------------------------------

export async function ingest(
  extraction: ExtractionResult,
  resolutions: ResolveAction[],
  sourceMessageId?: string,
): Promise<{ entityIds: string[]; observationIds: string[]; edgeIds: string[] }> {
  const ts = now();
  const entityIds: string[] = [];
  const observationIds: string[] = [];
  const edgeIds: string[] = [];
  const entityNameToId = new Map<string, string>();

  const entityTexts = extraction.entities.map((e) => `${e.name} ${e.description}`);
  const entityEmbeddings = entityTexts.length > 0 ? await embed(entityTexts) : [];

  for (let i = 0; i < extraction.entities.length; i++) {
    const ent = extraction.entities[i]!;
    const entHash = md5(`${ent.name.toLowerCase()}:${ent.entityType}`);
    const entVec = entityEmbeddings[i]!;
    const entBuf = toF32Buffer(entVec);

    const existing = db()
      .prepare(
        "SELECT id, description, aliases, version FROM memory_entities WHERE hash = ? AND valid_to IS NULL",
      )
      .get(entHash) as { id: string; description: string; aliases: string; version: number } | undefined;

    if (existing) {
      const vecMatches = vectorSearchEntities(entBuf, 5);
      const isSimilar = vecMatches.some(
        (m) => m.id === existing.id && (1 - m.distance) >= DEDUP_COSINE_THRESHOLD,
      );

      if (isSimilar || existing) {
        const oldAliases: string[] = JSON.parse(existing.aliases);
        const newAliases = Array.from(
          new Set([...oldAliases, ...(ent.aliases ?? [])]),
        );
        const mergedDesc =
          ent.description.length > existing.description.length
            ? ent.description
            : existing.description;

        db()
          .prepare(
            `UPDATE memory_entities
             SET description = ?, aliases = ?, embedding = ?, version = version + 1,
                 salience = MIN(1.0, salience + 0.1), last_accessed_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(mergedDesc, JSON.stringify(newAliases), entBuf, ts, ts, existing.id);

        entityNameToId.set(ent.name.toLowerCase(), existing.id);
        entityIds.push(existing.id);

        audit(existing.id, "entity", "MERGE", existing.description, mergedDesc, "Entity merged during ingest");
        continue;
      }
    }

    const id = nanoid();
    const decayRate = ENTITY_DECAY_RATES[ent.entityType] ?? 0.005;

    db()
      .prepare(
        `INSERT INTO memory_entities
         (id, name, entity_type, description, aliases, hash, valid_from, version,
          salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, ent.name.toLowerCase(), ent.entityType, ent.description,
        JSON.stringify(ent.aliases ?? []), entHash, ts, decayRate, ts, entBuf, ts, ts,
      );

    entityNameToId.set(ent.name.toLowerCase(), id);
    entityIds.push(id);

    audit(id, "entity", "ADD", null, ent.description, "New entity extracted");
  }

  const obsToEmbed: { index: number; content: string }[] = [];
  for (let i = 0; i < extraction.observations.length; i++) {
    const resolution = resolutions.find((r) => r.index === i);
    if (!resolution || resolution.action === "NONE") continue;
    if (resolution.action === "ADD" || resolution.action === "UPDATE") {
      obsToEmbed.push({ index: i, content: extraction.observations[i]!.content });
    }
  }

  const obsEmbeddings =
    obsToEmbed.length > 0 ? await embed(obsToEmbed.map((o) => o.content)) : [];
  const obsEmbeddingMap = new Map<number, number[]>();
  for (let i = 0; i < obsToEmbed.length; i++) {
    obsEmbeddingMap.set(obsToEmbed[i]!.index, obsEmbeddings[i]!);
  }

  for (let i = 0; i < extraction.observations.length; i++) {
    const obs = extraction.observations[i]!;
    const resolution = resolutions.find((r) => r.index === i);
    if (!resolution || resolution.action === "NONE") continue;

    const entityIdsForObs = obs.entityNames
      .map((name) => entityNameToId.get(name.toLowerCase()))
      .filter(Boolean) as string[];

    if (resolution.action === "DELETE" && resolution.existingId) {
      db()
        .prepare("UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, resolution.existingId);
      audit(resolution.existingId, "observation", "DELETE", null, null, resolution.reason);
      continue;
    }

    if (resolution.action === "UPDATE" && resolution.existingId) {
      db()
        .prepare("UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, resolution.existingId);
      audit(resolution.existingId, "observation", "UPDATE", null, null, resolution.reason);
    }

    const obsVec = obsEmbeddingMap.get(i);
    if (!obsVec) continue;

    const id = nanoid();
    const obsHash = md5(obs.content);
    const decayRate = OBSERVATION_DECAY_RATES[obs.observationType] ?? 0.005;

    db()
      .prepare(
        `INSERT INTO memory_observations
         (id, content, observation_type, confidence, source_message_id, entity_ids, hash,
          valid_from, version, salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
         VALUES (?, ?, ?, 0.8, ?, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, obs.content, obs.observationType, sourceMessageId ?? null,
        JSON.stringify(entityIdsForObs), obsHash, ts, decayRate, ts, toF32Buffer(obsVec), ts, ts,
      );

    observationIds.push(id);
    audit(id, "observation", resolution.action, null, obs.content, resolution.reason);
  }

  const edgeTexts = extraction.edges.map(
    (e) => `${e.sourceName} -> ${e.relationshipType} -> ${e.targetName}`,
  );
  const edgeEmbeddings = edgeTexts.length > 0 ? await embed(edgeTexts) : [];

  for (let i = 0; i < extraction.edges.length; i++) {
    const edge = extraction.edges[i]!;
    const sourceId = entityNameToId.get(edge.sourceName.toLowerCase());
    const targetId = entityNameToId.get(edge.targetName.toLowerCase());
    if (!sourceId || !targetId) continue;

    const tripletText = edgeTexts[i]!;
    const tripletVec = edgeEmbeddings[i]!;

    const existing = db()
      .prepare(
        `SELECT id, weight FROM memory_edges
         WHERE source_id = ? AND target_id = ? AND relationship_type = ? AND valid_to IS NULL`,
      )
      .get(sourceId, targetId, edge.relationshipType) as { id: string; weight: number } | undefined;

    if (existing) {
      db()
        .prepare(
          "UPDATE memory_edges SET weight = MIN(1.0, weight + 0.1), triplet_embedding = ?, updated_at = ? WHERE id = ?",
        )
        .run(toF32Buffer(tripletVec), ts, existing.id);
      edgeIds.push(existing.id);
      continue;
    }

    const id = nanoid();
    db()
      .prepare(
        `INSERT INTO memory_edges
         (id, source_id, target_id, source_type, target_type, relationship_type, description,
          weight, confidence, triplet_text, valid_from, triplet_embedding, created_at, updated_at)
         VALUES (?, ?, ?, 'entity', 'entity', ?, ?, 1.0, 0.8, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, sourceId, targetId, edge.relationshipType, edge.description,
        tripletText, ts, toF32Buffer(tripletVec), ts, ts,
      );

    edgeIds.push(id);
    audit(id, "edge", "ADD", null, tripletText, "New edge extracted");
  }

  return { entityIds, observationIds, edgeIds };
}

// ---------------------------------------------------------------------------
// Query — the read path
// ---------------------------------------------------------------------------

export async function query(
  q: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const start = performance.now();
  const {
    topK = 10,
    threshold = 0.5,
    includeGraph = true,
    includeScratchpad = true,
    timeRange,
    hopDepth = 2,
  } = options;

  const queryVec = await embedOne(q, "query");
  const queryBuf = toF32Buffer(queryVec);

  const obsResults = vectorSearchObservations(queryBuf, topK, timeRange);
  const tripResults = vectorSearchTriplets(queryBuf, topK);

  let graphWeights = new Map<string, number>();
  if (includeGraph) {
    const entityMatches = vectorSearchEntities(queryBuf, 5);
    const seedIds = entityMatches
      .filter((m) => (1 - m.distance) >= QUERY_ENTITY_MATCH_THRESHOLD)
      .map((m) => m.id);

    if (seedIds.length > 0) {
      graphWeights = bfsTraverse(seedIds, hopDepth);
    }
  }

  const scoredObs: ScoredResult[] = obsResults
    .filter((r) => (1 - r.distance) >= threshold)
    .map((r) => {
      const similarity = 1 - r.distance;
      const recency = Math.exp(-daysSince(r.created_at) / 30);
      const gw = graphWeights.get(r.id) ?? 0;

      return {
        id: r.id,
        type: "observation" as const,
        content: r.content,
        similarity,
        salience: r.salience,
        graphWeight: gw,
        recency,
        confidence: r.confidence,
        score:
          0.35 * similarity +
          0.25 * r.salience +
          0.20 * gw +
          0.10 * recency +
          0.10 * r.confidence,
      };
    });

  const scoredTrips: ScoredResult[] = tripResults
    .filter((r) => (1 - r.distance) >= threshold)
    .map((r) => {
      const similarity = 1 - r.distance;
      const recency = Math.exp(-daysSince(r.created_at) / 30);

      return {
        id: r.id,
        type: "triplet" as const,
        content: r.triplet_text,
        similarity,
        salience: r.weight,
        graphWeight: 0,
        recency,
        confidence: r.confidence,
        score:
          0.35 * similarity +
          0.25 * r.weight +
          0.20 * 0 +
          0.10 * recency +
          0.10 * r.confidence,
      };
    });

  const seen = new Set<string>();
  const deduped = [...scoredObs, ...scoredTrips]
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      if (seen.has(r.content)) return false;
      seen.add(r.content);
      return true;
    });

  const topObs = deduped.filter((r) => r.type === "observation").slice(0, topK);
  const topTrips = deduped.filter((r) => r.type === "triplet").slice(0, topK);

  const retrievedIds = [...topObs, ...topTrips].map((r) => r.id);
  const ts = now();
  for (const id of retrievedIds) {
    db()
      .prepare(
        "UPDATE memory_observations SET salience = MIN(1.0, salience + 0.1), last_accessed_at = ? WHERE id = ?",
      )
      .run(ts, id);
    db()
      .prepare(
        "UPDATE memory_entities SET salience = MIN(1.0, salience + 0.1), last_accessed_at = ? WHERE id = ?",
      )
      .run(ts, id);
  }
  for (const [nodeId] of graphWeights) {
    db()
      .prepare(
        "UPDATE memory_edges SET weight = MIN(1.0, weight + 0.05), updated_at = ? WHERE (source_id = ? OR target_id = ?) AND valid_to IS NULL",
      )
      .run(ts, nodeId, nodeId);
  }

  let graphContext = "";
  if (includeGraph && graphWeights.size > 0) {
    const entityIds = Array.from(graphWeights.keys()).slice(0, 20);
    const placeholders = entityIds.map(() => "?").join(",");
    const entities = db()
      .prepare(
        `SELECT name, entity_type, description FROM memory_entities WHERE id IN (${placeholders}) AND valid_to IS NULL`,
      )
      .all(...entityIds) as { name: string; entity_type: string; description: string }[];

    graphContext = entities
      .map((e) => `[${e.entity_type}] ${e.name}: ${e.description}`)
      .join("\n");
  }

  let scratchpad = "";
  if (includeScratchpad) {
    ensureDefaultBlocks();
    const blocks = db()
      .prepare("SELECT label, value FROM memory_blocks ORDER BY label")
      .all() as { label: string; value: string }[];

    scratchpad = blocks
      .filter((b) => b.value.length > 0)
      .map((b) => `<${b.label}>\n${b.value}\n</${b.label}>`)
      .join("\n\n");
  }

  return {
    observations: topObs,
    triplets: topTrips,
    graphContext,
    scratchpad,
    timingMs: performance.now() - start,
  };
}

// ---------------------------------------------------------------------------
// compile_context — builds memory section for system prompt
// ---------------------------------------------------------------------------

export async function compileContext(
  queryText: string,
  opts: {
    maxTokens?: number;
    includeProfile?: boolean;
    includeActive?: boolean;
    queryResultsK?: number;
  } = {},
): Promise<string> {
  const {
    maxTokens = 4000,
    includeProfile = true,
    includeActive = true,
    queryResultsK = 10,
  } = opts;

  ensureDefaultBlocks();

  const parts: string[] = [];

  if (includeProfile) {
    const profile = scratchpadRead("user_profile");
    if (profile) parts.push(`<user_profile>\n${profile}\n</user_profile>`);
  }

  if (includeActive) {
    const active = scratchpadRead("active_context");
    if (active) parts.push(`<active_context>\n${active}\n</active_context>`);

    const taskState = scratchpadRead("task_state");
    if (taskState) parts.push(`<task_state>\n${taskState}\n</task_state>`);
  }

  const results = await query(queryText, {
    topK: queryResultsK,
    includeGraph: true,
    includeScratchpad: false,
  });

  if (results.observations.length > 0) {
    const lines = results.observations.map((obs) => {
      const ageStr = formatAge(obs);
      return `- [${obs.type}] ${obs.content} (${ageStr}, confidence: ${obs.confidence.toFixed(2)})`;
    });
    parts.push(`<relevant_memories>\n${lines.join("\n")}\n</relevant_memories>`);
  }

  if (results.triplets.length > 0) {
    const lines = results.triplets.map(
      (t) => `- ${t.content} (weight: ${t.salience.toFixed(2)})`,
    );
    parts.push(`<relationships>\n${lines.join("\n")}\n</relationships>`);
  }

  if (results.graphContext) {
    parts.push(`<graph_context>\n${results.graphContext}\n</graph_context>`);
  }

  let combined = parts.join("\n\n");
  const charBudget = maxTokens * 4;
  if (combined.length > charBudget) {
    combined = combined.slice(0, charBudget) + "\n... (truncated)";
  }

  return combined;
}

function formatAge(result: ScoredResult): string {
  if (result.recency > 0.9) return "recent";
  if (result.recency > 0.5) return "days ago";
  if (result.recency > 0.1) return "weeks ago";
  return "months ago";
}

// ---------------------------------------------------------------------------
// Temporal query
// ---------------------------------------------------------------------------

export async function temporalQuery(
  q: string,
  timeRange: { from: number; to: number },
): Promise<QueryResult> {
  return query(q, { timeRange, includeGraph: true, includeScratchpad: true });
}

// ---------------------------------------------------------------------------
// Contradiction resolution
// ---------------------------------------------------------------------------

export async function resolveContradiction(
  entityId: string,
  newFact: string,
  decisions: { existingId: string; action: "KEEP" | "SUPERSEDE" | "MERGE"; mergedText?: string }[],
): Promise<string[]> {
  const ts = now();
  const newIds: string[] = [];

  for (const decision of decisions) {
    if (decision.action === "KEEP") continue;

    if (decision.action === "SUPERSEDE") {
      db()
        .prepare("UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, decision.existingId);
      audit(decision.existingId, "observation", "CONTRADICT", null, null, `Superseded by: ${newFact}`);

      const id = nanoid();
      const vec = await embedOne(newFact);
      db()
        .prepare(
          `INSERT INTO memory_observations
           (id, content, observation_type, confidence, entity_ids, hash,
            valid_from, version, salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
           VALUES (?, ?, 'fact', 0.9, ?, ?, ?, 1, 1.0, 0.005, ?, ?, ?, ?)`,
        )
        .run(id, newFact, JSON.stringify([entityId]), md5(newFact), ts, ts, toF32Buffer(vec), ts, ts);
      newIds.push(id);
      audit(id, "observation", "ADD", null, newFact, "Created from contradiction resolution");
    }

    if (decision.action === "MERGE" && decision.mergedText) {
      const vec = await embedOne(decision.mergedText);
      db()
        .prepare(
          `UPDATE memory_observations
           SET content = ?, embedding = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(decision.mergedText, toF32Buffer(vec), ts, decision.existingId);
      newIds.push(decision.existingId);
      audit(decision.existingId, "observation", "CONTRADICT", null, decision.mergedText, "Merged during contradiction resolution");
    }
  }

  return newIds;
}

// ---------------------------------------------------------------------------
// Decay tick — background maintenance
// ---------------------------------------------------------------------------

export async function decayTick(): Promise<DecayStats> {
  const ts = now();
  let decayed = 0;
  let pruned = 0;
  let edgesPruned = 0;
  const consolidated = 0;

  const entities = db()
    .prepare(
      "SELECT id, salience, decay_rate, last_accessed_at FROM memory_entities WHERE valid_to IS NULL",
    )
    .all() as { id: string; salience: number; decay_rate: number; last_accessed_at: number }[];

  for (const ent of entities) {
    const days = daysSince(ent.last_accessed_at);
    const newSalience =
      ent.salience * Math.exp(-ent.decay_rate * days) +
      0.08 * (1 - Math.exp(-ent.decay_rate * days));

    if (Math.abs(newSalience - ent.salience) > 0.001) {
      db()
        .prepare("UPDATE memory_entities SET salience = ?, updated_at = ? WHERE id = ?")
        .run(newSalience, ts, ent.id);
      decayed++;
    }

    if (newSalience < 0.03 && days > 30) {
      db()
        .prepare("UPDATE memory_entities SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, ent.id);
      pruned++;
      audit(ent.id, "entity", "DECAY", null, null, `Pruned: salience=${newSalience.toFixed(4)}, age=${days.toFixed(0)}d`);
    }
  }

  const observations = db()
    .prepare(
      "SELECT id, salience, decay_rate, last_accessed_at, confidence, updated_at FROM memory_observations WHERE valid_to IS NULL",
    )
    .all() as { id: string; salience: number; decay_rate: number; last_accessed_at: number; confidence: number; updated_at: number }[];

  for (const obs of observations) {
    const days = daysSince(obs.last_accessed_at);
    const daysSinceUpdate = daysSince(obs.updated_at);
    const newSalience =
      obs.salience * Math.exp(-obs.decay_rate * days) +
      0.08 * (1 - Math.exp(-obs.decay_rate * days));

    const newConfidence = Math.max(0.1, obs.confidence - 0.001 * daysSinceUpdate);

    if (
      Math.abs(newSalience - obs.salience) > 0.001 ||
      Math.abs(newConfidence - obs.confidence) > 0.001
    ) {
      db()
        .prepare("UPDATE memory_observations SET salience = ?, confidence = ?, updated_at = ? WHERE id = ?")
        .run(newSalience, newConfidence, ts, obs.id);
      decayed++;
    }

    if (newSalience < 0.03 && days > 30) {
      db()
        .prepare("UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, obs.id);
      pruned++;
      audit(obs.id, "observation", "DECAY", null, null, `Pruned: salience=${newSalience.toFixed(4)}, age=${days.toFixed(0)}d`);
    }
  }

  const edges = db()
    .prepare("SELECT id, weight FROM memory_edges WHERE valid_to IS NULL")
    .all() as { id: string; weight: number }[];

  for (const edge of edges) {
    if (edge.weight < 0.05) {
      db()
        .prepare("UPDATE memory_edges SET valid_to = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, edge.id);
      edgesPruned++;
    } else {
      db()
        .prepare("UPDATE memory_edges SET weight = weight * 0.995, updated_at = ? WHERE id = ?")
        .run(ts, edge.id);
    }
  }

  return { decayed, pruned, edgesPruned, consolidated };
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

function audit(
  targetId: string,
  targetType: string,
  event: string,
  oldValue: string | null,
  newValue: string | null,
  reason: string,
): void {
  db()
    .prepare(
      "INSERT INTO memory_audit_log (id, target_id, target_type, event, old_value, new_value, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(nanoid(), targetId, targetType, event, oldValue, newValue, reason, now());
}

// ---------------------------------------------------------------------------
// Stats / debug
// ---------------------------------------------------------------------------

export function getGraphData() {
  const entities = db()
    .prepare(
      `SELECT id, name, entity_type, description, aliases, salience, decay_rate,
              created_at, updated_at, last_accessed_at
       FROM memory_entities WHERE valid_to IS NULL`,
    )
    .all() as {
    id: string;
    name: string;
    entity_type: string;
    description: string;
    aliases: string;
    salience: number;
    decay_rate: number;
    created_at: number;
    updated_at: number;
    last_accessed_at: number;
  }[];

  const observations = db()
    .prepare(
      `SELECT id, content, observation_type, confidence, salience, entity_ids,
              created_at, updated_at, last_accessed_at
       FROM memory_observations WHERE valid_to IS NULL`,
    )
    .all() as {
    id: string;
    content: string;
    observation_type: string;
    confidence: number;
    salience: number;
    entity_ids: string;
    created_at: number;
    updated_at: number;
    last_accessed_at: number;
  }[];

  const edges = db()
    .prepare(
      `SELECT id, source_id, target_id, source_type, target_type,
              relationship_type, description, weight, confidence, triplet_text,
              created_at
       FROM memory_edges WHERE valid_to IS NULL`,
    )
    .all() as {
    id: string;
    source_id: string;
    target_id: string;
    source_type: string;
    target_type: string;
    relationship_type: string;
    description: string;
    weight: number;
    confidence: number;
    triplet_text: string;
    created_at: number;
  }[];

  return {
    entities: entities.map((e) => ({
      ...e,
      aliases: JSON.parse(e.aliases) as string[],
    })),
    observations: observations.map((o) => ({
      ...o,
      entityIds: JSON.parse(o.entity_ids) as string[],
    })),
    edges,
  };
}

export function getMemoryStats() {
  const entities = db()
    .prepare("SELECT COUNT(*) as c FROM memory_entities WHERE valid_to IS NULL")
    .get() as { c: number };
  const observations = db()
    .prepare("SELECT COUNT(*) as c FROM memory_observations WHERE valid_to IS NULL")
    .get() as { c: number };
  const edges = db()
    .prepare("SELECT COUNT(*) as c FROM memory_edges WHERE valid_to IS NULL")
    .get() as { c: number };
  const blocks = db()
    .prepare("SELECT label, LENGTH(value) as len FROM memory_blocks")
    .all() as { label: string; len: number }[];

  return {
    activeEntities: entities.c,
    activeObservations: observations.c,
    activeEdges: edges.c,
    blocks: blocks.map((b) => ({ label: b.label, chars: b.len })),
  };
}
