# g-spot Agents — Backend & Data Layer

> Bucket: **backend-data**. Scope: the server/data layer behind the agents feature —
> tRPC routers, the chat agent runtime, the PTY terminal streaming runtime, the
> chat-title worker, and the Drizzle/SQLite schema for projects / chats / Pi state.
> This documents the **current** state honestly, including stubs and rough edges.

## Overview

The agents feature is a per-**project** (workspace) coding-agent surface. Each project
is an absolute filesystem directory. Within a project the user opens **tabs**, two of
which are backed by this layer:

1. **Chat agent** — an LLM coding agent powered by `@earendil-works/pi-coding-agent`
   ("Pi"). Streams over a WebSocket, persists messages + agent context to SQLite,
   enforces g-spot-specific sandbox/network/approval policies, runs MCP tools, and
   fires off async title-generation + memory ingestion.
2. **Terminal** — a real PTY (`Bun.Terminal`) bridged over a WebSocket, optionally
   wrapped in `tmux`/`screen` for persistence, with opportunistic detection and
   resume of `claude` / `codex` CLI agent sessions.

Everything is **single-machine, local-first**. There is no auth on the data layer
(`publicProcedure` only), no per-user scoping, and Pi state is a single global
singleton row. The only access gate is `DEMO_MODE`, which blocks all mutations.

Three persistence concepts:
- **Projects** (`projects` table) — name, immutable `path`, custom/append prompts, and
  a JSON `agent_config` blob (the per-project default Pi config).
- **Chats** (`chats` + `chat_messages`) — title, JSON `agent_config`, a JSON
  `agent_context` (serialized Pi `SessionManager` entries), and JSON-serialized Pi
  messages one-per-row.
- **Pi state** (`pi_state`, singleton) — user-level chat/worker defaults + provider
  credentials (API keys + OAuth), all as JSON text columns.

Config inheritance is layered: **user Pi defaults → project agent_config → chat
agent_config**, normalized through `mergeAgentConfig` at every hop.

## Current Features & UX (backed by this layer)

- **Per-project chats** with cursor-paginated listing (`chat.list`, keyset cursor on a
  `julianday`-derived numeric `updatedAt` + `id` tiebreak), create/delete, rename,
  and config edit.
- **Streaming chat runs** over `ws /api/chat/:chatId/socket`. Client sends `start`
  (with prompt or a rich `message`) or `attach`; server replays buffered events and
  live-streams Pi `AgentSessionEvent`s.
- **Run status broadcasting** over `ws /api/chat/status/socket` — a global map of
  `chatId → "running" | "pending-approval" | "finished-unread"`, pushed to all
  listeners, with a `mark_read` client message to clear the unread badge.
- **Tool approval gate.** When chat config is `approval-required` (or a tool is
  side-effecting / MCP), the run publishes a `tool_approval_request` event and blocks
  on a promise resolved by the `chat.resolveToolApproval` mutation.
- **Sandbox / network policy.** `read-only` blocks write/shell/MCP tools;
  `networkAccess: off` blocks bash commands matching a network-command regex
  heuristic; `full-access`/`workspace-write` allow.
- **`/compact` command** — a chat message of `/compact [instructions]` triggers
  `session.compact(...)` instead of a normal turn and re-persists the agent context.
- **Auto title generation** — first user turn fires `refreshChatTitle` (worker model,
  no tools, no project-resource discovery) fire-and-forget.
- **Memory ingestion** — first turn also fires `extractChatTurnToMemory`
  fire-and-forget into the memory graph.
- **Fork / replace / delete messages** — `chat.fork` clones messages into a new chat
  (new ids), `chat.replaceMessages` rewrites history (and nulls `agent_context`),
  `chat.deleteMessage` removes a single row.
- **Worktree-scoped runs** — if chat config has a `branch`, the run resolves the
  matching git worktree path and uses it as the agent cwd (falls back to project root).
- **Persistent terminal** over `ws /api/terminal/socket`. Sessions keyed by
  `sessionId`; multiple sockets can attach to one PTY (shared output buffer, replay on
  reconnect via `historyOffset`/`skipReplay`), resize, signal (`SIGINT` etc.), and
  close. Uses `tmux`/`screen` when present so the shell survives reconnects.
