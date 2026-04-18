/**
 * Pi agent tools for autonomous memory graph operations.
 *
 * These tools are created per-session via `createMemoryTools(userId)` so the
 * userId is captured in a closure. They reuse existing logic from memory.ts
 * and embeddings.ts rather than reimplementing it.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getMemoryNativeDb } from "@g-spot/db/memory-db";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

import { embedOne, toF32Buffer } from "./embeddings";
import {
  query,
  ensureDefaultBlocks,
  scratchpadRead,
  scratchpadRewrite,
  type EntityType,
  type ObservationType,
} from "./memory";

// ---------------------------------------------------------------------------
// Helpers (shared across tools in this module)
// ---------------------------------------------------------------------------

function db() {
  return getMemoryNativeDb();
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function now(): number {
  return Date.now();
}

const DEDUP_COSINE_THRESHOLD = 0.85;

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

// ---------------------------------------------------------------------------
// Audit helper (matches memory.ts logic)
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
// Vector search helpers (mirrors memory.ts)
// ---------------------------------------------------------------------------

function vectorSearchEntities(
  queryVec: Buffer,
  topK: number,
): { id: string; distance: number }[] {
  const k = (topK * 3) | 0;
  return db()
    .prepare(
      `SELECT e.id, v.distance
       FROM memory_entities AS e
       JOIN vector_full_scan('memory_entities', 'embedding', ?, CAST(? AS INTEGER)) AS v ON e.rowid = v.rowid
       WHERE e.e.valid_to IS NULL AND e.embedding IS NOT NULL`,
    )
    .all(queryVec, k) as { id: string; distance: number }[];
}

function vectorSearchObservations(
  queryVec: Buffer,
  topK: number,
): { id: string; distance: number; content: string }[] {
  const k = (topK * 3) | 0;
  return db()
    .prepare(
      `SELECT e.id, v.distance, e.content
       FROM memory_observations AS e
       JOIN vector_full_scan('memory_observations', 'embedding', ?, CAST(? AS INTEGER)) AS v ON e.rowid = v.rowid
       WHERE e.e.valid_to IS NULL AND e.embedding IS NOT NULL
         AND e.salience >= 0.05`,
    )
    .all(queryVec, k) as { id: string; distance: number; content: string }[];
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createMemoryTools(): ToolDefinition[] {
  // ------------------------------------------------------------------
  // 1. memory_search — vector + graph search
  // ------------------------------------------------------------------
  const memorySearch = defineTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search memory for observations, relationships, and graph context relevant to a query. Uses vector similarity and graph traversal.",
    promptSnippet: "memory_search: Search existing memory (vector + graph).",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      topK: Type.Optional(
        Type.Number({ description: "Max results to return (default 10)" }),
      ),
      threshold: Type.Optional(
        Type.Number({
          description: "Minimum similarity threshold 0-1 (default 0.5)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = await query(params.query, {

        topK: params.topK ?? 10,
        threshold: params.threshold ?? 0.5,
        includeGraph: true,
        includeScratchpad: false,
      });

      const lines: string[] = [];

      if (result.observations.length > 0) {
        lines.push("## Observations");
        for (const obs of result.observations) {
          lines.push(
            `- [${obs.id}] ${obs.content} (similarity: ${obs.similarity.toFixed(2)}, confidence: ${obs.confidence.toFixed(2)})`,
          );
        }
      }

      if (result.triplets.length > 0) {
        lines.push("\n## Relationships");
        for (const trip of result.triplets) {
          lines.push(
            `- [${trip.id}] ${trip.content} (similarity: ${trip.similarity.toFixed(2)}, weight: ${trip.salience.toFixed(2)})`,
          );
        }
      }

      if (result.graphContext) {
        lines.push(`\n## Graph Context\n${result.graphContext}`);
      }

      const text =
        lines.length > 0
          ? lines.join("\n")
          : "No results found for this query.";

      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  // ------------------------------------------------------------------
  // 2. memory_get_entity — lookup entity by name
  // ------------------------------------------------------------------
  const memoryGetEntity = defineTool({
    name: "memory_get_entity",
    label: "Get Entity",
    description:
      "Look up a memory entity by name (fuzzy match). Returns entity details including type, description, and aliases.",
    promptSnippet: "memory_get_entity: Look up an entity by name.",
    parameters: Type.Object({
      name: Type.String({ description: "Entity name to search for" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const rows = db()
        .prepare(
          `SELECT id, name, entity_type, description, aliases, salience, created_at
           FROM memory_entities
           WHERE valid_to IS NULL AND name LIKE ?
           ORDER BY salience DESC
           LIMIT 10`,
        )
        .all(`%${params.name.toLowerCase()}%`) as {
        id: string;
        name: string;
        entity_type: string;
        description: string;
        aliases: string;
        salience: number;
        created_at: number;
      }[];

      if (rows.length === 0) {
        return {
          content: [
            { type: "text", text: `No entity found matching "${params.name}".` },
          ],
          details: undefined,
        };
      }

      const lines = rows.map((e) => {
        const aliases: string[] = JSON.parse(e.aliases);
        const aliasStr = aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : "";
        return `- [${e.id}] ${e.name} (${e.entity_type})${aliasStr}: ${e.description} [salience: ${e.salience.toFixed(2)}]`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 3. memory_graph_traverse — BFS from an entity
  // ------------------------------------------------------------------
  const memoryGraphTraverse = defineTool({
    name: "memory_graph_traverse",
    label: "Graph Traverse",
    description:
      "Traverse the memory graph starting from an entity using BFS. Returns connected entities and edges up to the given depth.",
    promptSnippet: "memory_graph_traverse: BFS traversal from an entity.",
    parameters: Type.Object({
      entityName: Type.String({ description: "Starting entity name" }),
      depth: Type.Optional(
        Type.Number({ description: "Max traversal depth (default 2)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const maxDepth = params.depth ?? 2;

      // Find the starting entity
      const entity = db()
        .prepare(
          `SELECT id, name, entity_type, description
           FROM memory_entities
           WHERE valid_to IS NULL AND name LIKE ?
           ORDER BY salience DESC LIMIT 1`,
        )
        .get(`%${params.entityName.toLowerCase()}%`) as {
        id: string;
        name: string;
        entity_type: string;
        description: string;
      } | undefined;

      if (!entity) {
        return {
          content: [
            {
              type: "text",
              text: `No entity found matching "${params.entityName}".`,
            },
          ],
          details: undefined,
        };
      }

      // BFS traversal
      const visited = new Map<string, number>();
      let frontier = [{ id: entity.id, weight: 1.0 }];
      const edgesList: { source: string; target: string; rel: string; desc: string; weight: number }[] = [];

      for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
        const nextFrontier: { id: string; weight: number }[] = [];

        for (const node of frontier) {
          if (visited.has(node.id) && visited.get(node.id)! >= node.weight) continue;
          visited.set(node.id, node.weight);

          const edges = db()
            .prepare(
              `SELECT source_id, target_id, relationship_type, description, weight
               FROM memory_edges
               WHERE (source_id = ? OR target_id = ?) AND valid_to IS NULL AND weight >= 0.1`,
            )
            .all(node.id, node.id) as {
            source_id: string;
            target_id: string;
            relationship_type: string;
            description: string;
            weight: number;
          }[];

          for (const edge of edges) {
            const otherId =
              edge.source_id === node.id ? edge.target_id : edge.source_id;
            const hopWeight = node.weight * 0.8 * edge.weight;

            edgesList.push({
              source: edge.source_id,
              target: edge.target_id,
              rel: edge.relationship_type,
              desc: edge.description,
              weight: edge.weight,
            });

            if (hopWeight >= 0.1) {
              nextFrontier.push({ id: otherId, weight: hopWeight });
            }
          }
        }

        frontier = nextFrontier;
      }

      // Resolve entity names for visited nodes
      const nodeIds = Array.from(visited.keys());
      if (nodeIds.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Entity "${entity.name}" has no connections.`,
            },
          ],
          details: undefined,
        };
      }

      const placeholders = nodeIds.map(() => "?").join(",");
      const entities = db()
        .prepare(
          `SELECT id, name, entity_type, description
           FROM memory_entities
           WHERE id IN (${placeholders}) AND valid_to IS NULL`,
        )
        .all(...nodeIds) as {
        id: string;
        name: string;
        entity_type: string;
        description: string;
      }[];

      const nameMap = new Map(entities.map((e) => [e.id, e.name]));

      const lines: string[] = [`Starting from: ${entity.name} (${entity.entity_type})\n`];

      lines.push("## Connected Entities");
      for (const ent of entities) {
        if (ent.id === entity.id) continue;
        const w = visited.get(ent.id) ?? 0;
        lines.push(
          `- ${ent.name} (${ent.entity_type}): ${ent.description} [graph weight: ${w.toFixed(2)}]`,
        );
      }

      // Deduplicate edges for display
      const seenEdges = new Set<string>();
      const uniqueEdges = edgesList.filter((e) => {
        const key = `${e.source}-${e.target}-${e.rel}`;
        if (seenEdges.has(key)) return false;
        seenEdges.add(key);
        return true;
      });

      if (uniqueEdges.length > 0) {
        lines.push("\n## Edges");
        for (const e of uniqueEdges) {
          const src = nameMap.get(e.source) ?? e.source;
          const tgt = nameMap.get(e.target) ?? e.target;
          lines.push(
            `- ${src} -> ${e.rel} -> ${tgt}: ${e.desc} [weight: ${e.weight.toFixed(2)}]`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 4. scratchpad_read — read a scratchpad block
  // ------------------------------------------------------------------
  const scratchpadReadTool = defineTool({
    name: "scratchpad_read",
    label: "Read Scratchpad",
    description:
      "Read a named scratchpad block from memory. Common blocks: user_profile, active_context, task_state.",
    promptSnippet: "scratchpad_read: Read a scratchpad memory block.",
    parameters: Type.Object({
      label: Type.String({
        description:
          "Block label (e.g. user_profile, active_context, task_state)",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      ensureDefaultBlocks();
      const value = scratchpadRead(params.label);
      const text =
        value.length > 0
          ? `<${params.label}>\n${value}\n</${params.label}>`
          : `Block "${params.label}" is empty.`;

      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  // ------------------------------------------------------------------
  // 5. memory_add_entity — create or merge an entity
  // ------------------------------------------------------------------
  const memoryAddEntity = defineTool({
    name: "memory_add_entity",
    label: "Add Entity",
    description:
      "Create a new entity in the memory graph or merge with an existing one if a duplicate is found. Deduplicates via content hash and vector similarity.",
    promptSnippet: "memory_add_entity: Create or merge a memory entity.",
    parameters: Type.Object({
      name: Type.String({ description: "Entity name (will be normalized)" }),
      entityType: Type.Union(
        [
          Type.Literal("person"),
          Type.Literal("organization"),
          Type.Literal("project"),
          Type.Literal("concept"),
          Type.Literal("tool"),
          Type.Literal("event"),
          Type.Literal("preference"),
        ],
        { description: "Type of entity" },
      ),
      description: Type.String({ description: "Brief description of the entity" }),
      aliases: Type.Optional(
        Type.Array(Type.String(), {
          description: "Alternative names or spellings",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ts = now();
      const entHash = md5(
        `${params.name.toLowerCase()}:${params.entityType}`,
      );
      const entText = `${params.name} ${params.description}`;
      const entVec = await embedOne(entText);
      const entBuf = toF32Buffer(entVec);

      // Check for existing entity by hash
      const existing = db()
        .prepare(
          "SELECT id, description, aliases, version FROM memory_entities WHERE hash = ? AND valid_to IS NULL",
        )
        .get(entHash) as
        | {
            id: string;
            description: string;
            aliases: string;
            version: number;
          }
        | undefined;

      if (existing) {
        // Merge: update description if longer, merge aliases
        const oldAliases: string[] = JSON.parse(existing.aliases);
        const newAliases = Array.from(
          new Set([...oldAliases, ...(params.aliases ?? [])]),
        );
        const mergedDesc =
          params.description.length > existing.description.length
            ? params.description
            : existing.description;

        db()
          .prepare(
            `UPDATE memory_entities
             SET description = ?, aliases = ?, embedding = ?, version = version + 1,
                 salience = MIN(1.0, salience + 0.1), last_accessed_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            mergedDesc,
            JSON.stringify(newAliases),
            entBuf,
            ts,
            ts,
            existing.id,
          );

        audit(
          existing.id,
          "entity",
          "MERGE",
          existing.description,
          mergedDesc,
          "Entity merged via memory_add_entity tool",
        );

        return {
          content: [
            {
              type: "text",
              text: `Merged with existing entity [${existing.id}] "${params.name}". Description ${params.description.length > existing.description.length ? "updated" : "kept"}. Aliases: ${newAliases.join(", ") || "none"}.`,
            },
          ],
          details: undefined,
        };
      }

      // Also check vector similarity for fuzzy dedup
      const vecMatches = vectorSearchEntities(entBuf, 5);
      const similarMatch = vecMatches.find(
        (m) => 1 - m.distance >= DEDUP_COSINE_THRESHOLD,
      );

      if (similarMatch) {
        const similarEntity = db()
          .prepare(
            "SELECT id, name, description, aliases FROM memory_entities WHERE id = ?",
          )
          .get(similarMatch.id) as {
          id: string;
          name: string;
          description: string;
          aliases: string;
        } | undefined;

        if (similarEntity) {
          const oldAliases: string[] = JSON.parse(similarEntity.aliases);
          const newAliases = Array.from(
            new Set([
              ...oldAliases,
              ...(params.aliases ?? []),
              params.name.toLowerCase(),
            ]),
          );
          const mergedDesc =
            params.description.length > similarEntity.description.length
              ? params.description
              : similarEntity.description;

          db()
            .prepare(
              `UPDATE memory_entities
               SET description = ?, aliases = ?, embedding = ?, version = version + 1,
                   salience = MIN(1.0, salience + 0.1), last_accessed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              mergedDesc,
              JSON.stringify(newAliases),
              entBuf,
              ts,
              ts,
              similarEntity.id,
            );

          audit(
            similarEntity.id,
            "entity",
            "MERGE",
            similarEntity.description,
            mergedDesc,
            "Entity merged via vector similarity in memory_add_entity tool",
          );

          return {
            content: [
              {
                type: "text",
                text: `Merged with similar entity [${similarEntity.id}] "${similarEntity.name}" (similarity: ${(1 - similarMatch.distance).toFixed(2)}).`,
              },
            ],
            details: undefined,
          };
        }
      }

      // New entity
      const id = nanoid();
      const decayRate = ENTITY_DECAY_RATES[params.entityType] ?? 0.005;

      db()
        .prepare(
          `INSERT INTO memory_entities
           (id, name, entity_type, description, aliases, hash, valid_from, version,
            salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          params.name.toLowerCase(),
          params.entityType,
          params.description,
          JSON.stringify(params.aliases ?? []),
          entHash,
          ts,
          decayRate,
          ts,
          entBuf,
          ts,
          ts,
        );

      audit(
        id,
        "entity",
        "ADD",
        null,
        params.description,
        "New entity created via memory_add_entity tool",
      );

      return {
        content: [
          {
            type: "text",
            text: `Created new entity [${id}] "${params.name}" (${params.entityType}).`,
          },
        ],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 6. memory_add_observation — add an observation linked to entities
  // ------------------------------------------------------------------
  const memoryAddObservation = defineTool({
    name: "memory_add_observation",
    label: "Add Observation",
    description:
      "Add a new observation (fact, event, preference, etc.) linked to one or more entities. Checks for duplicates via hash and vector similarity before adding.",
    promptSnippet:
      "memory_add_observation: Add an observation linked to entities.",
    parameters: Type.Object({
      content: Type.String({
        description: "The observation text (self-contained, no dangling pronouns)",
      }),
      observationType: Type.Union(
        [
          Type.Literal("fact"),
          Type.Literal("event"),
          Type.Literal("preference"),
          Type.Literal("belief"),
          Type.Literal("procedure"),
          Type.Literal("reflection"),
        ],
        { description: "Type of observation" },
      ),
      entityNames: Type.Array(Type.String(), {
        description: "Names of entities this observation relates to",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ts = now();
      const obsHash = md5(params.content);

      // Check hash duplicate
      const hashDup = db()
        .prepare(
          "SELECT id, content FROM memory_observations WHERE hash = ? AND valid_to IS NULL",
        )
        .get(obsHash) as
        | { id: string; content: string }
        | undefined;

      if (hashDup) {
        return {
          content: [
            {
              type: "text",
              text: `Duplicate observation skipped — exact match already exists [${hashDup.id}]: "${hashDup.content}"`,
            },
          ],
          details: undefined,
        };
      }

      // Vector similarity check
      const obsVec = await embedOne(params.content);
      const obsBuf = toF32Buffer(obsVec);
      const similar = vectorSearchObservations(obsBuf, 5);
      const tooSimilar = similar.find(
        (m) => 1 - m.distance >= DEDUP_COSINE_THRESHOLD,
      );

      if (tooSimilar) {
        return {
          content: [
            {
              type: "text",
              text: `Similar observation already exists [${tooSimilar.id}] (similarity: ${(1 - tooSimilar.distance).toFixed(2)}): "${tooSimilar.content}". Skipped to avoid duplicate. Use memory_update_observation if you want to update it.`,
            },
          ],
          details: undefined,
        };
      }

      // Resolve entity IDs
      const entityIds: string[] = [];
      for (const name of params.entityNames) {
        const ent = db()
          .prepare(
            "SELECT id FROM memory_entities WHERE name LIKE ? AND valid_to IS NULL ORDER BY salience DESC LIMIT 1",
          )
          .get(`%${name.toLowerCase()}%`) as
          | { id: string }
          | undefined;
        if (ent) entityIds.push(ent.id);
      }

      const id = nanoid();
      const decayRate =
        OBSERVATION_DECAY_RATES[params.observationType] ?? 0.005;

      db()
        .prepare(
          `INSERT INTO memory_observations
           (id, content, observation_type, confidence, source_message_id, entity_ids, hash,
            valid_from, version, salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0.8, NULL, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          params.content,
          params.observationType,
          JSON.stringify(entityIds),
          obsHash,
          ts,
          decayRate,
          ts,
          obsBuf,
          ts,
          ts,
        );

      audit(
        id,
        "observation",
        "ADD",
        null,
        params.content,
        "Created via memory_add_observation tool",
      );

      const linkedStr =
        entityIds.length > 0
          ? ` Linked to ${entityIds.length} entity(ies).`
          : " No matching entities found to link.";

      return {
        content: [
          {
            type: "text",
            text: `Created observation [${id}] (${params.observationType}).${linkedStr}`,
          },
        ],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 7. memory_add_edge — add a relationship between entities
  // ------------------------------------------------------------------
  const memoryAddEdge = defineTool({
    name: "memory_add_edge",
    label: "Add Edge",
    description:
      "Add or reinforce a relationship edge between two entities in the memory graph.",
    promptSnippet: "memory_add_edge: Create/reinforce a relationship edge.",
    parameters: Type.Object({
      sourceName: Type.String({ description: "Source entity name" }),
      targetName: Type.String({ description: "Target entity name" }),
      relationshipType: Type.String({
        description: 'Relationship type (e.g. "works_at", "uses", "manages")',
      }),
      description: Type.String({
        description: "Brief description of the relationship",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ts = now();

      // Resolve source entity
      const source = db()
        .prepare(
          "SELECT id, name FROM memory_entities WHERE name LIKE ? AND valid_to IS NULL ORDER BY salience DESC LIMIT 1",
        )
        .get(`%${params.sourceName.toLowerCase()}%`) as
        | { id: string; name: string }
        | undefined;

      if (!source) {
        return {
          content: [
            {
              type: "text",
              text: `Source entity "${params.sourceName}" not found. Create it first with memory_add_entity.`,
            },
          ],
          details: undefined,
        };
      }

      // Resolve target entity
      const target = db()
        .prepare(
          "SELECT id, name FROM memory_entities WHERE name LIKE ? AND valid_to IS NULL ORDER BY salience DESC LIMIT 1",
        )
        .get(`%${params.targetName.toLowerCase()}%`) as
        | { id: string; name: string }
        | undefined;

      if (!target) {
        return {
          content: [
            {
              type: "text",
              text: `Target entity "${params.targetName}" not found. Create it first with memory_add_entity.`,
            },
          ],
          details: undefined,
        };
      }

      // Check for existing edge
      const existing = db()
        .prepare(
          `SELECT id, weight FROM memory_edges
           WHERE source_id = ? AND target_id = ? AND relationship_type = ? AND valid_to IS NULL`,
        )
        .get(source.id, target.id, params.relationshipType) as
        | { id: string; weight: number }
        | undefined;

      const tripletText = `${source.name} -> ${params.relationshipType} -> ${target.name}`;
      const tripletVec = await embedOne(tripletText);
      const tripletBuf = toF32Buffer(tripletVec);

      if (existing) {
        // Reinforce
        db()
          .prepare(
            "UPDATE memory_edges SET weight = MIN(1.0, weight + 0.1), triplet_embedding = ?, updated_at = ? WHERE id = ?",
          )
          .run(tripletBuf, ts, existing.id);

        return {
          content: [
            {
              type: "text",
              text: `Reinforced existing edge [${existing.id}] ${tripletText} (weight: ${Math.min(1.0, existing.weight + 0.1).toFixed(2)}).`,
            },
          ],
          details: undefined,
        };
      }

      // New edge
      const id = nanoid();
      db()
        .prepare(
          `INSERT INTO memory_edges
           (id, source_id, target_id, source_type, target_type, relationship_type, description,
            weight, confidence, triplet_text, valid_from, triplet_embedding, created_at, updated_at)
           VALUES (?, ?, ?, 'entity', 'entity', ?, ?, 1.0, 0.8, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          source.id,
          target.id,
          params.relationshipType,
          params.description,
          tripletText,
          ts,
          tripletBuf,
          ts,
          ts,
        );

      audit(
        id,
        "edge",
        "ADD",
        null,
        tripletText,
        "Created via memory_add_edge tool",
      );

      return {
        content: [
          {
            type: "text",
            text: `Created edge [${id}] ${tripletText}: ${params.description}.`,
          },
        ],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 8. memory_update_observation — update an existing observation
  // ------------------------------------------------------------------
  const memoryUpdateObservation = defineTool({
    name: "memory_update_observation",
    label: "Update Observation",
    description:
      "Update an existing observation by closing the old version and creating a new one. Use this when information needs to be corrected or refined.",
    promptSnippet:
      "memory_update_observation: Update an observation (close old, create new).",
    parameters: Type.Object({
      observationId: Type.String({
        description: "ID of the observation to update",
      }),
      newContent: Type.String({
        description: "Updated observation text",
      }),
      reason: Type.String({
        description: "Why this observation is being updated",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ts = now();

      // Find the existing observation
      const existing = db()
        .prepare(
          "SELECT id, content, observation_type, entity_ids, decay_rate FROM memory_observations WHERE id = ? AND valid_to IS NULL",
        )
        .get(params.observationId) as
        | {
            id: string;
            content: string;
            observation_type: string;
            entity_ids: string;
            decay_rate: number;
          }
        | undefined;

      if (!existing) {
        return {
          content: [
            {
              type: "text",
              text: `Observation "${params.observationId}" not found or already closed.`,
            },
          ],
          details: undefined,
        };
      }

      // Close old observation
      db()
        .prepare(
          "UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?",
        )
        .run(ts, ts, existing.id);

      audit(
        existing.id,
        "observation",
        "UPDATE",
        existing.content,
        null,
        params.reason,
      );

      // Create new observation
      const id = nanoid();
      const obsVec = await embedOne(params.newContent);
      const obsBuf = toF32Buffer(obsVec);
      const obsHash = md5(params.newContent);

      db()
        .prepare(
          `INSERT INTO memory_observations
           (id, content, observation_type, confidence, source_message_id, entity_ids, hash,
            valid_from, version, salience, decay_rate, last_accessed_at, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0.9, NULL, ?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          params.newContent,
          existing.observation_type,
          existing.entity_ids,
          obsHash,
          ts,
          existing.decay_rate,
          ts,
          obsBuf,
          ts,
          ts,
        );

      audit(id, "observation", "ADD", null, params.newContent, `Updated from [${existing.id}]: ${params.reason}`);

      return {
        content: [
          {
            type: "text",
            text: `Updated observation: closed [${existing.id}], created [${id}]. Old: "${existing.content}" -> New: "${params.newContent}".`,
          },
        ],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 9. memory_delete_observation — soft-delete an observation
  // ------------------------------------------------------------------
  const memoryDeleteObservation = defineTool({
    name: "memory_delete_observation",
    label: "Delete Observation",
    description:
      "Soft-delete an observation by setting its valid_to timestamp. The observation remains in the database for audit purposes but is excluded from queries.",
    promptSnippet: "memory_delete_observation: Soft-delete an observation.",
    parameters: Type.Object({
      observationId: Type.String({
        description: "ID of the observation to delete",
      }),
      reason: Type.String({
        description: "Why this observation is being deleted",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const ts = now();

      const existing = db()
        .prepare(
          "SELECT id, content FROM memory_observations WHERE id = ? AND valid_to IS NULL",
        )
        .get(params.observationId) as
        | { id: string; content: string }
        | undefined;

      if (!existing) {
        return {
          content: [
            {
              type: "text",
              text: `Observation "${params.observationId}" not found or already deleted.`,
            },
          ],
          details: undefined,
        };
      }

      db()
        .prepare(
          "UPDATE memory_observations SET valid_to = ?, updated_at = ? WHERE id = ?",
        )
        .run(ts, ts, existing.id);

      audit(
        existing.id,
        "observation",
        "DELETE",
        existing.content,
        null,
        params.reason,
      );

      return {
        content: [
          {
            type: "text",
            text: `Deleted observation [${existing.id}]: "${existing.content}". Reason: ${params.reason}.`,
          },
        ],
        details: undefined,
      };
    },
  });

  // ------------------------------------------------------------------
  // 10. scratchpad_write — rewrite a scratchpad block
  // ------------------------------------------------------------------
  const scratchpadWriteTool = defineTool({
    name: "scratchpad_write",
    label: "Write Scratchpad",
    description:
      "Overwrite the contents of a named scratchpad block. Common blocks: user_profile, active_context, task_state.",
    promptSnippet: "scratchpad_write: Rewrite a scratchpad memory block.",
    parameters: Type.Object({
      label: Type.String({
        description:
          "Block label (e.g. user_profile, active_context, task_state)",
      }),
      value: Type.String({ description: "New content for the block" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      ensureDefaultBlocks();

      try {
        scratchpadRewrite(params.label, params.value, "agent");
        return {
          content: [
            {
              type: "text",
              text: `Scratchpad "${params.label}" updated successfully.`,
            },
          ],
          details: undefined,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to update scratchpad "${params.label}": ${msg}`,
            },
          ],
          details: undefined,
        };
      }
    },
  });

  return [
    memorySearch,
    memoryGetEntity,
    memoryGraphTraverse,
    scratchpadReadTool,
    memoryAddEntity,
    memoryAddObservation,
    memoryAddEdge,
    memoryUpdateObservation,
    memoryDeleteObservation,
    scratchpadWriteTool,
  ];
}
