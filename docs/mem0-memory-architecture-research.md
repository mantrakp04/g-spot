# Mem0 Memory Architecture Research Summary

Research extracted from DeepWiki analysis of `mem0ai/mem0`. This covers the memory operations pipeline, intelligent processing, graph memory, vector stores, and audit trails.

---

## 1. Data Models and Schemas

### Vector Store Payload (per memory entry)

Each memory is stored as a vector embedding with this metadata payload:

```python
{
    "data": str,             # The memory text content
    "hash": str,             # MD5 hash of the content (for dedup)
    "user_id": str,          # Scoping identifier
    "agent_id": str | None,  # Optional agent scope
    "run_id": str | None,    # Optional session scope
    "actor_id": str | None,  # Who created the memory (e.g., message sender name)
    "role": str | None,      # "user" | "assistant" | "system"
    "created_at": str,       # ISO 8601 timestamp (US/Pacific)
    "updated_at": str,       # ISO 8601 timestamp (US/Pacific)
    # ... any additional custom metadata
}
```

### MemoryItem (returned to callers)

```python
MemoryItem = {
    "id": str,               # UUID
    "memory": str,           # The text (promoted from payload["data"])
    "hash": str,
    "created_at": str,
    "updated_at": str,
    "score": float,          # Similarity score (search only)
    "user_id": str,          # Promoted from payload
    "agent_id": str | None,
    "run_id": str | None,
    "actor_id": str | None,
    "role": str | None,
    "metadata": dict,        # Remaining non-core fields
}
```

### History Table Schema (SQLite)

```sql
CREATE TABLE IF NOT EXISTS history (
    id           TEXT PRIMARY KEY,  -- UUID for the history record
    memory_id    TEXT,              -- FK to the memory that changed
    old_memory   TEXT,              -- Previous content (NULL for ADD)
    new_memory   TEXT,              -- New content (NULL for DELETE)
    event        TEXT,              -- "ADD" | "UPDATE" | "DELETE" | "NONE"
    created_at   DATETIME,
    updated_at   DATETIME,
    is_deleted   INTEGER,          -- 0 or 1
    actor_id     TEXT,
    role         TEXT
);
```

### Graph Entity Node Properties (Neo4j/Kuzu/Memgraph)

```
Node label: __Entity__
Properties:
  name: str          # Lowercased, underscored entity name ("alice", "new_york")
  user_id: str
  agent_id: str?
  run_id: str?
  embedding: float[] # Vector for similarity matching/dedup
```

Edges carry a relationship type (e.g., `WORKS_AT`, `LIVES_IN`) and connect two `__Entity__` nodes. Relationship types are sanitized via `sanitize_relationship_for_cypher()` to be Cypher-safe.

---

## 2. Memory Operations Pipeline

### Add (with `infer=True`, the default)

The pipeline has four phases:

**Phase 1 -- Fact Extraction.** Messages are parsed and sent to the LLM with either `USER_MEMORY_EXTRACTION_PROMPT` (extract facts from user messages only) or `AGENT_MEMORY_EXTRACTION_PROMPT` (extract from assistant messages when `agent_id` is present). The LLM returns `{"facts": ["Name is Alex", "Enjoys basketball", ...]}` as structured JSON.

**Phase 2 -- Conflict Detection.** Each extracted fact is embedded via the configured embedding model. The system calls `vector_store.search()` with session filters (`user_id`, `agent_id`, `run_id`) to find the top 5 similar existing memories per fact. Results are deduplicated by memory ID.

**Phase 3 -- Action Determination.** Existing memory UUIDs are mapped to simple integers (0, 1, 2...) to prevent LLM hallucination of IDs. The LLM receives both the existing memories and new facts via `get_update_memory_messages()` with `DEFAULT_UPDATE_MEMORY_PROMPT`, and returns a structured list of actions:

| Action   | When                                    | Effect                                  |
|----------|-----------------------------------------|-----------------------------------------|
| `ADD`    | New fact with no existing match         | `_create_memory()` -- embed, insert, log history |
| `UPDATE` | Fact refines/replaces existing memory   | `_update_memory()` -- re-embed, update payload, log history with `prev_value` |
| `DELETE` | Fact contradicts existing memory        | `_delete_memory()` -- remove from vector store, log history |
| `NONE`   | Already exists or irrelevant            | Update session IDs in metadata only if needed |

**Phase 4 -- Concurrent Storage.** Vector store writes and graph store writes execute in parallel via `ThreadPoolExecutor`. History is logged to SQLite for every write.

### Add (with `infer=False`)

Messages are stored verbatim -- each message becomes a separate memory with its role and content embedded directly. No LLM processing occurs.

### Search

1. Embed the query string.
2. Execute vector search and graph search concurrently via `ThreadPoolExecutor`.
3. Optionally apply a similarity `threshold` to filter low-scoring results.
4. Optionally rerank vector results via configured reranker (e.g., Cohere).
5. Return `{"results": [MemoryItem, ...], "relations": [{source, relationship, destination}, ...]}`.

### Update / Delete

