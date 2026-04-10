# OpenMemory (CaviraOSS/OpenMemory) Memory Architecture Summary

Research extracted from DeepWiki analysis of the CaviraOSS/OpenMemory repository.

---

## 1. HSG Memory System (Hierarchical Semantic Graph)

The HSG is a biologically-inspired multi-sector memory engine. Core implementation lives in `packages/openmemory-js/src/memory/hsg.ts`.

### Data Model -- `memories` table

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | TEXT | Tenant isolation |
| `content` | TEXT | Raw memory text |
| `simhash` | TEXT | Deduplication fingerprint |
| `primary_sector` | TEXT | Classified sector |
| `tags` | TEXT (JSON) | Categorization |
| `meta` | TEXT (JSON) | Arbitrary metadata |
| `salience` | DOUBLE | Current memory strength [0,1] |
| `decay_lambda` | DOUBLE | Sector-specific decay rate |
| `mean_vec` | BYTEA | Mean of all sector vectors |
| `compressed_vec` | BYTEA | Compressed vector for smart tier |
| `last_seen_at` | BIGINT | Last access timestamp (ms) |
| `feedback_score` | DOUBLE | User feedback signal |

### `vectors` table (one row per sector per memory)

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID (FK) | Memory reference |
| `sector` | TEXT (PK with id) | Sector name |
| `v` | VECTOR | Embedding vector |
| `dim` | INT | Vector dimensionality |

---

## 2. The Five Memory Sectors

Type union: `'episodic' | 'semantic' | 'procedural' | 'emotional' | 'reflective'`

Each sector is defined by a `SectorConfig`:

```typescript
interface SectorConfig {
    model: string;          // Embedding model identifier
    decay_lambda: number;   // Exponential decay rate
    weight: number;         // Classification scoring weight
    patterns: RegExp[];     // Regex matchers for content classification
}
```

| Sector | decay_lambda | weight | Half-life (days) | Behavior |
|---|---|---|---|---|
| **episodic** | 0.015 | 1.2 | ~46 | Events, temporal experiences; fades moderately |
| **semantic** | 0.005 | 1.0 | ~139 | Facts, concepts; persists well |
| **procedural** | 0.008 | 1.1 | ~87 | How-to, instructions; moderate persistence |
| **emotional** | 0.020 | 1.3 | ~35 | Sentiments; fades fastest |
| **reflective** | 0.001 | 0.8 | ~693 | Meta-cognition, insights; persists longest |

**Classification**: `classifyContent()` matches text against regex patterns per sector, weighted by `config.weight`. Primary sector = highest score (defaults to `semantic` if no matches). Additional sectors included if their score >= 30% of primary. Confidence = `primaryScore / (primaryScore + secondScore + 1)`.

**Initial salience**: `0.4 + 0.1 * additional_sectors.length` -- broader relevance means higher starting salience.

**Cross-sector retrieval penalties** (`sector_relationships`):

```typescript
semantic:   { procedural: 0.8, episodic: 0.6, reflective: 0.7, emotional: 0.4 }
procedural: { semantic: 0.8, episodic: 0.6, reflective: 0.6, emotional: 0.3 }
episodic:   { reflective: 0.8, semantic: 0.6, procedural: 0.6, emotional: 0.7 }
reflective: { episodic: 0.8, semantic: 0.7, procedural: 0.6, emotional: 0.6 }
emotional:  { episodic: 0.7, reflective: 0.6, semantic: 0.4, procedural: 0.3 }
```

---

## 3. Decay Curve Math

Core formula in `calc_decay()`:

```
decayed_salience = init_salience * exp(-lambda * days_since)
reinforcement    = alpha_reinforce * (1 - exp(-lambda * days_since))
new_salience     = clamp(decayed_salience + reinforcement, 0, 1)
```

Where:
- `lambda` = sector-specific `decay_lambda` (0.001 to 0.020)
- `days_since` = `(now - last_seen_at) / 86400000`
- `alpha_reinforce` = 0.08 (background reinforcement preventing total forgetting)

