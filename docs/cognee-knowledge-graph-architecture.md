# Cognee Knowledge Graph Memory Architecture

Research summary based on the `topoteretes/cognee` repository (DeepWiki analysis).

---

## 1. Core Data Models

All graph entities inherit from **`DataPoint`** (Pydantic v2 BaseModel):

```python
class DataPoint(BaseModel):
    id: UUID                              # uuid4(), unique identifier
    created_at: int                       # epoch milliseconds
    updated_at: int                       # epoch milliseconds
    ontology_valid: bool
    version: int                          # default 1, incremented on update
    topological_rank: Optional[int]       # position in graph topology
    metadata: Optional[MetaData]          # {"type": str, "index_fields": ["field1", ...]}
    type: str                             # class name of the subclass
    belongs_to_set: Optional[List[DataPoint]]
```

`metadata["index_fields"]` controls which fields get embedded into vectors. The method `get_embeddable_data(dp)` reads the first index field's value for embedding.

**In-memory graph elements** (used during search, distinct from DataPoint):

- **`Node`**: `id: str`, `attributes: Dict[str, Any]`, `skeleton_neighbours: List[Node]`, `skeleton_edges: List[Edge]`, `status: np.ndarray` (multi-dimensional alive/dead flags).
- **`Edge`**: `node1: Node`, `node2: Node`, `attributes: Dict[str, Any]`, `directed: bool`, `status: np.ndarray`. Equality is order-sensitive for directed edges, order-insensitive for undirected.
- **`CogneeGraph`**: `nodes: Dict[str, Node]`, `edges: List[Edge]`, `directed: bool`. Container with methods for projection, distance mapping, and triplet scoring.

**Persistent edge representation** (from `get_graph_from_model`): 4-tuple `(source_node_id, target_node_id, relationship_name, edge_properties_dict)`. Edge properties include `updated_at`, optional `edge_text`, optional `weights: Dict[str, float]`.

Relationships in DataPoint subclasses can be declared three ways:
1. `field: DataPoint` or `field: List[DataPoint]` -- simple reference
2. `field: Tuple[Edge, DataPoint]` -- with edge metadata
3. `field: List[Tuple[Edge, DataPoint]]` -- multiple targets with metadata

---

## 2. Knowledge Graph Generation (`cognee.cognify`)

The `cognify()` pipeline transforms ingested data into a knowledge graph through six sequential tasks:

1. **`classify_documents`** -- MIME type detection, structural metadata.
2. **`extract_chunks_from_documents`** -- Splits text using `TextChunker` (paragraph-based) or `LangchainChunker` (recursive character splitting). Chunk size auto-calculated as `min(embedding_max_tokens, llm_max_tokens // 2)`.
3. **`extract_graph_from_data`** -- LLM-based entity/relationship extraction. Uses the `instructor` library to force structured output conforming to a Pydantic `graph_model` schema (default: `KnowledgeGraph`). Supports `custom_prompt` for domain-specific extraction and ontology resolvers (RDF/OWL) to constrain entity types.
4. **`summarize_text`** -- Hierarchical multi-level summaries stored as searchable nodes.
5. **`add_data_points`** -- The core storage step (detailed below).
6. **`extract_dlt_fk_edges`** -- Foreign key relationships from DLT sources.

**Graph construction** (`get_graph_from_model`): Recursively traverses DataPoint instances. For each DataPoint, scalar fields become node properties; DataPoint-typed fields become edges. Uses three tracking dicts (`added_nodes`, `added_edges`, `visited_properties`) to prevent infinite cycles. The `property_key` is `"{data_point_id}_{relationship_key}_{target_id}"`.

**Storage pipeline** in `add_data_points`:
1. Parallel `get_graph_from_model()` for all DataPoints via `asyncio.gather()`
2. `deduplicate_nodes_and_edges()`
3. `ensure_default_edge_properties()` (timestamps, metadata)
4. `graph_engine.add_nodes(nodes)` then `index_data_points(nodes)` (creates vector embeddings per `metadata["index_fields"]`)
5. `graph_engine.add_edges(edges)` then `index_graph_edges(edges)`
6. If `embed_triplets=True`: create Triplet objects and index them

---

## 3. Temporal Knowledge Graphs

Activated via `cognee.cognify(temporal_cognify=True)`. Replaces tasks 3-4 with:

- **`extract_events_and_timestamps`** -- LLM extracts events with associated timestamps from text chunks.
- **`extract_knowledge_graph_from_events`** -- Transforms events into graph nodes with temporal metadata.

**`QueryInterval` model**:
```python
class QueryInterval(BaseModel):
    starts_at: Optional[Timestamp]
    ends_at: Optional[Timestamp]
```

**`TemporalRetriever`** (extends `GraphCompletionRetriever`):
1. Parses time range from natural language query using LLM structured output -> `QueryInterval`.
2. Calls `graph_engine.collect_time_ids(time_from, time_to)` for timestamp-filtered event IDs.
3. Retrieves full events via `graph_engine.collect_events(ids)`.
4. Vector search on `Event_name` collection for semantic relevance scoring.
5. `filter_top_k_events()` combines timestamp match + vector similarity: events not in vector results get `float("inf")` score; sorted ascending, truncated to `top_k`.
6. **Fallback**: if no time range extracted or no events found, falls back to standard `get_triplets()` triplet search.

