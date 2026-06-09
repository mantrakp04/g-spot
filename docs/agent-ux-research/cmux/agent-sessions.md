# cmux — Agent Sessions

Research bucket: **agent-sessions**. Scope: AI agent session lifecycle — launch plan, session provider,
renderer kind, executable resolution, fork support, hibernation, agent vault/auth runtime.

> Source: `/tmp/cmux-analysis` (Ghostty-based macOS terminal for AI coding agents, Swift/AppKit/SwiftUI).
> Most logic here is **portable concepts** (process lifecycle, resume/fork command construction, env
> sanitization, hibernation policy) wrapped in platform-specific plumbing (`Process`, `WKWebView`,
> `DispatchSource`). For a React/web app the *algorithms and edge-case handling* are the gold; the
> AppKit/WebKit hosting is not.

---

## Overview

cmux runs coding agents in two distinct surfaces:

1. **Terminal-hosted agents** (the main product): an agent CLI (`claude`, `codex`, `opencode`, plus a long
   tail — grok, gemini, cursor-agent, amp, copilot, factory/droid, kiro, qoder, rovodev, hermes, pi,
   antigravity, codebuddy) runs inside a Ghostty terminal surface. cmux *observes* these via hooks +
   process scanning, builds **resume** and **fork** commands for them, and **hibernates** idle ones to cap
   live terminals. State lives in JSON "hook store" files + live process scans, indexed by
   `RestorableAgentSessionIndex`.

2. **GUI agent sessions** (`AgentSession*` panel family): cmux *itself* spawns a provider process
   (`codex app-server`, `claude -p --output-format stream-json`, `opencode serve`) and drives a custom
   **WebView GUI** (React or Solid renderer) over a JS bridge. This is the chat-style embedded agent
   experience, distinct from the terminal path.

There are really **three concerns** layered together:
- **Launch / resolution**: find the executable, build the argv + sanitized environment.
- **Restore (resume/fork)**: reconstruct a runnable shell command for an existing session, getting the
  *working directory* and *hook wrapper routing* exactly right.
- **Lifecycle management**: hibernate idle agents, drain/terminate processes safely, track activity.

Auth (`CmuxAuthRuntime`) is a separate, injected, cross-platform (iOS+macOS) auth orchestrator for the
*app's* account (Stack Auth), not the agents' own provider auth.

---

## Features & UX

### GUI agent sessions (embedded WebView)
- **Three providers** selectable per panel: Codex, Claude Code, OpenCode (`AgentSessionProviderID`).
- **Two renderers**: React and Solid (`AgentSessionRendererKind`). A `#if DEBUG` menu
  (`AgentSessionDebugMenuButtons`) exposes "Open Agent GUI (React)" / "Open Agent GUI (Solid)" so devs can
  A/B the two front-ends against the same backend.
- **Provider-specific auto-start**: Codex and OpenCode auto-start a session; Claude does not
  (`shouldAutoStartSession`) — Claude waits for the first user turn.
- **Permission modes** per turn (`AgentSessionPermissionMode`): `standard` (default), `auto-review`,
  `full-access`, `custom`. These map to Codex turn overrides (`approvalPolicy`, `approvalsReviewer`,
  `sandboxPolicy: dangerFullAccess` for full access) — a concrete, portable model for "how much can the
  agent do this turn."
- **Streaming output**: Claude streams `stream-json` JSONL; Codex speaks JSON-RPC over stdio; OpenCode runs
  an HTTP loopback server and cmux consumes its SSE event stream. All normalize into a single
  `provider.output` / `provider.activity` / `provider.turnComplete` / `provider.exit` event vocabulary sent
  to the WebView.
- **Theme-aware**: renderer theme derived from Ghostty config; theme changes pushed into the loaded page
  live.

### Terminal agent restore (resume / fork)
- **Resume**: rebuild `<agent> --resume <id>` (verb varies per agent) and feed it to a fresh terminal so a
  prior conversation continues — even after app restart or crash.
- **Fork**: where supported, branch a session (`claude --resume <id> --fork-session`, `codex fork <id>`,
  `opencode --session <id> --fork`). Fork availability is gated and, for OpenCode, **version-probed**
  (`AgentForkSupport`, min `1.14.50`).
- **Drag-and-drop image previews** into the GUI session (size-capped: 512 KB/image, 2 MB total).

