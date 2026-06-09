# cmux vs g-spot agents — Comparison & Improvement Plan

> Synthesis of `docs/agent-ux-research/cmux/*.md` (mature native macOS terminal for AI agents)
> against `docs/agent-ux-research/gspot/*.md` + the live g-spot source. Goal: drive clean, scoped,
> *web-appropriate* improvements. **g-spot is local-first desktop+CLI, not multi-tenant SaaS** —
> we deliberately ignore SaaS/edge/cost concerns and most AppKit-only mechanics.
>
> Terminology bridge: in cmux a sidebar **"tab" == a Workspace** (a directory + its panes). In
> g-spot a **"project" == a workspace**, and tabs are *surfaces inside* one project's pane tree
> (chat/terminal/file/diff). So cmux's "workspace sidebar" maps to g-spot's *project list*
> (`AiSidebar`), and cmux's "pane tab strip" maps to g-spot's `PaneTabStrip`. Keep this mapping in
> mind reading the matrix — several cmux "workspace" features are really g-spot *project-list*
> features, and several are *pane* features.

---

## 1. Side-by-side feature matrix

Severity = how much the gap hurts g-spot's stated priorities (perf, reliability, predictable under
failure). **High** = correctness/robustness hole or major UX deficit; **Med** = real friction;
**Low** = polish / nice-to-have / arguably out of scope for local-first.

### Tabs (sidebar workspace rows ↔ g-spot project list + pane tab strip)

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| One row per workspace, ordered, selectable | Yes (vertical sidebar) | Project list in `AiSidebar`; pane tab strip per leaf (`PaneTabStrip`) | — |
| Per-row unread / "needs attention" | Yes (counts, sum-when-collapsed) | Partial: finished-chat tab highlight via `subscribeChatRuntimeFinished` + pane glow; no project-level rollup | Med |
| Cmd+digit jump-to-workspace + hint pills | Yes | No | Low |
| Pin / unpin (clamped leading block) | Yes (heavy invariant) | No | Low |
| Per-workspace custom color / rename / description | Yes | Chat rename exists; no color | Low |
| Multi-select rows + batch actions | Yes (anchor + shift-range) | No | Low |
| Drag-to-reorder rows + drop indicator + auto-scroll | Yes | Tabs reorder within/between panes via dnd-kit; project rows not reorderable | Med (tabs ok) |
| Cross-window drag | Yes | No (single localStorage workspace, no multi-window coord) | Low (local-first) |
| Move surface to new workspace ("break") | Yes (atomic, rollback) | No — surfaces only move between existing panes | Med |
| Close + Close Others/Above/Below + confirm dialog | Yes | Close tab / close pane only; no "close others", no confirm | Med |
| **Restore-closed-item history (Cmd-Shift-T)** | Yes (panel/workspace/window, persisted) | **No** | **High** |
| Tab context menu (close others, pin, color, move) | Yes | **None** (only hover X + middle-click) | Med |
| Tab overflow handling | Scrollable + reorder | Horizontal scroll only; no overflow dropdown | Low |

### Splits & panes

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Split 4 directions, nested binary tree | Yes (Bonsplit) | Yes (`tabs-store.ts` pure tree ops) | — |
| Drag-to-split with edge/center drop zones | 5 zones, 25%/80pt bands, adjacency suppression | 4 edge quarters + center; fixed quarter regions; no adjacency suppression | Med |
| Animated drop overlay w/ generation-guarded cancel | Yes | `PaneDropPreview` (sky overlay), no generation guard | Low |
| Divider clamp (no zero-collapse) | [0.1,0.9] | `minSize={15}` hardcoded percent | Low |
| Equalize splits (leaf-weighted) | Yes (`Ctrl+Cmd+=`) | No | Low |
| **Persist nested split sizes across reload** | Yes | **No** — inner `ResizablePanelGroup` has no storage wiring; only shell-level split persists | **High** |
| Surgical "layout changed" versioning (diff before notify) | Yes (`paneLayoutVersion`) | Derived `tabLayoutAtom` recomputes; no explicit change-diff guard | Med |
| In-place repair of emptied container (no flicker) | Yes (`placeholderRepair`) | `collapsePane` merges into sibling | Low (close path ok) |
| Keep focused panel visible during reparent | Yes (`panelVisibleInUI`) | Panes stay mounted; dnd active drag may intercept | Low |
| Gate destructive shortcuts on "focused el live & laid out" | Yes | `TabShortcuts` fires globally on capture phase | Med |