- **Agent CLI resume in terminal** — detects when a `claude`/`codex` command is typed,
  captures the native agent session id, and on the next attach can relaunch via
  `claude --resume <id>` / `codex resume <id>`. Resume binding resolved from g-spot's
  own store, then `~/.cmuxterm/*-hook-sessions.json`, then inferred from
  `~/.claude/projects/*` / `~/.codex/sessions/*` transcripts.
- **Pi provider management** — API key save/remove + OAuth flow (start/poll/submit/
  cancel), model catalog, builtin tool list, addon install/remove, Pi
  registry/marketplace search.

## Implementation

### Server entry & transports
`apps/server/src/index.ts` wires Elysia routes:
- tRPC over HTTP (the `appRouter` in `packages/api/src/routers/index.ts`).
- `ws /api/chat/status/socket` → `handleChatStatusSocket{Open,Message,Close}`
- `ws /api/chat/:chatId/socket` → `handleChatSocket{Open,Message,Close}`
- `ws /api/terminal/socket` → `handleTerminalSocket{Open,Message,Close}`

The tRPC `Context` is minimal: just `{ request }` (`packages/api/src/context.ts`).
There is **no auth/session/user** in context — all procedures are `publicProcedure`,
and the only middleware is the `DEMO_MODE` mutation block in
`packages/api/src/index.ts`.

### Chat runtime (in-memory orchestration)
`packages/api/src/chat-runtime.ts` is a process-global `Map<chatId, ChatRuntime>`:
- Each runtime holds `configKey`, the current `ActiveChatStream`, an `abortCurrentRun`
  fn, a `pendingApprovals` map, a `finishedUnread` flag, and `touchedAt`.
- `ActiveChatStream` is a tiny pub/sub that **buffers every event** in an unbounded
  array and replays the whole buffer to each new subscriber (so a reconnecting socket
  sees the full run from the start).
- Idle runtimes are GC'd after a **15-minute TTL** (only when no active stream).
- Changing `configKey` (project + chat config) aborts the prior run and rebuilds the
  runtime, failing any pending approvals.
- Status snapshot derives `pending-approval > running > finished-unread`.

### Chat stream / run lifecycle
`packages/api/src/chat-stream.ts` (`startChatRun`):
1. Load chat + project; normalize chat config; if `branch` set, resolve worktree path.
2. Build `PiAgentSessionProject` (id, path, custom/append prompt).
3. Get/create the runtime keyed by `configKey = JSON.stringify({project, ...config})`.
4. Rehydrate a `SessionManager`: if `chats.agent_context` JSON has entries, **write a
   temp `.jsonl` session file** under `tmpdir()/g-spot-pi-agent-context/<chatId>.jsonl`
   and `SessionManager.open(...)` it; otherwise build `inMemory` from DB message history.
5. `loadProjectMcps(...)` (cached after first run per project).
6. `createPiAgentSession(...)` with MCP tools as custom tools.
7. Start the runtime stream (wiring `abort` → `session.abort()`).
8. Handle `/compact` specially (subscribe, compact, persist context, finish).
9. Persist the trigger user message (rejects if its id is already stored), then wrap
   `session.agent.beforeToolCall` to layer the permission/approval policy on top of any
   Pi extension hook.
10. Subscribe to session events: forward all to the stream; on `message_end` for
    assistant/toolResult, fire `saveChatMessage` (collected into `persistenceTasks`).
11. `sendUserMessage`, await persistence, persist serialized agent context, then on the
    first user turn fire `refreshChatTitle` + `extractChatTurnToMemory` (both async,
    unawaited). Always finish the stream + unsubscribe in `finally`.

The socket handler (`handleChatSocketMessage`) maps `attach` → subscribe to the running
stream, anything else → `startChatRun` then attach. Errors are published as
`gspot_error` events.

### Permission policy
`packages/api/src/lib/pi-permissions.ts` — pure `decidePermission(toolName, args,
config)` pipeline: sandbox → network → approval, returning `allow | block |
require-approval`. Network detection is a **regex heuristic** over the bash `command`
arg (curl/wget/git clone/package installs/etc.) — explicitly advisory, not a real
sandbox.

### Pi integration
`packages/api/src/lib/pi.ts` is the Pi adapter:
- `mergeAgentConfig` forces `transport: "websocket"`, parses via `piAgentConfigSchema`,
  dedupes/whitelists builtin tool names, falls back on parse failure.
- Credentials/defaults stored as JSON on the `pi_state` singleton; `AuthStorage` /
  `ModelRegistry` built `inMemory` from those creds per call (no caching of registry).