Direct by memory ID. `update()` re-embeds the new text, updates the vector store payload (including `hash` and `updated_at`), and logs an `UPDATE` event to history with `prev_value`. `delete()` removes from vector store and logs a `DELETE` event.

---

## 3. Entity and Relationship Extraction (Graph Memory)

Graph memory is optional (requires `graph_store` config + `pip install mem0ai[graph]`). When enabled, it runs in parallel with vector store operations during `add()`.

### Extraction Pipeline

**Step 1 -- Entity Extraction.** `_retrieve_nodes_from_data()` calls the LLM with `EXTRACT_ENTITIES_TOOL` (a structured tool/function call). The LLM returns entities with types:

```json
{"entities": [
    {"entity": "alice", "entity_type": "person"},
    {"entity": "google", "entity_type": "organization"}
]}
```

Self-references ("I", "me", "my") are resolved to the `user_id` from filters. Entity names are normalized to lowercase with underscores.

**Step 2 -- Relationship Extraction.** `_establish_nodes_relations_from_data()` calls the LLM with `RELATIONS_TOOL` and `EXTRACT_RELATIONS_PROMPT`. Guidelines instruct the LLM to use consistent, general, timeless relationship types (prefer "professor" over "became_professor"). Output:

```json
{"entities": [
    {"source": "alice", "relationship": "works_at", "destination": "google"},
    {"source": "alice", "relationship": "lives_in", "destination": "san_francisco"}
]}
```

**Step 3 -- Entity Deduplication.** Each entity name is embedded. A Cypher query finds existing nodes with `cosine_similarity >= threshold` (default 0.7). If a match is found, the existing node is reused; otherwise a new node is created. The similarity formula is `2 * vector.similarity.cosine(a, b) - 1` (range [-1, 1]).

**Step 4 -- Contradiction Resolution.** `_get_delete_entities_from_search_output()` calls the LLM with `DELETE_MEMORY_TOOL_GRAPH` and the existing relationships formatted as `"source -- relationship -- destination"`. The LLM identifies outdated relationships to remove before adding new ones.

**Step 5 -- Graph Write.** `_add_entities()` executes Cypher MERGE queries. Four cases are handled: both nodes exist (merge relationship only), one exists, or neither exists.

---

## 4. Graph Search and Vector Search Combined at Query Time

Search executes both paths concurrently:

**Vector path:** Embed query -> `vector_store.search(vectors, filters, limit)` -> optional reranker pass -> list of `MemoryItem` with scores.

**Graph path:** Extract entities from query via LLM -> for each entity, embed and run Cypher query finding nodes with `similarity >= threshold` -> retrieve all incoming and outgoing relationships via UNION query -> rerank results with BM25Okapi (tokenize query, score `[source, relationship, destination]` sequences) -> return top 5 relations.

Results are merged in the response:
```python
{"results": [...vector memories...], "relations": [...graph relations...]}
```

The caller receives both semantic similarity matches (vector) and structured relational knowledge (graph) for the same query.

---

## 5. Temporal Handling: Versioning, Contradiction Resolution, Timestamps

### Timestamps

Every memory carries `created_at` and `updated_at` (ISO 8601, US/Pacific timezone). These are set on creation and updated on every modification.

### Versioning via History

The `SQLiteManager` maintains an append-only audit log. Every ADD, UPDATE, and DELETE generates a history record with both `old_memory` and `new_memory`. This means the full temporal evolution of any memory can be reconstructed by querying `SELECT * FROM history WHERE memory_id = ? ORDER BY created_at ASC, updated_at ASC`.

### Contradiction Resolution

Contradictions are handled by the LLM during the action determination phase. When a new fact conflicts with an existing memory (e.g., "I moved to New York" vs. existing "Lives in San Francisco"), the LLM returns a `DELETE` action for the old memory and an `ADD` for the new one, or an `UPDATE` that replaces the old content. The `prev_value` is preserved in the history record.

For graph memory, contradictions are handled separately: the LLM reviews existing relationships against new ones and returns a list of outdated relationships to delete via `DELETE_MEMORY_TOOL_GRAPH`.

### Content Hashing

Each memory's content is MD5-hashed and stored as `hash` in the vector payload. This supports fast exact-duplicate detection without embedding comparison.

---

## 6. Key Architectural Decisions

- **Dual storage by default:** Vector store handles semantic search; graph store (optional) handles relational queries. Both run in parallel during writes and reads.
- **LLM-in-the-loop:** Two LLM calls per `add()` with inference -- one for fact extraction, one for conflict resolution. This is the core differentiator from plain vector databases.
- **UUID-to-integer mapping:** Before sending existing memories to the LLM for conflict resolution, UUIDs are replaced with simple integers to prevent hallucinated IDs.
- **Session scoping:** All operations require at least one of `user_id`, `agent_id`, `run_id`. These are embedded in both vector metadata and graph node properties, ensuring strict isolation.
- **Thread-safe history:** SQLite with a threading lock provides the audit trail. Supports both in-memory (default, ephemeral) and file-backed (persistent) modes.
- **BM25 for graph reranking:** After vector similarity retrieval of graph nodes, results are reranked with BM25Okapi over `[source, relationship, destination]` token sequences, returning the top 5.