The decay process runs on a scheduler (default: every 1440 minutes). It iterates all memories, recalculates salience, and persists changes. The two competing forces -- exponential forgetting plus background reinforcement -- ensure old memories asymptotically approach `alpha_reinforce` rather than zero.

**Retrieval-based reinforcement** (Hebbian):
- Retrieved memories get salience boosted by `+0.1` (capped at 1.0)
- Waypoint edges in the retrieval path get `+0.05` weight boost
- Co-activated memories (retrieved together) are paired in `coact_buf`, processed every 1000ms:
  ```
  temporal_factor = exp(-|memA.last_seen_at - memB.last_seen_at| / tau_ms)
  new_weight = min(1, current_weight + eta * (1 - current_weight) * temporal_factor)
  ```
  where `eta = 0.1` (Hebbian learning rate)

---

## 4. Waypoint Graph Structure

A directed, weighted graph where each memory has **exactly one primary outgoing waypoint** but can receive **multiple incoming links**, forming hub-and-spoke topologies.

### Schema

```typescript
interface waypoint {
    src_id: string;      // Source memory UUID
    dst_id: string;      // Destination memory UUID
    weight: number;      // Link strength [0.0, 1.0]
    created_at: number;  // Unix timestamp (ms)
    updated_at: number;  // Unix timestamp (ms)
}
```

```sql
CREATE TABLE openmemory_waypoints (
    src_id TEXT,
    dst_id TEXT NOT NULL,
    user_id TEXT,
    weight DOUBLE PRECISION NOT NULL,
    created_at BIGINT,
    updated_at BIGINT,
    PRIMARY KEY (src_id, user_id)   -- enforces single outgoing link
);
```

### Creation strategies

1. **Primary waypoint** (`create_single_waypoint`): On new memory, find the most similar existing memory via cosine similarity of mean vectors. If similarity >= 0.75, link to it; otherwise self-link.
2. **Cross-sector waypoints**: If memory is classified into multiple sectors, virtual links with weight 0.5 are created between sector representations.
3. **Contextual waypoints**: Explicit links to related memory IDs; existing links get +0.1 weight boost.

### BFS Traversal (`expand_via_waypoints`)

During query, when average similarity of top results is < 0.55, the system expands candidates via BFS:
- **Decay per hop**: `exp_weight = current_weight * neighbor_weight * 0.8`
- **Pruning threshold**: stops if accumulated weight < 0.1
- **Max expansion**: `ceil(0.3 * k * (1 - avg_top))` additional candidates, capped at `k * 2`
- Full path tracked for reinforcement

### Pruning

`prune_weak_waypoints()` deletes edges with weight < 0.05 during periodic maintenance.

---

## 5. Temporal Knowledge Graph (TKG)

Operates as a parallel subsystem to HSG -- same database, distinct tables. Stores structured SPO (subject-predicate-object) triples with temporal validity periods.

### `temporal_facts` table

```sql
CREATE TABLE temporal_facts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    valid_from INTEGER NOT NULL,    -- ms since epoch
    valid_to INTEGER,               -- NULL = currently active
    confidence REAL DEFAULT 1.0,    -- [0.0, 1.0]
    last_updated INTEGER NOT NULL,
    metadata TEXT                    -- JSON
);
```

### `temporal_edges` table

```sql
CREATE TABLE temporal_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES temporal_facts(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES temporal_facts(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,     -- e.g. "implies", "caused_by"
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    weight REAL DEFAULT 1.0,
    metadata TEXT
);
```

**Fact evolution**: On `insert_fact()`, the system queries active facts with matching `(subject, predicate)`. Existing facts with `valid_from < new.valid_from` are auto-closed by setting `valid_to = new.valid_from - 1`.