- `createPiAgentSession` builds a `SettingsManager`, `DefaultResourceLoader` (skills/
  extensions/themes/prompt-template discovery rooted at cwd, skippable via
  `disableProjectResources`), registers pending provider plugins, resolves+validates the
  model (`PiModelUnavailableError` for not-found / no-auth), and assembles the tool
  allowlist (builtins + custom MCP tools).

### Title worker
`packages/api/src/chat-title.ts` — only runs on the first user turn (`countUserMessages
=== 1`), uses the **worker** Pi config with **no tools** and `disableProjectResources:
true`, prompts for a short title, sanitizes it, and writes it **only if the latest user
message is still the trigger** (guards against racing a newer turn; polls up to 3x).

### Terminal runtime
`packages/api/src/terminal-stream.ts` (the largest file, ~950 lines):
- Process-global `sessions: Map<sessionId, TerminalSession>` plus an
  `openingSessions` promise map to dedupe concurrent opens, and `socketSessionIds`
  mapping socket → session.
- Spawns the user's login shell under `Bun.Terminal` (requires Bun ≥ 1.3.5; otherwise
  prints an error and closes). cwd = project path (else `homedir()`).
- Prefers `tmux` → `screen` (screen gated behind `GSPOT_ENABLE_SCREEN_TERMINALS=1`) →
  bare shell. Multiplexer session name = `gspot-<sha256(sessionId)[0:16]>`.
- Output is decoded with a custom incremental UTF-8 decoder (`TerminalOutputDecoder`)
  that handles partial multibyte sequences and maps C1 control bytes back to escape
  sequences. The shared `output` buffer is capped at **500 000 chars** (slice tail).
- Input bytes are forwarded raw to the PTY (Ctrl+C passed through, not converted to a
  signal, so TUIs like Claude Code keep their own interrupt handling); a separate `sig`
  message kills the process group (`process.kill(-pid, signal)` on non-Windows).
- Env injects `GSPOT_PROJECT_ID`, `GSPOT_TERMINAL_SESSION_ID`, and **cmux-compat**
  `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID`.
- Agent-resume: line-buffers input, detects `claude`/`codex` launches (handling `env
  VAR=...`, `bunx`/`npx`/`pnpm dlx`/`uvx` prefixes), and schedules binding capture at
  0/1/3/7s delays, writing to `~/.g-spot/terminal-agent-sessions.json`.

### tRPC routers
- `projects.ts` — list/get/create/update/updateAgentConfig/delete/chatCount. Path is
  validated/canonicalized on create and **immutable** thereafter (no `path` on update,
  enforced again in the db helper whitelist). `delete` refuses unless `force: true`
  when chats exist. Returns a parsed `Project` (agentConfig hydrated from project blob,
  falling back to user chat defaults).
- `chat.ts` — list/get/create/updateTitle/updateAgentConfig/delete/messages/
  replaceMessages/fork/deleteMessage/resolveToolApproval. Config inheritance lives in
  `create`. `messages` JSON-parses each row and tolerates corrupt rows by skipping them.
- `pi.ts` — catalog/defaults/updateDefaults/credentials/saveApiKey/removeCredential,
  full OAuth lifecycle, addon list/install/remove, popular/search catalog.
- `git.ts` — workspace/worktree/branch management + staging/diff/commit/conflict
  resolution (the worktree resolution feeding `branch`-scoped chat runs).

### DB layer
`packages/db/src/{chat,projects,pi}.ts` are thin Drizzle helpers over the schema in
`packages/db/src/schema/{chat,projects,pi}.ts`. Notable details:
- Timestamps are stored as **ISO strings**; sorting uses a `julianday`-based SQL
  expression to coerce them to epoch ms (`timestampSortValue`).
- `saveChatMessage` derives `createdAt` from the serialized message's own `createdAt`
  when present (falling back to now), and bumps `chats.updatedAt`.
- `replaceChatMessages` and `forkChat` run in transactions; `replaceChatMessages`
  **nulls `agent_context`** (forcing rehydration from message history next run).
- `pi_state` is a hard-coded singleton (`id = "singleton"`), upserted manually.

## Gaps & Rough Edges

- **No auth / multi-user / ownership.** Every procedure is `publicProcedure`; the only
  gate is `DEMO_MODE`. "Verify ownership" comments in `chat.messages` are aspirational
  — there's no owner to verify against.
