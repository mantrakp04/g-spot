# Letta Memory Architecture Summary

Research extracted from DeepWiki for `letta-ai/letta`. Covers agent memory system, block management, archival memory, core memory tools, and context window management.

---

## 1. Data Models and Schemas

### Block (Core Memory Unit)

Every agent's in-context memory is composed of **Blocks** -- labeled text containers compiled into the system prompt on every agent step.

**BaseBlock fields (Pydantic, `letta/schemas/block.py`):**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `id` | `str` | `block-<uuid>` | Unique identifier |
| `label` | `str` | required | Type key (e.g. `persona`, `human`) |
| `value` | `str` | required | Text content |
| `limit` | `int` | `2000` | Max character count for `value` |
| `description` | `str` | optional | Human-readable purpose |
| `metadata` | `dict` | `{}` | Arbitrary JSON |
| `read_only` | `bool` | `False` | Prevents agent tool modification |
| `is_template` | `bool` | `False` | Reusable template flag |
| `template_name` | `str` | optional | Name when used as template |

Validation is enforced at three layers: Pydantic (`verify_char_limit`), service layer (`validate_block_limit_constraint`), and ORM (`before_insert`/`before_update` SQLAlchemy events). The invariant is always `len(value) <= limit`.

### Persistence Schema (ORM)

```
Block table:        id, label, value, limit, description, read_only, metadata_, organization_id, created_at, updated_at, version (optimistic lock)
BlocksAgents:       agent_id (FK), block_id (FK), block_label  -- many-to-many pivot
BlockHistory:       id, block_id (FK), old_value, new_value, changed_by_id, changed_at, sequence_number  -- audit/undo-redo
```

The `BlocksAgents` pivot allows **shared blocks** (multiple agents referencing the same block) and **label customization** (different agents can assign different labels to the same underlying block). `BlockHistory` supports undo/redo via `sequence_number` and a `current_history_entry_id` pointer on Block, with optimistic locking via a `version` column.

### Memory Object

`Memory` (`letta/schemas/memory.py`) wraps `List[Block]` plus `List[FileBlock]`. Its key method is `compile()`, which concatenates all blocks with labels into text that replaces the `IN_CONTEXT_MEMORY_KEYWORD = "CORE_MEMORY"` placeholder in the system prompt template. File blocks are read-only, auto-created when files are opened, and managed via LRU eviction.

### Passage (Archival Memory Unit)

```
Passage (base):        id, text, embedding (List[float]), embedding_config, organization_id, metadata_, tags (List[str]), created_at, is_deleted
ArchivalPassage:       + archive_id (FK to Archive)
SourcePassage:         + source_id, file_id, file_name
```

Stored in two SQL tables: `archival_passages` (agent-inserted) and `source_passages` (file-derived). A separate `passage_tags` junction table enables efficient tag-based filtering. Embeddings are padded to `MAX_EMBEDDING_DIM = 4096` for pgvector; Turbopuffer and Pinecone handle variable dimensions natively.

### Archive

```
Archive:  id, name, embedding_config, vector_db_provider (NATIVE|TPUF|PINECONE), organization_id, created_at
```

Agents link to archives via `archives_agents` (agent_id, archive_id, is_owner). Each archive gets a unique vector DB namespace (e.g. `archival_{archive_id}_{environment}` for Turbopuffer).

---

## 2. Agent Self-Editing Memory (Core Memory Tools)

The agent modifies its own in-context memory by calling built-in tool functions. These have evolved across agent versions:

| Version | Tools | Agent Type |
|---------|-------|------------|
| V1 | `core_memory_append`, `core_memory_replace` | `memgpt_agent` |
| V2 | `memory_insert`, `memory_replace` | `memgpt_v2_agent` |
| V3 | `memory` (unified omni-tool) | `letta_v1_agent` |
| Sleeptime | `memory_replace`, `memory_insert`, `memory_rethink`, `memory_finish_edits` | `sleeptime_agent` |

**Execution flow:** Agent calls a memory tool -> `ToolExecutionManager` dispatches to the Python function -> function validates the block exists and is not `read_only` -> applies the text modification -> calls `BlockManager.update_block_async()` -> DB persists new value and records `BlockHistory` entry -> `AgentManager.rebuild_system_prompt()` recompiles all blocks into the system prompt -> on the next loop iteration, the LLM sees updated memory.

### Core Memory Append (V1)

Appends text to the end of a named block's `value`. If appending would exceed `limit`, the value is truncated with a warning.

### Core Memory Replace (V1)

Performs a string find-and-replace within a block's `value`. The agent specifies `label`, `old_str`, and `new_str`.

### Memory Insert / Memory Replace (V2)

Line-based editing. Block content is displayed to the LLM with line number prefixes (e.g. `1-> First line`). `memory_insert` inserts text at a specific line number; `memory_replace` replaces a range of lines. Line number prefixes are stripped via `MEMORY_TOOLS_LINE_NUMBER_PREFIX_REGEX` before storage.

### Memory Rethink (Sleeptime)

Complete rewrite of a block's value. Used by background "sleeptime" agents that process conversations asynchronously and reorganize memory without real-time pressure.

### Read-Only Protection