Events are stored in the graph DB with: node ID, description, start/end timestamps, and entity relationship edges.

---

## 4. Graph-Based Search (Triplet Search)

The primary algorithm is **`brute_force_triplet_search()`**, used by `GraphCompletionRetriever`:

**Step 1 -- Vector collection search** (parallel `asyncio.gather`): Embeds the query and searches five collections simultaneously:
- `Entity_name`, `TextSummary_text`, `EntityType_name`, `DocumentChunk_text` (node collections)
- `EdgeType_relationship_name` (edge collection)
- `wide_search_top_k` (default 100) limits results per collection.

**Step 2 -- Extract relevant IDs**: Node IDs from vector results (excluding edge collection) form the filter set.

**Step 3 -- Graph projection**: `CogneeGraph.project_graph_from_db()` loads only the filtered subgraph into memory. Three projection modes: full graph, ID-filtered, or nodeset subgraph. Properties projected selectively to reduce memory.

**Step 4 -- Distance mapping**:
- `map_vector_distances_to_graph_nodes()`: sets `node.attributes["vector_distance"]` from scored results. Unmatched nodes keep default penalty (3.5).
- `map_vector_distances_to_graph_edges()`: builds `{text: score}` map from edge results, matches by `edge_text` or `relationship_type`.

**Step 5 -- Triplet importance scoring**:
```
triplet_score = node1.vector_distance + node2.vector_distance + edge.vector_distance
```
Uses `heapq.nsmallest(k, edges, key=score)` for O(n log k) top-k selection. Lower score = more relevant.

**Step 6 -- Context resolution**: `resolve_edges_to_text()` formats top-k triplets as human-readable text ("Node1: {attrs}\nEdge: {attrs}\nNode2: {attrs}"), passed to LLM for completion.

**Advanced retrievers**:
- `GraphCompletionCotRetriever`: Chain-of-thought -- validates initial answer, generates follow-up questions, retrieves additional triplets iteratively up to `max_iter`.
- `GraphCompletionContextExtensionRetriever`: Extends context by running multiple rounds of triplet retrieval with refined queries.

---

## 5. Vector Search and RAG

**Embedding pipeline**: All adapters use `EmbeddingEngine.embed_text(data: List[str]) -> List[List[float]]`. Vector size from `embedding_engine.get_vector_size()`.

**Storage schema per vector DB entry**: `id` (UUID), `vector` (float array), `payload` (JSON dict of DataPoint properties). Adapters: LanceDB, PGVector, ChromaDB, Qdrant.

**Search interface** (uniform across adapters):
```python
async def search(collection_name, query_text=None, query_vector=None, limit=15, with_vector=False) -> List[ScoredResult]
```
Distance normalization: min-max normalization to [0,1] applied to raw distances. `ScoredResult`: `id: UUID`, `score: float`, `payload: dict`.

**RAG pipeline** (`SearchType.RAG_COMPLETION`):
1. Embed query, vector search for top-k chunks from `DocumentChunk_text` collection.
2. Format retrieved payloads as context string.
3. If `only_context=True`, return raw context. Otherwise, build augmented prompt (system_prompt + context + query) and call LLM.

**How vector and graph search combine**: The `GRAPH_COMPLETION` search type uses vector search as the *first stage* to identify relevant node/edge IDs, then projects the graph subgraph, maps vector distances onto graph elements, and scores triplets by summing all three distances. This is a hybrid approach: vector similarity provides semantic relevance, graph structure provides relational context.

---

## 6. Triplet Embedding Model

A **`Triplet`** extends `DataPoint` with:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Deterministic: `generate_node_id(source_id + relationship + target_id)` |
| `from_node_id` | str | Source node ID |
| `to_node_id` | str | Target node ID |
| `text` | str | `"{source_text} -> {relationship_text}->{target_text}"` |
| `metadata` | dict | `{"index_fields": ["text"]}` |

**Creation** (`_create_triplets_from_graph`):
1. Build `node_map: {str(node.id): DataPoint}`.
2. For each edge tuple, extract source/target text via `_extract_embeddable_text_from_datapoint()` (reads `metadata["index_fields"]`, concatenates field values).
3. Relationship text: prefer `edge_properties["edge_text"]`, fallback to `relationship_name`.
4. Format: `"{source_text} -> {rel_text}->{target_text}"`.
5. Deduplicate via `seen_ids` set.
6. Complexity: O(n + m) for n nodes, m edges.

**Indexing**: Triplets go through standard `index_data_points()` into a `Triplet_text` vector collection. Searchable via the same `vector_engine.search()` interface.

**`SearchType.TRIPLET_COMPLETION`**: Searches the `Triplet_text` collection directly for relationship-aware retrieval, providing structured source-target context to the LLM. This differs from `GRAPH_COMPLETION` (which projects and traverses the graph) by operating purely in vector space on pre-formatted relationship strings.

Enabled globally via `TRIPLET_EMBEDDING=true` env var or per-call via `embed_triplets=True` parameter in `add_data_points()`.