**Confidence decay** (linear, unlike HSG's exponential):
```
new_confidence = MAX(0.1, confidence * (1 - decay_rate * days_elapsed))
```
Hard floor at 0.1 ensures facts never fully vanish.

**Queries**: Point-in-time (`WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`), range-based timeline reconstruction, and conflict detection for overlapping facts.

### HSG vs TKG comparison

| Dimension | HSG | TKG |
|---|---|---|
| Data structure | Free-text + sectors | SPO triples |
| Storage | `memories` + `vectors` | `temporal_facts` |
| Decay | Exponential (sector lambda) | Linear (confidence) |
| Query method | Vector similarity + graph traversal | SQL temporal ranges |

---

## 6. Embedding System

Four performance tiers controlled by `OM_TIER`:

| Tier | Strategy | Description |
|---|---|---|
| **hybrid** | Synthetic only | `gen_syn_emb()` -- TF-IDF + N-grams + positional encoding, zero latency |
| **fast** | Synthetic only | Same as hybrid, optimized path |
| **smart** | Fused | 256d synthetic + 128d compressed semantic, fused at 0.6/0.4 ratio |
| **deep** | Full semantic | Full AI embeddings from cloud/local provider |

Provider fallback chain: primary (`OM_EMBEDDINGS`) -> fallback list (`OM_EMBEDDING_FALLBACK`) -> synthetic (ultimate fallback). Reflective sector uses `text-embedding-3-large`; others use `text-embedding-3-small`.

---

## 7. Auto-Reflection System

Periodic background job that consolidates similar memories into higher-order reflective memories.

**Clustering**: Greedy Jaccard similarity (threshold > 0.8) within the same sector. Excludes already-reflective or consolidated memories. Minimum cluster size: 2.

**Cluster salience**: `salience = min(1, 0.6 * (cluster_size/10) + 0.3 * avg(exp(-age/12h)) + 0.1 * emotional_boost)`

**Output**: New `reflective` sector memory created via `add_hsg_memory()` with metadata `{type: "auto_reflect", sources: [UUIDs], freq: N, at: ISO_timestamp}`. Source memories marked `consolidated: true` and get +10% salience boost.

Config: `OM_AUTO_REFLECT` (default false), `OM_REFLECT_INTERVAL` (default 10 min), `OM_REFLECT_MIN_MEMORIES` (default 20).

---

## 8. Retrieval: Combining Graph Traversal and Vector Search

The `hsg_query()` function implements a multi-phase retrieval pipeline:

1. **Classify query** into target sectors via `classifyContent()`
2. **Embed query** for all relevant sectors via `embedQueryForAllSectors()`
3. **Vector search** per sector (`searchSimilar()`, k*3 candidates)
4. **Adaptive expansion**: If avg similarity of top results < 0.55, expand via waypoint BFS
5. **Hybrid scoring** for each candidate:
   ```typescript
   scoring_weights = {
       similarity: 0.35,   // cosine similarity (boosted: 1 - exp(-tau * sim))
       overlap: 0.20,      // token overlap
       waypoint: 0.15,     // graph traversal weight
       recency: 0.10,      // exp(-days/t_days) * (1 - days/t_max_days)
       tag_match: 0.20     // tag matching score
   }
   // final = sigmoid(weighted_sum), then z-score normalized
   ```
6. **Select top-K** after z-score normalization
7. **Reinforce**: boost salience of retrieved memories, reinforce waypoint paths, push co-activation pairs to Hebbian buffer

---

## 9. Memory Operations API

| Endpoint | Method | Purpose |
|---|---|---|
| `/memory/add` | POST | Add memory (auto-classifies, embeds, creates waypoints) |
| `/memory/query` | POST | Semantic search with HSG traversal, returns top-K |
| `/memory/:id` | GET | Retrieve single memory by ID |
| `/memory/all` | GET | List with pagination, sector/user filters |
| `/memory/:id` | PATCH | Update content (triggers re-embedding), tags, metadata |
| `/memory/:id` | DELETE | Remove memory, vectors, and waypoint links |
| `/memory/reinforce` | POST | Manual salience boost (default +0.1) |
| `/memory/ingest` | POST | Bulk document ingestion (PDF, DOCX, HTML, audio, video) |
| `/memory/ingest/url` | POST | URL-based ingestion |