### Workspaces (project shell)

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Workspace-as-tab w/ rich metadata (branch/PR/ports/status) | Yes | Project has path + chats; branch via chat worktree config; no port/PR/status badges in shell | Med |
| Background priming of hidden workspaces (instant switch) | Yes (2s timeout) | Terminals are module singletons (survive unmount); chats not pre-warmed | Low |
| Detached live-surface transfer (move running agent/PTY) | Yes (transactional + rollback) | Tabs move between panes but a chat tab is just an id; terminal singleton survives | Med |
| Reveal-in-Finder / open externally | Yes (off-main exists-check, beep) | `external-url.ts` exists; no reveal-in-folder for project | Low |
| iMessage float-to-top on prompt submit | Yes | No | Low |
| Live theming for embedded surfaces, deferred while hidden | Yes (diffed signature) | **Terminal theme read once at creation, never re-read on theme change** | Med |
| Strict config validation (hard-fail bad shapes) | Yes | Mixed: Pi config falls back on parse failure; `agent_config` untyped TEXT | Med |
| Stale-ID re-validation at dispatch | Yes (`liveWorkspaceIds`) | `useNormalizeTabLayout` prunes dead tabs/panes; menus not re-validated | Low |

### Workspace groups

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Collapsible groups, anchor-as-header model | Yes (flat list + `groupId` + parallel array) | **No grouping at all** | Med |
| Per-group color/icon, cwd-config fallback | Yes | No | Low |
| Drag-into-group (center band) vs reorder (edge) | Yes | No | Low |

> Grouping is the lowest-priority bucket for g-spot: there's no project-grouping demand yet and the
> project list is short. Captured for completeness; the *anchor-as-header* model is the portable
> idea if/when it's wanted.

### Command palette

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Single field, dual scope (`>` = commands, else switcher) | Yes | **Only file search** (`⌘P`); no command scope, no surface switcher | **High** |
| Context-aware commands (when/enablement predicates) | Yes (registry + handler split) | No command registry | High |
| Tiered fuzzy scoring (exact>prefix>word>contains>initialism>typo) | Yes (Rust + Swift oracle) | Flat scorer: exact 80 / prefix 50 / substring 30 / path 10 (`scoreFile`) | Med |
| Multi-token AND, metadata keywords (branch/port/dir) | Yes | Multi-term AND over name+path only | Med |
| Match highlighting | Yes | No | Low |
| Usage-history boost | Yes | No | Low |
| Async race discipline (request IDs, version guards) | Yes (heavy) | `useDeferredValue` only; single in-memory pass | Low (small corpus) |
| Switch-to-chat / switch-to-tab from palette | Yes (switcher scope) | No (only via `AiSidebar` tree / `HistoryPopover`, latter unwired) | Med |

### Sidebar / tool panels

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Right sidebar, switchable modes, persisted state | files/find/sessions/feed/dock | files/changes/terminal, persisted (`rightSidebarTabAtom`); all mounted; collapse rail; L/R swap | — (parity-ish) |
| "Open tool as pane" promotion (reuse-or-focus) | Yes | No | Med |
| Keyboard nav inside sidebar (j/k, /, esc-to-content) | Yes | Changes panel has arrow/enter/space; tree has none | Med |
| Live count badge on a mode (pending/unread) | Yes (Feed pending chip) | No | Low |
| **Config-driven dock w/ trust gate (RCE guard)** | Yes (fingerprinted trust) | No dock; but terminal runs arbitrary shell already (local-first) | Low |
| Centralized panel teardown (one drain fn) | Yes (`discardClosedPanelLifecycleState`) | Tab close path; terminal-session map cleanup; no single drain across all per-tab state | Med |