### Hibernation (the headline lifecycle UX)
- Caps the number of **live agent terminals** (`maxLiveTerminals`). Beyond the cap, the **least-recently
  active, idle** agents are hibernated: their processes are killed but the session remains **restorable**
  (resume command preserved), so reopening the panel transparently resumes.
- **Never hibernates**: the visible/focused panel, agents that are `running`/`needsInput` (only `idle`
  hibernates), agents with **unconfirmed terminal input** (user typed but agent hasn't reacted), or
  manually protected panels.
- **Confirmation window**: a candidate must stay idle *and* its terminal tail must be unchanged for
  `confirmationSeconds` before it's actually killed — prevents hibernating something that's about to wake.

---

## Implementation

### Provider model — `AgentSessionProvider.swift`
`AgentSessionProviderID` (enum: codex/claude/opencode) is the single source of truth for each provider's
**launch contract**: `executableName`, `launchArguments`, `transportKind` (`stdio-jsonrpc` /
`stdio-jsonl` / `http-loopback`), and `shouldAutoStartSession`. Adding a provider = one enum case.

### Launch plan — `AgentSessionLaunchPlan.swift`
A value type `{ provider, executableURL, arguments, environment }`. `environment(overridingWorkingDirectory:)`
injects `PWD` and, for OpenCode, **generates a random server username/password** (`OPENCODE_SERVER_PASSWORD
= "<uuid>-<uuid>"`) when none is set — so the loopback HTTP server isn't open to other local processes.

### Executable resolution — `AgentExecutableResolver.swift`
Resolves a provider name → concrete executable URL + a runtime `PATH`. Search order:
1. Explicitly configured path (e.g. custom Claude path from settings).
2. `PATH` entries, then `extraSearchDirectories`, then a curated set of **user runtime dirs**
   (`~/.local/bin`, `~/.bun/bin`, `~/.nvm/...`, `~/.volta/bin`, `~/.fnm/...`, mise/asdf shims, `~/bin`),
   then standard dirs (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`).
3. Node version dirs are enumerated and **sorted newest-first** (numeric, case-insensitive compare).

The chosen executable's directory is **hoisted to the front of the runtime PATH** so the agent's sibling
tools resolve correctly. Missing executable → `AgentExecutableResolverError.missing(displayName,
executableName, searchedDirectories)` with a user-facing localized message.

### Restore index — `RestorableAgentSession.swift` (~1700 lines, the core)
`RestorableAgentSessionIndex` reconstructs restorable sessions from two sources merged:
- **Hook store files** per agent kind (JSON: `RestorableAgentHookSessionStoreFile` → records with
  sessionId, workspaceId, surfaceId, cwd, transcriptPath, pid, launchCommand, lifecycle, updatedAt).
- **Live process detection** (`processDetectedSnapshots` via `CmuxTopProcessSnapshot`) — finds running
  agents even without a hook record.

Records are keyed by `(workspaceId, panelId)` with a panelId-only fallback. The builder validates that a
record is genuinely restorable (e.g. for Claude, that the `.jsonl` transcript actually exists and is
non-empty) and that any recorded `pid` is a **live, scope-matched** process.

`SessionRestorableAgentSnapshot` exposes `resumeCommand` / `forkCommand` (built by
`AgentResumeCommandBuilder`) and produces **startup input** to feed a terminal: inline if small, else
written to a **self-deleting launcher script** (`AgentResumeScriptStore`, `0700` dir / `0600` script, 24h
TTL, pruned on write).

### Resume/fork command construction
- **`AgentResumeArgv`** (in `CMUXAgentLaunch`): pure, testable argv builder shared between the app and the
  CLI surface-restore publisher — "single source of truth" so both emit identical commands. Resolution
  order: cmux *wrapper launcher* (`claudeTeams`/`codexTeams`/`omo`/`omx`/`omc`) → custom Vault agent → per-kind
  verb. Handles ~17 agent kinds with their idiosyncratic resume verbs (`codex resume`, `amp threads
  continue ... <id>`, `kiro chat --resume-id`, `rovodev rovodev run --restore`, `hermes ... --resume <id>`).
- **`AgentResumeCommandBuilder`** (app side): wraps argv into a full shell command — prepends sanitized
  `env KEY=VAL` parts, sanitizes saved-cwd options, and prefixes a guarded `cd`.
- **`AgentLaunchSanitizer`** + policies: strips non-portable runtime flags and per-kind unsupported options
  from captured argv before replay.

### Environment policy — `AgentLaunchEnvironmentPolicy.swift`
A strict **allowlist** of "safe" env keys to replay on resume (base URLs, config dirs, model selection,
log levels). Notably:
- **Secrets are NOT allowlisted** — `AMP_API_KEY` is explicitly excluded with a comment ("Amp resolves auth
  from `~/.config/amp/settings.json` on resume"). Same pattern for Anthropic keys: only base URL/model are
  replayed; the actual API key is never carried in the replayed command.
- `NODE_OPTIONS` is **sanitized** to strip cmux's own injected `--require .../restore-node-options.cjs` and
  the injected `--max-old-space-size=4096` heap cap, so resumes don't re-inject cmux internals.
- `CLAUDE_CONFIG_DIR` is normalized via `ClaudeConfigDirectoryPath.preferredPath` (legacy
  `.subrouter/codex/claude` → `.codex-accounts/claude` migration).

### Working-directory resolution — `AgentCwdNamespacing.swift` + `AgentResumeWorkingDirectory.swift`
Central insight encoded as a type: agents fall into two classes.
- **`byDirectory`** (Claude + grok/pi/gemini/cursor/qoder + *unknown kinds*): the session store is keyed by
  the launch cwd. Resume MUST run from that exact dir or it fails "No conversation found." → pin the **launch
  cwd**, not the drifted runtime cwd. For Claude, cmux *verifies* which candidate dir actually holds the
  transcript.
- **`cwdInFile`** (codex/opencode/amp/antigravity/rovodev/hermes): session keyed by id, cwd stored inside the
  file → keep the **runtime cwd** so the agent reopens where it was working.

### Fork support — `AgentForkSupport.swift`
`supportsFork(snapshot:isRemoteContext:)` gates fork. For OpenCode it shells out `opencode --version`,
parses a `SemanticVersion`, and compares against `1.14.50`. The version probe result is **cached**
(`OpenCodeVersionProbeCache` actor) keyed by executable+args+relevant-env+cwd.

The `CommandOutputRunner` is a hardened subprocess wrapper (see Hardening) — it runs the probe with a 3s
timeout, 0.5s SIGTERM→SIGKILL escalation, and full cancellation support.

### GUI session process store — `AgentSessionProcessStore.swift` (`@MainActor`)
Owns at most one live `AgentSessionRunningSession`. Spawns the provider `Process` with stdin/stdout/stderr
pipes, an actor-backed `AgentSessionInputWriter`, and provider-specific glue:
- **Codex**: `CodexAppServerSession` (JSON-RPC); writes user turns with permission-mode overrides.
- **Claude**: writes `{type:"user", message:{...}}` JSONL to stdin; parses streamed deltas, detects
  turn-complete.
- **OpenCode**: parses the "opencode server listening on <url>" line, creates a session over HTTP, then
  consumes an SSE event stream; prompts via `POST .../prompt_async`.

Output is normalized into `eventSink` events forwarded to the WebView. `activeProviderSink` emits only on
*change* (deduped via `lastEmittedHasActiveProviderSession`).

### WebView host — `AgentSessionWebRendererCoordinator.swift` (AppKit/WebKit, ~756 lines)
`WKWebView` + `WKScriptMessageHandlerWithReply` bridge (handler name `agentSession`). Loads a bundled local
HTML shell (React: `markdown-viewer/webviews-app/agent-session.html`; Solid:
`agent-session-solid/index.html`) via `loadFileURL` with read access scoped to the resource dir. Tracks
`hasFinishedNavigation` / `hasCompletedVisiblePaintFlush` / `isPanelFocused` / `isClosed` /
`trustedShellURL`. `#if DEBUG` toggles WebView inspectability. **This is the most platform-specific piece**
— in a web app the renderer *is* the app, so most of this hosting layer collapses away.

### Hibernation — `App/AgentHibernationController.swift` + `AgentHibernation/AgentHibernationLifecycleState.swift`
- `AgentHibernationLifecycleState`: `unknown` / `running` / `idle` / `needsInput`; only `idle`
  `allowsHibernation`. Lenient decode (unknown → `.unknown`), and `parseCLIValue` normalizes `needs-input`
  ↔ `needsinput`.
- `AgentHibernationPlanner.selectedPanelKeys`: **pure function** — given inputs + settings, returns which
  panels to hibernate. Picks the *excess* over `maxLiveTerminals`, filtered to eligible (idle, not
  protected, no unconfirmed input, idle ≥ `idleSeconds`), sorted oldest-activity-first with a
  **deterministic UUID tiebreaker**.
- `AgentHibernationController` (`@MainActor` singleton): a 30s `DispatchSourceTimer` (5s initial delay)
  loads the index on a detached utility task, then evaluates on the main actor. Tracks per-panel activity,
  terminal input, lifecycle change times. Two-phase commit via `Confirmation` (fingerprint + dueAt) and a
  `TailFingerprintSample` of the terminal's last 12 lines.

### Agent Vault — `CMUXAgentVault`
Indexes/searches an agent's *own* session DB for the resume picker. `HermesAgentIndex` reads Hermes
`state.db` (SQLite) for sessions/transcripts. `CmuxVaultAgentRegistry` / `CmuxVaultAgentRegistration` hold
**custom agent definitions** (name, default executable, resume command template with `{{sessionId}}`,
`{{cwd}}`, `{{sessionDir}}` placeholders, and a `cwd` policy: `.preserve`/`.ignore`).

### Auth runtime — `CmuxAuthRuntime`
`AuthCoordinator` (`@MainActor @Observable`) — injected, no-singleton, cross-platform orchestrator for the
*app account* (Stack Auth). Owns `isAuthenticated`/`currentUser`/`isLoading`/`isRestoringSession`/
`availableTeams`/`selectedTeamID`. All collaborators (client, token/identity/team stores, presentation
anchor, config, launch options) injected at composition root → fully testable with fakes. `resolvedTeamID`
falls back to first available team if the persisted selection is no longer valid.

---

## Hardening & Lessons

These are the battle scars — the highest-value transferable knowledge.

### Process lifecycle races
- **`ProcessTerminationGate`** (`AgentForkSupport.swift`): explicitly coordinates cancellation with
  `Process.run()` because *"Foundation raises an Objective-C exception if termination APIs touch a task
  before launch."* Tracks `didLaunch`/`didFinish`/`terminationRequested` under a lock so a
  cancel-before-launch doesn't crash. **Lesson: a kill request can arrive before the process exists; gate it.**
- **SIGTERM → SIGKILL escalation everywhere**: fork probe (0.5s), GUI session store (3s repeating
  `terminationEscalationTimer`). Never trust `terminate()` alone.
- **Kill the process group, not just the pid**: hibernation's `terminateScopedProcessesForHibernation`
  signals `-pgid` (SIGTERM to the group) before the pid, guarding against signaling its own group/pid
  (`pid != currentProcessID`, `pgid != currentProcessGroupID`, `pgid > 1`).
- **Exit + drain ordering**: `finishSessionIfExitedAndDrained` waits for *both* the termination handler AND
  stdout/stderr EOF before emitting `provider.exit` — so the final bytes aren't lost. Drained streams
  tracked in a set; identity re-checked (`sessions[id] === session`) before every mutation to avoid acting
  on a replaced session.

### Resume correctness (each is a fixed production bug)
- **Hook wrapper routing** (issue #5427, cited in code twice): Claude resume/fork **must** route through the
  bare `claude` wrapper (first on PATH), NOT the captured real binary, or cmux's injected hooks silently
  drop. The captured `CMUX_AGENT_LAUNCH_EXECUTABLE` is *intentionally ignored* for Claude.
- **cwd drift** (`AgentCwdNamespacing` doc): the hook-reported `cwd` drifts when an agent `cd`s mid-session
  (repo root → worktree). Trusting it breaks resume for directory-namespaced agents. Fix: pin the stable
  launch cwd for `byDirectory` kinds; for Claude, *verify* against the transcript's actual storage path.
- **Claude project-dir encoding** (commented bug): Claude maps a project dir by replacing **both `/` and
  `.`** with `-`. Missing the `.` case "sent dotted paths to the wrong project directory."
- **Surface identity vs focus** (issue #4920, "codex jumble after reload"): a launcher inherits its *launch*
  surface but queries the daemon for the *focused* pane. `AgentSpawnIdentity` stamps the launch surface, not
  the focused pane, and only ever produces a **coherent (workspace, surface) pair** — leaving surface `nil`
  rather than emitting an impossible cross-workspace pair the daemon would reject (dropping the hook).
- **Resume must verify the session still exists**: Claude records aren't restorable unless the `.jsonl`
  transcript file exists *and is non-empty*; recorded pids only count if the live process matches scope and
  kind (special-casing `node`/`bun` wrappers running claude).
- **`.ignore` cwd policy**: custom agents that resume "from current directory" must carry **no saved cwd at
  all** in the snapshot, because downstream restore consumers read `workingDirectory` directly, not just the
  command builder.

### Security / secret handling
- **Allowlist, not denylist, for replayed env** — and secrets are explicitly excluded with comments
  (`AMP_API_KEY`). Agents re-resolve their own auth from disk on resume.
- **OpenCode loopback server gets a random per-launch password**; server URL is validated to be loopback
  (`agentSessionIsLoopbackURL`) before cmux talks to it.
- **Launcher scripts**: `0700` dir, `0600` file, self-delete (`rm -f -- "$0"`), TTL-pruned.
- **Shell quoting** (`TerminalStartupShellQuoting`): non-ASCII bytes are emitted via
  `"$(printf '\NNN...')"` octal escapes rather than naive quoting — robust against arbitrary unicode in
  paths/args. Single-quote escaping uses the canonical `'\''` dance.

### Hibernation anti-flapping
- **Two-phase confirmation**: never hibernate on the first idle observation. Require a stable terminal-tail
  **fingerprint** (last 12 lines + sorted pid set) held for `confirmationSeconds`; any new activity (input,
  lifecycle change, fingerprint change) **resets** the confirmation.
- **Tail fingerprint stability** (`tailFingerprintStableSince`): treats a session that *looks* idle but
  whose scrollback is unchanged as "stable since first seen," so a long-quiet-but-not-yet-killed agent
  eventually ages out — without killing one mid-stream.
- **Process-fallback fingerprint**: when there's no live surface but a live process, fingerprint by
  kind+sessionId+pids so backgrounded agents are still trackable.
- **Deterministic tiebreak**: equal-activity candidates ordered by UUID string — no nondeterministic kill
  selection.
- **Aggressive state pruning**: tracking dicts pruned to currently-present panels every tick; confirmations
  pruned to current ∩ selected. Tracking gated by `AgentHibernationTrackingGate` so it's a no-op when
  disabled.
- **Visible-panel protection** is computed per current layout (`agentHibernationVisiblePanelIdsForCurrentLayout`)
  and only when the window is actually visible.

### Subprocess probe robustness (`CommandOutputRunner`)
- Locked, `@unchecked Sendable` buffers; handles `wouldBlock` vs `endOfFile` from pipes
  (`ProcessPipeReader`); cancels timers and nils handlers on finish; double-checks `completed`/`timedOut`
  flags at every await boundary; reads remaining pipe data on finish so output isn't truncated.
- **Sanitized probe environment**: only a small base key set (`HOME`, `LANG`, `PATH`, …) plus the policy
  allowlist; PATH defaulted to a sane fallback if absent. Avoids leaking the full app env into a child.

### Input backpressure
- `AgentSessionInputWriter` (actor): bounded **1 MB queue**; over-limit or post-close writes fail fast
  rather than buffering unbounded; serial drain on a utility task; a write failure closes the writer and
  fails all queued writes. **Lesson: bound your agent-input queue.**

### Crash/restart restore
- The entire restore index is rebuilt from on-disk hook stores + live process scans on demand — no
  in-memory session state is required to survive a crash. Live processes are *reattached* to panels by
  scope-matching env (`CMUX_WORKSPACE_ID`/`CMUX_SURFACE_ID`/`CMUX_AGENT_LAUNCH_KIND`).
- Hermes index reads a **WAL snapshot copy** (`state.db` + `-wal`/`-shm`) into a temp dir and opens it
  read-only with a 50ms busy timeout — never touches the live DB the agent is writing.

---

## Portability call-outs (for the React/web app)

**Portable concepts (port these):**
- Provider contract enum (executable/args/transport/auto-start) as the single source of truth.
- Per-turn **permission modes** mapped to provider-specific policy overrides.
- **Resume/fork command builders** as pure, testable functions shared across surfaces.
- **Env allowlist with secrets excluded**; agents re-auth from disk on resume.
- **cwd-namespacing classification** (launch-cwd vs runtime-cwd) — directly applicable to any resume feature.
- **Hibernation planner** as a pure function + two-phase confirmation to prevent flapping.
- **Bounded input queue** with fail-fast backpressure.
- Normalized event vocabulary (`output`/`activity`/`turnComplete`/`exit`) regardless of transport.
- Injected, no-singleton **auth coordinator** with observable state and fake-driven tests.

**Platform-specific (rethink/drop):**
- `Process`/`Pipe`/`DispatchSource`/SIGTERM-SIGKILL plumbing → server-side child-process management
  (Node `child_process`, signals) or a daemon; the *escalation/gate/drain logic* still applies.
- `WKWebView` + `WKScriptMessageHandler` bridge → in a web app the renderer is native; the JS bridge
  collapses to direct function calls / a WebSocket to the backend.
- macOS PATH search dirs, `.app` bundle detection, AppKit window/focus tracking, Ghostty theme — replace
  with your platform's equivalents.
- The React-vs-Solid debug toggle is a cmux-internal renderer experiment, not a user feature.

---

## Key Files

| File | Role |
| --- | --- |
| `Sources/AgentSessionProvider.swift` | Provider enum: executable/args/transport/auto-start contract |
| `Sources/AgentSessionLaunchPlan.swift` | Launch plan value type; PWD + OpenCode server-password injection |
| `Sources/AgentSessionRendererKind.swift` | React/Solid renderer enum + bundled HTML paths |
| `Sources/AgentSessionDebugMenuButtons.swift` | `#if DEBUG` menu to open React/Solid agent GUI |
| `Sources/SessionAgentSessionPanelSnapshot.swift` | Persisted panel snapshot (renderer, provider, cwd) |
| `Sources/AgentExecutableResolver.swift` | PATH/runtime-dir search → executable URL + runtime PATH; rejects cmux shims/wrappers |
| `Sources/AgentExecutableResolverError.swift` | Localized "executable not found" error |
| `Sources/AgentForkSupport.swift` | Fork gating, OpenCode `--version` probe + cache, hardened subprocess runner, `ProcessTerminationGate` |
| `Sources/RestorableAgentSession.swift` | Core: resume/fork command builder, restore index, cwd resolution, launcher-script store, shell quoting |
| `Sources/App/AgentHibernationController.swift` | Hibernation controller + pure planner + records gathering |
| `Sources/AgentHibernation/AgentHibernationLifecycleState.swift` | Lifecycle enum (idle gates hibernation) + allowed status keys |
| `Sources/Panels/AgentSessionProcessStore.swift` | GUI session process owner; spawns provider, normalizes events, term escalation |
| `Sources/Panels/AgentSessionBridge.swift` | Bridge handler name + loopback URL check |
| `Sources/Panels/AgentSessionInputWriter.swift` | Actor input writer with bounded 1 MB queue |
| `Sources/Panels/AgentSessionPermissionMode.swift` | Per-turn permission modes → Codex turn overrides |
| `Sources/Panels/AgentSessionWebRendererCoordinator.swift` | WKWebView host + JS bridge (most platform-specific) |
| `Packages/CMUXAgentLaunch/.../AgentResumeArgv.swift` | Pure resume argv builder, ~17 agent kinds, shared app+CLI |
| `Packages/CMUXAgentLaunch/.../AgentResumeWorkingDirectory.swift` | Pure resume-cwd resolver (launch vs runtime cwd) |
| `Packages/CMUXAgentLaunch/.../AgentCwdNamespacing.swift` | byDirectory vs cwdInFile classification + rationale |
| `Packages/CMUXAgentLaunch/.../AgentSpawnIdentity.swift` | Launch-surface vs focused-pane identity stamping (#4920) |
| `Packages/CMUXAgentLaunch/.../AgentLaunchEnvironmentPolicy.swift` | Env allowlist (secrets excluded), NODE_OPTIONS sanitize, CLAUDE_CONFIG_DIR normalize |
| `Packages/CMUXAgentLaunch/.../AgentLaunchSanitizer*.swift` | Per-kind argv sanitization policies |
| `Packages/CMUXAgentVault/.../HermesAgent/HermesAgentIndex.swift` | Read-only WAL-snapshot SQLite index of Hermes sessions |
| `Packages/CMUXAgentVault/.../RovoDev/RovoDevIndex.swift` | RovoDev session index |
| `Packages/CmuxAuthRuntime/README.md` + `Coordinator/AuthCoordinator.swift` | Injected cross-platform app-account auth orchestrator |