- **All runtime state is in-process memory.** `chat-runtime` and `terminal-stream`
  hold sessions in module-level `Map`s. A server restart drops every running chat
  stream, every pending tool approval, and (for bare-shell terminals) the shell itself.
  Only tmux/screen-backed terminals survive a restart; chat runs do not.
- **Unbounded event buffer.** `ActiveChatStream.bufferedEvents` grows without limit for
  the life of a run and is fully replayed to each new subscriber — a very long run
  means large memory + a large replay on every reconnect. The 500k-char cap exists for
  terminals but not for chat streams.
- **Credentials stored in plaintext JSON.** Pi API keys and OAuth tokens live as plain
  text in the `pi_state.credentials` column. Acceptable for local-first, but it's a
  client-reachable surface (server is "client-facing" per repo rules) with no
  encryption-at-rest.
- **Network "sandbox" is a regex.** `pi-permissions` blocks network bash commands by
  string-matching `curl`/`wget`/etc. It explicitly cannot stop a script that opens a
  socket via python/node. There is no real OS-level sandbox; `workspace-write` relies
  purely on the agent's cwd being the project path (nothing prevents `../` escapes).
- **Agent-context rehydration writes a temp file per run.** Each run with stored context
  re-serializes the whole session into `tmpdir()/g-spot-pi-agent-context/<chatId>.jsonl`
  and reopens it. These temp files are never cleaned up, and the full context is
  re-written on every turn (`updateChatAgentContext` stores the entire serialized
  session each time — O(history) write growth).
- **Title/memory work is fire-and-forget and unbounded.** First-turn `refreshChatTitle`
  and `extractChatTurnToMemory` are spun up with `void` and spawn extra Pi sessions; no
  concurrency control, no cancellation if the chat is deleted mid-flight.
- **Status map is global and unscoped.** `chat/status/socket` broadcasts the entire
  `chatId → status` map to every connected client (no per-project filtering). Fine for
  one user/one machine; leaky by design otherwise.
- **`configKey` churn aborts runs.** Any change to project or chat config rebuilds the
  runtime and aborts the in-flight run + pending approvals. Editing config mid-run
  silently kills it.
- **Terminal resume is best-effort heuristics.** Resume relies on scraping
  `~/.claude`, `~/.codex`, and `~/.cmuxterm` transcript files and a fragile
  command-line parser (`detectAgentLaunch`). It silently no-ops on any unexpected shape.
  Inferred (vs stored) bindings kill and replace an existing multiplexer session, which
  can drop a live session.
- **No rate limiting / backpressure.** WebSocket sends are best-effort try/catch; a
  slow client doesn't apply backpressure to the PTY or the Pi stream.
- **Corrupt-data handling is silent skip.** Malformed stored messages/configs are
  dropped or fall back to defaults with at most a `console.error`; no surfacing to the
  user that history was lost.
- **`agent_config` / `agent_context` / credentials are untyped TEXT columns.** All
  validation happens at the application layer (Zod parse on read). A bad write or a
  schema drift in Pi's `SessionEntry` shape would only fail at parse time.

## Key Files

- `/Users/barreloflube/Desktop/g-spot/packages/api/src/chat-runtime.ts` — in-memory run/approval/status orchestration.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/chat-stream.ts` — chat run lifecycle + WS handlers + permission gate wiring + persistence.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/terminal-stream.ts` — PTY/tmux/screen bridge + agent-session resume.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/chat-title.ts` — first-turn title worker.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/lib/pi.ts` — Pi adapter (config merge, session creation, model resolution, credentials).
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/lib/pi-permissions.ts` — sandbox/network/approval policy.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/routers/{chat,projects,pi,git}.ts` — tRPC surface.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/routers/index.ts` — `appRouter` composition.
- `/Users/barreloflube/Desktop/g-spot/packages/api/src/context.ts` + `index.ts` — minimal context + DEMO_MODE gate.
- `/Users/barreloflube/Desktop/g-spot/packages/db/src/{chat,projects,pi}.ts` — Drizzle helpers.
- `/Users/barreloflube/Desktop/g-spot/packages/db/src/schema/{chat,projects,pi}.ts` — SQLite schema.
- `/Users/barreloflube/Desktop/g-spot/apps/server/src/index.ts` — Elysia HTTP + WS route wiring.
- `/Users/barreloflube/Desktop/g-spot/apps/web/src/routes/agent/$projectId.tsx` — project shell (panels, ⌘P search) — client consumer of this layer.