### Agent sessions

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Multiple providers w/ launch contract enum | Yes (codex/claude/opencode +tail) | Single Pi runtime (multi-provider *via* Pi); terminal CLI resume for claude/codex | — (different model) |
| Per-turn permission modes | Yes (standard/auto-review/full/custom) | Yes: plan/default/auto/bypass presets + `decidePermission` gate | — |
| Streaming normalized to one event vocabulary | Yes | Yes (Pi `AgentSessionEvent` over WS, per-rAF coalesced store) | — |
| Tool approval gate (block on decision) | Yes (Feed, re-checked each hop) | Yes (`chat.resolveToolApproval` resolves a promise) | — |
| Resume across restart/crash | Yes (rebuilt from disk index) | **Partial**: chat context in SQLite but **in-memory runtime + pending approvals lost on restart**; terminal only survives via tmux/screen | **High** |
| Fork / branch sessions | Yes (version-probed) | Yes (`chat.fork`) | — |
| **Resume via structured metadata (not regex)** | Yes (hook stores, cwd-namespacing) | **Brittle**: `inferResumeAgent` greps scrollback for "claude"/"codex"; terminal-stream scrapes transcript files | **High** |
| Env replay allowlist (secrets excluded) | Yes | N/A (Pi re-auths from `pi_state`); credentials plaintext | Med |
| Hibernation / idle eviction of agent runtimes | Yes (pure planner + 2-phase) | Only a 15-min idle TTL GC; no cap, no liveness-tied expiry | Med |
| Bounded agent input/event queue | Yes (1MB fail-fast) | **`ActiveChatStream` buffers events unbounded**, replays whole buffer to each subscriber | **High** |
| Pending-approval lifetime tied to producer liveness | Yes (kqueue per PID) | Approvals fail on configKey churn / runtime GC; not tied to run liveness | Med |
| cwd-namespacing (launch vs runtime cwd) for resume | Yes (typed) | Worktree path resolved per run; no launch-vs-runtime distinction | Low |

### Notifications & state