Blocks with `read_only=True` (e.g. file blocks) raise `ValueError` (`READ_ONLY_BLOCK_EDIT_ERROR`) if any tool attempts modification.

### Tool Rules

Most memory tools get a `ContinueToolRule` (agent keeps executing after the call). Terminal tools like `memory_finish_edits` and `send_message` get a `TerminalToolRule` (agent stops). Voice sleeptime tools enforce strict sequencing: `store_memories` (InitToolRule) -> `rethink_user_memory` (ChildToolRule) -> `finish_rethinking_memory` (TerminalToolRule).

---

## 3. Context Window Management and Summarization

### Trigger

Compaction is **reactive**: it fires when `ContextWindowExceededError` is caught during `llm_adapter.invoke_llm()`. The system retries up to `max_summarizer_retries` (default 3) times, compacting between each retry. A proactive trigger at 75% capacity (`SUMMARIZATION_TRIGGER_MULTIPLIER = 0.75`) exists in code but is currently commented out.

### Compaction Modes

**Sliding Window (default):**
1. Calculate eviction target (default 30% of messages via `sliding_window_percentage`).
2. Walk forward from the eviction point to find an assistant message boundary (preserves valid conversation structure).
3. Count tokens in `[system_prompt] + messages[cutoff:]` using provider-specific token counters.
4. If the retained portion still exceeds `(1 - sliding_window_percentage) * context_window`, increase eviction by 10% and retry.
5. Summarize `messages[1:cutoff]` via a separate LLM call.
6. Insert the summary as a user-role message at index 1 (right after system prompt).
7. Return `[system_prompt, summary_message] + retained_messages`.

**All Messages:**
Summarize everything except the system prompt (`messages[1:]`). Most aggressive; used when context is severely constrained. Approval-role messages are protected from summarization.

**Static Buffer (legacy):**
Fixed message count buffer. When exceeded, trim oldest messages down to `message_buffer_min`, optionally triggering a background summarizer agent.

### Summary Generation (`simple_summary`)

- Formats evicted messages into a text transcript via `simple_formatter()`.
- Sends to a summarizer LLM with `SHORTER_SUMMARY_PROMPT` (100-word limit covering: task overview, current state, next steps).
- Anthropic/Bedrock use streaming to avoid timeout; other providers use blocking requests.
- If the summarizer itself hits context limits, tool returns are truncated to `TOOL_RETURN_TRUNCATION_CHARS = 5000` chars and retried.
- Final summary is clipped to `clip_chars` (default 2000) if needed.

### CompactionSettings Schema

| Field | Type | Default |
|-------|------|---------|
| `model` | `str` | required |
| `prompt` | `str` | `SHORTER_SUMMARY_PROMPT` |
| `clip_chars` | `int | None` | `2000` |
| `mode` | `"all" | "sliding_window"` | `"sliding_window"` |
| `sliding_window_percentage` | `float` | `0.30` |
| `prompt_acknowledgement` | `bool` | `False` |

Per-agent `compaction_settings` override global `summarizer_settings`, which fall back to hardcoded defaults.

### Token Counting

Provider-specific: `OpenAITokenCounter` (tiktoken), `AnthropicTokenCounter` (native API), `ApproxTokenCounter` (bytes/4 heuristic with 1.3x safety margin). The safety margin compensates for JSON serialization overhead that causes 25-35% underestimation in the byte-based approximation.

---

## 4. Archival Memory Search

```python
async def archival_memory_search(
    self, query: str,
    tags: Optional[list[str]] = None,
    tag_match_mode: Literal["any", "all"] = "any",
    top_k: Optional[int] = None,       # default 10
    start_datetime: Optional[str] = None,
    end_datetime: Optional[str] = None,
) -> Optional[str]
```

**Flow:** Tool call -> `LettaCoreToolExecutor` -> `AgentManager.search_agent_archival_memory_async()` -> checks `archive.vector_db_provider`:

- **NATIVE (pgvector):** SQL query with `embedding <=> query_embedding` cosine distance ordering, plus WHERE clauses for tag/date filters.
- **Turbopuffer:** API call with vector, top_k, and filter dict (tags, created_at ranges) using cosine distance.
- **Pinecone:** Similar external API call with namespace-scoped queries.

Tag filtering supports two modes: `"any"` (passage matches if it has ANY of the specified tags) and `"all"` (passage must have ALL specified tags, implemented via `GROUP BY ... HAVING COUNT(DISTINCT tag) = len(tags)`).

Results are ranked by semantic similarity and returned as formatted JSON with text, tags, and timestamps.

---

## 5. Key Architectural Patterns

- **Dual-write for passages:** SQL is always the source of truth; vector DB (Turbopuffer/Pinecone) is an optional performance layer for similarity search.
- **System prompt as memory surface:** All in-context memory is injected into `message_ids[0]` (system message) by replacing the `CORE_MEMORY` placeholder. Updated on every block change.
- **Shared blocks via pivot table:** Multiple agents can reference the same block, enabling shared personas or knowledge.
- **Optimistic locking:** Block `version` column prevents concurrent modification; raises HTTP 409 on conflict.
- **Undo/redo:** `BlockHistory` with sequence numbers and a current-pointer enables reverting block edits.