| Capability | cmux | g-spot today | Gap |
| --- | --- | --- | --- |
| Per-workspace/per-pane unread indicators | Yes | Per-tab finished highlight + pane glow | Med |
| Focused-read suppression (don't toast what you're viewing) | Yes | Highlight cleared on focus; no toast system to suppress | Low |
| Typed `(source,event)→semantic` classifier (read-only never prompts) | Yes (#4985 fix) | Side-effecting/MCP → approval via `decidePermission`; not a typed event classifier but functionally close | Low |
| Re-validate "still relevant?" at every async hop | Yes | Title worker re-checks latest user msg id; approvals partially | Med |
| Revision-guarded last-writer-wins persistence | Yes | localStorage `getOnInit` sync writes; no revision guard; no cross-tab coord | Med |
| Actionable Feed (approve/reply without leaving) | Yes (sidebar Feed) | Approval inline in chat; no cross-chat feed | Low |
| Coalesce notifications by key + clear/deliver generation | Yes | Streaming store coalesces per-rAF (different concern) | Low |
| Recently-closed history persisted across quit | Yes | No | High (dup of tabs row) |
| Crash / dirty-shutdown breadcrumb | Yes | No | Low |
| Redact-by-default diagnostics | Yes | Credentials plaintext; `console.error` only | Med |

---

## 2. Portable lessons (web-applicable cmux patterns)

Each tagged with the source doc. AppKit-only mechanics (first-responder, NSAlert, pasteboard,
ExtensionKit, dock-badge XPC) are intentionally excluded.

**Drag & layout** `[tabs.md, splits-panes.md]`
- Keep the dragged id in a **synchronous in-memory registry**, never read the drop payload mid-drag
  (HTML5 `dataTransfer` is restricted during `dragover` — same race as SwiftUI). g-spot's dnd-kit
  already gives you `active.id` synchronously; the lesson is *don't* reach for transfer data.
- **Drag failsafe**: clear stuck drag state on `mouseup`-anywhere, `Escape`, and window `blur`
  (window listeners). g-spot has none today.
- Keep insertion/clamp math in a **pure planner** (value-in/value-out) so it's unit-testable —
  g-spot's `tabs-store.ts` tree ops are already shaped this way; extend, don't fragment.
- **Divider clamp** so panes can't collapse to an unrecoverable zero.
- **Equalize by leaf count** along the orientation, not naive 50/50.
- A single "layout changed" funnel needs **change-detection** (diff ordered ids, bump a version
  only on real change) or it's a render storm.
- **Adjacency-aware zone rewriting**: dropping toward an edge you already border collapses to
  center (merge) instead of a redundant split.
- **Gate destructive layout shortcuts** on whether the focused element is actually live/laid out —
  g-spot's `TabShortcuts` fires globally and should check the focused surface first.

**Move / transfer surfaces** `[tabs.md, workspaces.md]`
- Treat "move a live surface between containers" as a **transaction**: in-flight marker + rollback
  to original pane/index on failure; never strip the last surface from a workspace.
- **Transfer the connection, don't reconnect** (cmux reuses the SSH ControlMaster). Web analogue:
  when a terminal tab moves panes, the `terminal-sessions.ts` singleton already preserves the
  WebSocket — keep it that way and never tear down + reopen on a move.
- One **exhaustive centralized teardown** function on close/detach (cmux's
  `discardClosedPanelLifecycleState` clears ~30 maps). g-spot scatters per-tab state
  (scrollback localStorage, terminal session, highlight atom, surface-focus handler) — consolidate.

**Workspaces / groups** `[workspaces.md, workspace-groups.md]`
- **Snapshot/memo rows**: render list rows from immutable value props with `React.memo` custom
  comparators; forbid rows from reading the global store directly (kills re-render storms).
- **Defer expensive updates for off-screen surfaces, flush on reveal, and diff before applying.**
  Directly fixes g-spot's terminal-theme-never-refreshes bug.
- **Re-read live state instead of trusting a possibly-stale event payload** when events can race.
- **Restore by stable index, not just id** — restored items get fresh ids.
- Anchor-as-header grouping is a flat list + `groupId` back-pointer + parallel group array (not a
  nested tree). Portable if grouping is ever wanted.
- **Strict config validation** — hard-fail on genuinely wrong shapes with a clear message
  (matches repo's "don't paper over ambiguity" rule).

**Command palette** `[command-palette.md]`
- **Split metadata (contributions: id, context-aware title, `when`/`enablement`, keywords) from
  behavior (id→handler registry).** Titles are functions of a context snapshot so labels are
  dynamic. Directly portable and the single most impactful pattern.
- **Single field, `>`-prefix dual scope**: commands vs go-to switcher.
- **Tiered scoring with title-match dominance** over hidden-field matches; metadata-derived
  keywords (path components, branch, `:3000`, description); match-index highlighting; usage-history
  boost divided down when typing.
- **Async race discipline**: request IDs + monotonic version counters; re-check invariants before
  applying any async result; instant-preview then full search; don't flash "no results" while a
  search for the same query is pending.
- **Keyboard policy**: consume Escape and unrelated Cmd chords so they don't leak underneath; let
  standard edit chords through; handle IME marked-text so Return mid-composition isn't a submit.

**Sidebar panels** `[sidebar-panels.md]`
- **"Open tool as pane" with reuse-or-focus** (don't duplicate an existing tool pane).
- Keep expensive embedded views **alive across UI rebuilds by re-parenting**, and short-circuit
  reloads when inputs are unchanged so long-running processes survive sidebar toggles. g-spot
  already mounts all 3 right-sidebar panels (good) — apply the same to dock-style configs if added.
- **Live badges require an intentional dependency read** in the render body.
- **Trust-gate config-driven shell execution** fingerprinted on serialized config (RCE guard) —
  only relevant if a `.gspot/dock.json`-style feature is added.

**Agent sessions** `[agent-sessions.md]`
- **Resume must use structured session metadata, not regex over scrollback.** g-spot's
  `inferResumeAgent` and transcript-scraping are exactly the fragility cmux engineered away.
- **Classify agents by cwd-namespacing** (launch-cwd vs runtime-cwd) as a type.
- **Replay env via an allowlist with secrets excluded**; agents re-auth from disk on resume.
- **Bound the agent input/event queue** (cmux 1MB, fail-fast). g-spot's unbounded
  `ActiveChatStream` buffer is the direct counterexample.
- **Hibernation via a pure planner + two-phase confirmation** (stable tail fingerprint held N
  seconds, reset on any activity) to prevent flapping; deterministic tiebreak.
- **Build resume/fork command builders as pure, shared functions** so app + CLI emit identical
  commands.
- **Process kill needs SIGTERM→SIGKILL escalation + a pre-launch termination gate** (a kill can
  arrive before the process exists) + exit-AND-drain ordering so final bytes aren't lost.

**Notifications / state** `[notifications-state.md]`
- **Route agent events through one typed classifier; default unknown → non-actionable.** Read-only
  tools stay telemetry; only an explicit side-effecting allow-set escalates to approval.
- **Re-validate "is this still relevant?" at every async boundary** in a notify/approval pipeline;
  register the waiter *before* the store sees the event (no lost wakeups).
- **Tie pending-approval UI lifetime to producer liveness**, not a generic timeout.
- **Revision-guarded last-writer-wins persistence**; buffer mutations while the store is hydrating;
  **non-destructive restore** (re-insert at original index if restore fails).
- **Coalesce by key + monotonic clear/deliver generation** so clear-vs-deliver races resolve
  deterministically.
- **Detect dirty shutdowns** via a clean-exit timestamp guarded against false positives.
- **Redact-by-default** sensitive fields in any shareable diagnostics.
- **Don't request permissions / toast out of context**; suppress toasts for the surface the user is
  already viewing.

---

## 3. Prioritized improvement plan for g-spot

Concrete, scoped, web-appropriate. Effort: **S** ≤ half-day, **M** ~1–2 days, **L** ~3+ days.
Files are real paths. Favor simplicity over forcing the current arch (move logic to whichever side
is cleanest).

### P0 — correctness/reliability holes (do these first)

**P0.1 — Bound the chat stream event buffer** `[agent-sessions.md, notifications-state.md]`
- *Problem*: `ActiveChatStream.bufferedEvents` grows unbounded for a run's life and the **whole**
  buffer replays to every new subscriber. A long run = large memory + huge replay on every
  reconnect. Terminals cap at 500k chars; chat streams have no cap.
- *Change*: cap the buffer (size or byte budget) and/or snapshot-then-tail on attach. Drop or
  compact oldest non-essential events (keep last assistant message + tool state). Mirror the
  terminal's 500k discipline.
- *Files*: `packages/api/src/chat-runtime.ts` (the `ActiveChatStream` pub/sub),
  `packages/api/src/chat-stream.ts` (attach/replay path).
- *Effort*: **M**. *Deps*: none.

**P0.2 — Persist nested split sizes** `[splits-panes.md, frontend-ux.md]`
- *Problem*: inner `ResizablePanelGroup`s in `TabPaneNodeView` use `id=` with **no storage
  wiring** — reload resets pane proportions even though split *structure* persists. Documented gap.
- *Change*: wire per-split-node sizing into the existing `paneLayout` persistence (store
  `dividerPosition` per split node), or attach `react-resizable-panels` autosave per node like the
  shell-level `gspot.shell.right` already does. Clamp dividers to a min so a pane can't collapse to
  zero (replace the hardcoded `minSize={15}`).
- *Files*: `apps/web/src/components/tabs/tabs-content.tsx` (`TabPaneNodeView`),
  `apps/web/src/lib/tabs-store.ts` (`paneLayout` atom + tree node shape),
  `packages/ui/src/components/resizable.tsx`.
- *Effort*: **M**. *Deps*: none.

**P0.3 — Replace regex agent-resume with structured metadata** `[agent-sessions.md]`
- *Problem*: `inferResumeAgent` greps terminal scrollback for "claude"/"codex" and on a false
  positive sets `skipReplay`, **silently dropping legitimate scrollback**. Server side scrapes
  `~/.claude` / `~/.codex` / `~/.cmuxterm` transcripts with a fragile command parser.
- *Change*: persist structured session metadata when a CLI agent launch is *detected on input*
  (g-spot already does `detectAgentLaunch` in `terminal-stream.ts`) — store `{kind, sessionId,
  launchCwd}` keyed by terminal session id, and drive resume from that record, not scrollback
  inference. Delete `inferResumeAgent`. Classify kinds by launch-cwd vs runtime-cwd (Claude =
  launch-cwd).
- *Files*: `apps/web/src/components/terminal/terminal-sessions.ts` (remove `inferResumeAgent` +
  `skipReplay` heuristic), `packages/api/src/terminal-stream.ts` (structured binding store, already
  writes `~/.g-spot/terminal-agent-sessions.json` — make it the single source of truth).
- *Effort*: **L**. *Deps*: none. *Note*: per repo conventions, ask before changing terminal
  lifecycle behavior — confirm desired resume semantics first.

**P0.4 — Recently-closed history (reopen tab/pane)** `[tabs.md, notifications-state.md]`
- *Problem*: closing a tab/pane is irreversible; clearing localStorage loses the whole workspace.
  No `Cmd+Shift+T`.
- *Change*: a capacity-bounded, persisted closed-item history (tab id + kind + pane id + index).
  Reopen most-recent restorable at original index; non-destructive (re-insert record on failure).
  Pure store + a `⌘⇧T` binding. This is fully client-side and small.
- *Files*: new `apps/web/src/lib/closed-tabs-store.ts` (jotai + localStorage like
  `tabs-store.ts`), `apps/web/src/lib/tabs-store.ts` (hook close paths to record),
  `apps/web/src/components/tabs/tab-bar.tsx` (shortcut).
- *Effort*: **M**. *Deps*: none.

**P0.5 — Terminal theme re-read on theme change** `[workspaces.md]`
- *Problem*: xterm theme is read from `document.documentElement` CSS vars *once at creation* and
  never re-applied; switching themes leaves live terminals on the old palette.
- *Change*: subscribe terminal sessions to theme changes; on change, re-read CSS vars and apply
  `term.options.theme`. Defer for hidden/detached terminals and flush on reveal (cmux's
  deferred-while-hidden + diff-before-apply pattern); diff the signature so unchanged themes skip.
- *Files*: `apps/web/src/components/terminal/terminal-sessions.ts`,
  `apps/web/src/components/terminal/terminal-view.tsx`.
- *Effort*: **S**. *Deps*: none.

### P1 — high-value UX + robustness

**P1.1 — Command palette with dual scope (`>` commands + go-to switcher)** `[command-palette.md]`
- *Problem*: `⌘P` is file-search only. No command palette, no "jump to chat/tab/terminal" switcher.
- *Change*: generalize the existing `FileSearchDialog` into a single palette: default scope = go-to
  (open chats, files, tabs, terminals); `>` scope = registered commands. Build a
  **contribution + handler registry** (id, context-aware title, `when`/`enablement`, keywords)
  decoupled from behavior. Reuse the existing `CommandDialog`. Render the real bound shortcut as a
  trailing hint.
- *Files*: `apps/web/src/components/file-search/file-search-dialog.tsx` (generalize / rename),
  new `apps/web/src/lib/command-palette.ts` (registry + context snapshot),
  `apps/web/src/routes/agent/$projectId.tsx` (register project-scoped commands + handler),
  `apps/web/src/components/tabs/tab-bar.tsx` (shortcut wiring).
- *Effort*: **L**. *Deps*: P1.2 (better scorer) is complementary but independent.

**P1.2 — Upgrade the fuzzy scorer + metadata keywords** `[command-palette.md]`
- *Problem*: `scoreFile` is a flat exact/prefix/substring/path tier with no word-boundary,
  initialism, or typo tolerance, and no match highlighting.
- *Change*: tiered scoring (exact > whole-prefix > word-prefix/exact-word > contains > initialism >
  subsequence) with **title-match dominance over path matches**, multi-token AND, and match-index
  highlighting. Keep it a pure function (testable oracle). Index metadata keywords (path
  components; for chats: branch/model/title).
- *Files*: `apps/web/src/components/file-search/file-search-dialog.tsx` (`scoreFile`) →
  extract to `apps/web/src/lib/fuzzy-score.ts` (pure, unit-testable).
- *Effort*: **M**. *Deps*: pairs with P1.1.

**P1.3 — Tab context menu (close others / close to right / move)** `[tabs.md]`
- *Problem*: no tab context menu; only hover-X + middle-click. No "close others/below".
- *Change*: right-click menu on tab items: Close, Close Others, Close to the Right, Move to New
  Pane (split). Reuse `@g-spot/ui` context-menu. For multi-tab close, a small confirm when a tab
  has a running chat (re-check run status at dispatch).
- *Files*: `apps/web/src/components/tabs/tab-item.tsx`,
  `apps/web/src/lib/tabs-store.ts` (close-others/close-right ops).
- *Effort*: **M**. *Deps*: P0.4 (so "close others" is recoverable).

**P1.4 — Drag failsafe + gate layout shortcuts on live focus** `[tabs.md, splits-panes.md]`
- *Problem*: no drag-clear on blur/escape/mouseup-anywhere; `TabShortcuts` fires globally on
  capture phase without checking whether the focused surface is live/laid out.
- *Change*: add window-level `mouseup`/`blur`/`Escape` listeners that clear stuck dnd-kit drag
  state; in `TabShortcuts`, resolve the active pane/surface and bail if the focused element is
  detached/zero-sized (e.g. mid-transition) before firing split/close.
- *Files*: `apps/web/src/components/tabs/tabs-content.tsx` (dnd handlers),
  `apps/web/src/components/tabs/tab-bar.tsx` (`TabShortcuts`).
- *Effort*: **S**. *Deps*: none.

**P1.5 — "Open tool as pane" from right sidebar** `[sidebar-panels.md]`
- *Problem*: files/changes/terminal live only in the right sidebar; can't promote into the main
  split grid.
- *Change*: an "open as pane" affordance that opens the tool as a real surface in the active pane,
  reusing an existing matching pane if present (reuse-or-focus). The Changes panel is already a
  self-contained module, so this is mostly a new surface kind or a routed file/diff open.
- *Files*: `apps/web/src/components/right-sidebar/right-sidebar.tsx`,
  `apps/web/src/lib/tabs-store.ts` (surface kinds), `apps/web/src/components/tabs/tabs-content.tsx`
  (surface mounting).
- *Effort*: **M**. *Deps*: none. *Note*: confirm scope first (which tools become panes).

**P1.6 — Tie pending approvals to run liveness + survive nothing silently** `[notifications-state.md]`
- *Problem*: pending tool approvals are dropped on `configKey` churn / 15-min GC / server restart
  with no user-visible signal — editing config mid-run silently kills the run + approvals.
- *Change*: when a run is aborted (configKey change, GC, restart), **emit a typed terminal event**
  to the chat stream ("run aborted: config changed") instead of silently failing the approval
  promise; re-validate approval relevance at each async hop. Make config edits mid-run *warn*
  client-side before applying.
- *Files*: `packages/api/src/chat-runtime.ts` (configKey rebuild, GC),
  `packages/api/src/chat-stream.ts` (approval resolution + abort event),
  `apps/web/src/components/chat/chat-view.tsx` (surface the aborted state, not a silent stall).
- *Effort*: **M**. *Deps*: none. *Note*: stateful-flow change — get approval on desired semantics.

### P2 — polish / hardening / optional

**P2.1 — Centralized per-tab teardown drain** `[workspaces.md, sidebar-panels.md]`
- *Problem*: per-tab state is scattered (terminal session map, scrollback localStorage key,
  highlight atom, surface-focus handler). Closing a tab can orphan some of it.
- *Change*: one `discardClosedTabState(tabId)` that removes the terminal session, its
  `gspot.terminal.history.{tabId}` key, the highlight entry, and the surface-focus handler.
- *Files*: `apps/web/src/lib/tabs-store.ts`, `apps/web/src/components/terminal/terminal-sessions.ts`,
  `apps/web/src/lib/surface-focus.ts`.
- *Effort*: **S**. *Deps*: none.

**P2.2 — Surgical layout-change versioning + memoized rows** `[splits-panes.md, workspace-groups.md]`
- *Problem*: derived `tabLayoutAtom` recompute + non-memoized rows risk re-render storms as tab
  count grows.
- *Change*: bump a `paneLayoutVersion` only on genuine ordered-id changes; `React.memo` tab/pane
  rows with custom comparators over scalar props; forbid rows reading the store directly.
- *Files*: `apps/web/src/lib/tabs-store.ts`, `apps/web/src/components/tabs/tab-item.tsx`,
  `apps/web/src/components/tabs/tabs-content.tsx`.
- *Effort*: **M**. *Deps*: none.

**P2.3 — Agent runtime hibernation (cap live runs)** `[agent-sessions.md]`
- *Problem*: only a 15-min idle TTL; no cap on concurrent live chat runtimes, no liveness-tied
  eviction.
- *Change*: a **pure planner** that, given live runtimes + activity, selects idle excess over a cap
  to evict; two-phase confirmation (stable for N seconds) to avoid flapping; never evict a running
  or pending-approval runtime. State is already restorable from SQLite.
- *Files*: `packages/api/src/chat-runtime.ts` (GC → planner), new
  `packages/api/src/lib/runtime-hibernation.ts` (pure).
- *Effort*: **M**. *Deps*: P0.1 (bounded buffers make eviction cheaper).

**P2.4 — Equalize splits + divider clamp + adjacency-aware drop zones** `[splits-panes.md]`
- *Problem*: no equalize; fixed quarter drop zones; redundant splits possible.
- *Change*: leaf-weighted equalize command (`⌘⇧=`); 25%/min-px edge bands; adjacency suppression
  (drop toward an already-bordered edge → merge into center).
- *Files*: `apps/web/src/lib/tabs-store.ts` (equalize op), `apps/web/src/components/tabs/tabs-content.tsx`
  (drop-zone geometry + adjacency check).
- *Effort*: **M**. *Deps*: P0.2 (divider persistence).

**P2.5 — Project-level unread rollup + finished-run badge** `[notifications-state.md]`
- *Problem*: finished-chat highlight is per-tab only; the project/sidebar doesn't roll up unread.
- *Change*: derive an unread count per project from `chat-runtime-statuses` (finished-unread) and
  show a badge on the project row in `AiSidebar`; suppress for the focused tab. Live observable
  read.
- *Files*: `apps/web/src/lib/chat-runtime-statuses.ts`, `AiSidebar` (project row).
- *Effort*: **S**. *Deps*: none.

**P2.6 — Redact-by-default diagnostics + clean-exit breadcrumb** `[notifications-state.md]`
- *Problem*: credentials are plaintext and logging is raw `console.error`; no dirty-shutdown
  detection.
- *Change*: a small redacting logger for shareable diagnostics (length-preserving `<redacted:Nb>`,
  `scheme://host` for URLs); a clean-exit timestamp to detect dirty shutdowns and surface a one-time
  banner. Low priority for local-first but cheap.
- *Files*: new `packages/api/src/lib/redact-log.ts`; server entry for clean-exit timestamp.
- *Effort*: **S**. *Deps*: none.

### Dependency order (build sequence)

```
P0.1  P0.2  P0.5            (independent, parallelizable)
P0.3  (confirm semantics first)
P0.4 ──▶ P1.3               (close-others needs recoverability)
P1.2 ──▶ P1.1               (scorer feeds the palette; both reuse FileSearchDialog)
P1.4  P1.5  P1.6            (independent; P1.5/P1.6 confirm scope)
P2.1  P2.2  P2.4(after P0.2)  P2.5  P2.6
P2.3  (after P0.1)
```

---

## 4. Quick wins (high value, low effort — start here)

1. **P0.5 — Terminal theme re-read on theme change** (S). One-line bug class: live terminals stuck
   on the old palette after a theme switch. `terminal-sessions.ts` + `terminal-view.tsx`.
2. **P1.4 — Drag failsafe + gated layout shortcuts** (S). Window `mouseup`/`blur`/`Escape` clears
   stuck drags; `TabShortcuts` checks focused surface is live before splitting/closing.
3. **P2.1 — Centralized per-tab teardown** (S). One `discardClosedTabState(tabId)` to stop orphaning
   terminal sessions / scrollback / highlight / focus handlers on close.
4. **P0.4 — Recently-closed history / `⌘⇧T`** (M, but self-contained & client-only). Huge UX win,
   zero server changes, and a prerequisite for safe "close others".
5. **P2.5 — Project unread rollup badge** (S). Reuse `chat-runtime-statuses`; badge the project row.
6. **P0.1 — Cap the chat event buffer** (M). The clearest reliability fix; mirror the terminal's
   existing 500k cap.
