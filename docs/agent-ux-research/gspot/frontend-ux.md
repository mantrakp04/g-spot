# g-spot Agent Workspace — Frontend UX Research

Bucket: **frontend-ux**. Scope: the agents UI surface — routes, tab system, resizable panes, right sidebar, file search, terminal, chat, Pi components, and the Jotai/external stores backing them. Documents the **current** state honestly, including stubbed/naive/fragile bits.

## Overview

The agent feature is an **IDE-style multi-surface workspace** scoped to a "project" (a directory the Pi agent is pinned to). A project shell has three regions:

1. **Left/secondary sidebar** (`AiSidebar`) — project + chat tree, "AI" header, links to agent/project settings and new project. Not in the seed scope but it's the navigational entry.
2. **Center "tabs" area** — a recursive split-pane workspace whose leaf panes each hold a tab strip of surfaces. Surface kinds: `chat`, `terminal`, `file` (Monaco), `diff` (Monaco). This is the heart of the feature.
3. **Right sidebar** — a 3-tab panel: **All Files** (lazy tree), **Changes** (full git staging UI), **Terminal** (a single persistent PTY per project). Plus a ⌘P fuzzy file-search command palette.

Key architectural decision: **the URL is intentionally thin.** `/agent/$projectId/_tabs` is a pathless layout that renders the tab tree; the project bare URL (`_tabs/index.tsx`) renders nothing. All workspace state — which tabs are open, pane splits, active tab/pane, scroll/draft/PTY state — lives in `localStorage`-backed Jotai atoms and module-level singletons, **not** in the route. Chats are no longer addressable by URL; they're tabs.

State is split across three layers in `tabs-store.ts`:
- `tabsById` — tab metadata keyed by id.
- `panesById` — each pane's ordered `tabIds` + `activeTabId`.
- `paneLayout` — the binary split tree; leaves reference pane ids only.
A derived `tabLayoutAtom` hydrates layout + panes into a single render tree so UI stays simple while mutations stay explicit about whether they touch tab data, pane membership, or split geometry.

## Current Features & UX

### Tabs & surfaces
- **Four surface kinds**: chat (Sparkles icon), terminal (TerminalSquare), file (FileText), diff (GitCompare). Tab identity is deterministic per kind: `chat:{projectId}:{chatId}`, `file:{projectId}:{path}`, `diff:{projectId}:{path}` (mode is mutable, not part of identity), and random UUID for terminals + draft chats. Opening the same chat/file/diff focuses the existing tab instead of duplicating.
- **Draft chats**: `useOpenDraftChatTab` opens a `chatId: null` tab titled "New Chat". On first submit a real chat is created and the draft tab is replaced in place (`replaceTabId`) so the tab/pane slot is preserved.
- **Tab strip per pane** (`PaneTabStrip`): horizontally scrollable (`no-scrollbar`), per-tab close button (appears on hover or when active), middle-click to close (`onAuxClick` button === 1), an active-tab underline, and a per-pane toolbar with New-tab menu (+), split-horizontal (Columns2), split-vertical (Rows2), close-pane (X).
- **Highlighting**: when a background chat's runtime finishes (`subscribeChatRuntimeFinished`), its tab gets a primary-tinted highlight (`highlightedTabIdsAtom`, value = `Date.now()`), and the owning pane gets a glow border. Cleared on focus/close.
- **Empty states**: no tabs at all → centered icon row + New-tab menu + hint mentioning the `+` menu. Empty pane → small New-tab menu + "Open a surface in this pane".

### Split panes (drag + buttons)
- **Binary split tree**, horizontal or vertical, arbitrarily nested. Built on `react-resizable-panels` via `packages/ui/components/resizable.tsx`.
- **Drag-and-drop via `@dnd-kit`**: drag a tab to reorder within a pane (`horizontalListSortingStrategy`), move to another pane (center/`pane-drop` zone), or split a pane by dropping into a directional edge zone (left/right/top/bottom quarter). Collision detection prefers `pointerWithin`, falling back to `closestCenter`. Active drop zone shows a sky-blue preview overlay (`PaneDropPreview`).
- **Splitting via toolbar / shortcut** moves the active tab into the new sibling pane when the source pane has >1 tab; otherwise creates an empty pane.
- **Closing a pane** collapses the split and merges its tabs into the sibling's first leaf. Last remaining pane can't be closed (`leafCount <= 1` guard).
- **Pane focus**: `onMouseDownCapture` sets the active pane; active pane gets a primary border. Active tab/pane drives keyboard shortcuts and "where new surfaces open."

### Keyboard shortcuts
- `⌘P` / `Ctrl+P` — fuzzy file search palette (registered at the project layout).
- `⌘T` — new chat in active pane; `⌘⇧T` — new terminal; `⌘W` — close active tab (falls back to closing the active pane); `⌘D` — split right, `⌘⇧D` — split down (`TabShortcuts`, capture-phase global listener).
- In chat input: `Shift+Tab` cycles permission-mode presets (plan/default/auto/bypass). Slash-command popover intercepts keys first.
- In Changes panel: arrow up/down to move row selection, Enter to open diff, Space to stage/unstage, ⌘A to select-all within the active group, ⌘/Ctrl-click + Shift-click multi-select.

### Right sidebar
- Three tabs (`files`/`changes`/`terminal`) persisted in `rightSidebarTabAtom`. **All three panels stay mounted** (`hidden` toggling, not unmount) so terminal PTY and tree expansion survive tab switches.
- **Collapsed rail**: when collapsed, shows an icon-only vertical rail (search + 3 tab icons); clicking an icon expands and selects that tab.
- **Swap support** (`sidebarsSwappedAtom`): the AI sidebar and the file/changes/terminal panel can swap left/right sides. Collapse state is per-logical-sidebar, not per-position.
- **File tree**: lazy per-folder fetch on first expand (`fs.list`), root auto-open, `react-files-icons` for icons, optional `renderFileSuffix` hook (used by changes). Click a file → opens a Monaco file tab.
- **Changes panel**: a genuinely full git staging UI — groups (Merge/Staged/Changes), stage/unstage/discard (per-row, per-selection, all), untracked clean, commit box with debounced (500ms) draft auto-save to server, branch display, stash menu, "not a git repo" + "no changes" empty states, tree vs flat view modes, keyboard navigation. Plain row click opens a diff tab; double-click opens the file.

### Terminal
- xterm.js with FitAddon + Unicode11Addon. Theme is read from CSS vars (`--foreground`, `--background`, etc.) at creation.
- **Persistent sessions** live in a module-level `Map` keyed by tabId (`terminal-sessions.ts`), independent of React lifecycle. The `TerminalView` component only appends/removes the session's container `<div>`; the PTY/WebSocket survive unmount (navigating away and back).
- **WebSocket protocol** to `/api/terminal/socket` with `projectId`, `cols`, `rows`, `sessionId`, `historyOffset`. Input/resize/close messages are JSON (`{t:"in"|"r"|"close"}`); server sends `{t:"out"}` / `{t:"exit"}`.
- **Scrollback persistence**: terminal output is mirrored into `localStorage` (`gspot.terminal.history.{tabId}`), capped at 500k chars, replayed on re-create. A heuristic (`inferResumeAgent`) scans history for "claude"/"codex" and, if matched, sets `resumeAgent` + `skipReplay` so an interactive agent CLI re-attaches instead of dumping stale frames.
- Pending input is buffered until socket open, then flushed. Resize observer refits on container resize; refit/refocus on tab-activate and surface-focus.

### File search (⌘P)
- `CommandDialog` palette. Fetches the **entire** file list (`fs.listAll`) when opened (30s stale time), builds an in-memory index, and does a custom multi-term scorer: exact name (80) > name prefix (50) > name substring (30) > path substring (10); all terms must match or score is 0; tie-break by path length. `useDeferredValue` keeps typing responsive. Caps at 60 initial / 80 search results.

### Chat surface
- Heavy `ChatView` (1700 LOC) with: streaming via WebSocket (`usePiChatStream`), optimistic user-message append, draft→real-chat creation flow with `pending-chat-submissions` handoff, reconnect/attach-to-existing-stream, **follow-up queue** (`chat-queue.ts`, modes "all" / "one-at-a-time") drained when stream goes idle, edit/regenerate/fork (each replaces persisted history then restreams), tool-approval flow (optimistic + server-confirmed), per-message actions, branch/worktree selection, model picker, permission-mode presets, thinking-level, slash commands, file attachments, starter prompts on empty state.
- **Streaming perf**: in-flight assistant tokens go through a separate module store (`streaming-message-store.ts`) that coalesces writes to one notify per `requestAnimationFrame`, so token updates re-render only `<StreamingMessage>`, never `<ChatMessageList>`. Streaming-message array identity is stabilized to avoid spurious re-renders.
- **Agent config** is a per-draft/per-chat reducer with project-default sync logic; drafts persist changes back to the project default so they "stick" for the next new chat.

### Persistence summary (localStorage keys)
- `gspot.tabs.byId.v2`, `gspot.tabs.panesById.v2`, `gspot.tabs.layout.v2`, `gspot.tabs.activePane.v2` — tab/pane/layout/active-pane.
- `gspot.secondarysidebar.collapsed.v1`, `gspot.rightsidebar.collapsed.v1`, `gspot.rightsidebar.tab.v1`, `gspot.sidebars.swapped.v1` — sidebar state.
- `gspot.lastProjectId` — fallback active project.
- `gspot.terminal.history.{tabId}` — terminal scrollback.
- `gspot.shell.right` + per-split-node sizes — resizable layout (via `react-resizable-panels` `useDefaultLayout`).
- Per-frame streaming + terminal sessions + surface-focus handlers live in **module singletons** (not persisted).

## Implementation

### Routing
- `routes/agent/index.tsx` — auto-redirects to last-used (or first) project; first-run empty state with a "create your first project" card.
- `routes/agent/$projectId.tsx` — `ProjectLayout`: the two-column shell (right sidebar + main), `useResizableLayout` for persistence, ⌘P handler, project-not-found / loading skeletons, mounts `<FileSearchDialog>` and `<TabShortcuts>`.
- `routes/agent/$projectId/_tabs.tsx` — pathless layout rendering `<TabsContent>`; the real `<Outlet>` is rendered hidden (`<div className="hidden">`), a deliberate trick so nested routes resolve without painting.
- `routes/agent/$projectId/_tabs/index.tsx` — `() => null`.
- `routes/agent/$projectId/settings.tsx` + `routes/agent/settings.tsx` — project- and agent-level settings (search-param driven tabs).
- `routes/agent/new.tsx` — create-project form.

### Tab store (`lib/tabs-store.ts`, ~1070 LOC)
Pure functional tree operations: `splitLeaf`, `collapsePane`, `replaceLeafWithSplit`, `moveTabInPanes`, `splitTabIntoPane`, `addTabToPane`, `removeTabFromPanes`, `replaceTabInPanes`, `deleteUnassignedPanes`, plus a `useNormalizeTabLayout` reconciliation that runs on every `tabs` change to prune dead tabs/panes and re-home orphaned tabs. Hooks: `useOpen{Chat,DraftChat,Terminal,File,Diff}Tab`, `useClose{Tab,ActiveTab}`, `useFocus{Tab,Pane}`, `useSplit{ActivePane,TabToPane}`, `useClosePane`, `useMoveTab`, `useUpdateDiffMode`, `useHighlightChatTab`. Custom `jsonStorage` wrapper with `getOnInit: true` for synchronous hydration.

### Data flow
- tRPC + TanStack Query client (`@/utils/trpc`, `trpcClient`). FS tree/list/listAll, git changes/state/branch/stash/draft mutations, chat CRUD + agent-config mutations, Pi catalog/defaults.
- Terminal + chat streaming bypass tRPC and use **raw WebSockets** to the Elysia server (`/api/terminal/socket`, chat stream socket via `usePiChatStream` / `chat-stream-socket.ts`).
- `surface-focus.ts` is a tiny imperative registry: surfaces register a focus handler by tabId; `focusSurface(tabId)` calls it on next animation frame. Used to focus textarea / terminal after opening or focusing a tab.

### Right sidebar (`components/right-sidebar/*`)
`right-sidebar.tsx` is the tab shell; `file-tree.tsx` the lazy tree; `changes/` is a well-decomposed module (index + action-button, commit-box, context-menu, header-toolbar, resource-group/row/tree, stash-menu, status-bar, and three hooks: `use-changes`, `use-changes-data`, `use-git-mutations`).

## Gaps & Rough Edges

- **No URL addressability for chats/tabs.** Workspace state is localStorage-only. You can't deep-link to a chat or share a tab; clearing storage loses the whole workspace. Multiple browser tabs/windows of the same app share one localStorage and would fight over tab/pane atoms (no cross-tab coordination, no `BroadcastChannel`).
- **No resize persistence for nested splits in `TabsContent`.** The shell-level right split persists via `gspot.shell.right`, but the inner `ResizablePanelGroup`s in `TabPaneNodeView` use `id={...}` with **no `useResizableLayout`/storage wiring** — nested split sizes reset to default on reload even though the split *structure* persists.
- **`react-files-icons` everywhere, plus a `Spinner` and skeletons mix.** Project guidance says "use skeleton loaders, not spinners," but `MonacoFallback` and the file-search use spinners/inline text. The empty-tab state and Monaco loading use spinners.
- **Terminal theme is read from `document.documentElement` at creation**, not from the (detached) container, and is never re-read on theme change — switching themes leaves existing terminals on the old palette until recreated.
- **`inferResumeAgent` is a brittle regex heuristic** ("claude"/"codex" substrings in scrollback). Any output mentioning those words triggers a "resume agent" path with `skipReplay`, which can silently drop legitimate scrollback. No structured session metadata.
- **Terminal scrollback in localStorage** is capped at 500k chars *per tab* and is plain string concat sliced from the end — multiple long-lived terminals can pressure the localStorage quota, and the slice can chop mid-escape-sequence, corrupting the replayed frame.
- **File tree has no virtualization, no file watching, no rename/create/delete, no drag-reorder, no context menu, no multi-select.** It's read-only navigation; staleTime-based caching means external file changes don't reflect until refetch. Large directories render every row.
- **File search loads the entire repo file list into memory** (`fs.listAll`) and re-indexes client-side. Fine for small repos; no incremental/streamed index, no content search (only filename/path), no ignore-rule awareness surfaced in the UI, no recent-files weighting.
- **No tab overflow handling beyond horizontal scroll** — many tabs just scroll; no overflow dropdown, no tab pinning, no "close others/close to the right," no tab context menu at all.
- **Pane drop zones are fixed quarter-regions**; no live "what will happen" affordance beyond the preview, and `minSize={15}` is a hardcoded percent. Drag uses pointer activation distance 5; no touch tuning.
- **`HistoryPopover` exists but isn't wired into the tab strip** in the files read (it's a standalone component using `useChats`); recent-chats discovery is otherwise only via the left `AiSidebar` tree.
- **`focusSurface` silently no-ops** if no handler is registered yet (race on first open is masked by the rAF, but there's no retry) — newly opened surfaces occasionally won't grab focus if the registration hasn't landed.
- **`ChatView` is a 1700-line component** doing query orchestration, stream lifecycle, optimistic state, edit/fork/regenerate, agent-config reducer, and two copies of the prompt-input area (empty vs docked). High blast radius; the docked/empty duplication and the long `onStreamComplete` invalidation cascade (fixed `[1000,3000,6000]ms` re-invalidations) are fragile catch-alls.
- **No drag of files from the tree into a pane**, no "open to the side," no split-from-file-tree. Surfaces only open into the active pane (files/diffs always go to `activePaneId`, ignoring any target-pane hint that chats/terminals support).
- **Terminal exit/disconnect is shown as inline ANSI text**, not a reconnect button or status chip — a dropped PTY just prints `[terminal: disconnected]` with no recovery affordance.
- **No accessibility passes evident** beyond `role="tab"`/`aria-selected` on tab items and some `aria-label`s; pane focus is mouse-driven (`onMouseDownCapture`), keyboard pane navigation isn't implemented.

## Key Files

- `apps/web/src/lib/tabs-store.ts` — tab/pane/split tree model + all mutation hooks (core of the feature).
- `apps/web/src/lib/sidebars-store.ts` — right/secondary collapse, active right tab, swap.
- `apps/web/src/lib/active-project.ts` — last-project fallback atom.
- `apps/web/src/lib/streaming-message-store.ts` — per-frame coalesced streaming store.
- `apps/web/src/lib/surface-focus.ts` — imperative focus registry.
- `apps/web/src/routes/agent/$projectId.tsx` — project shell (right sidebar + main split, ⌘P).
- `apps/web/src/routes/agent/$projectId/_tabs.tsx` — pathless tabs layout (hidden Outlet).
- `apps/web/src/components/tabs/tabs-content.tsx` — recursive pane/leaf rendering, dnd-kit drag/drop/split, surface mounting.
- `apps/web/src/components/tabs/tab-bar.tsx` — global keyboard shortcuts (`TabShortcuts`).
- `apps/web/src/components/tabs/tab-item.tsx`, `new-tab-menu.tsx`, `history-popover.tsx` — tab chrome.
- `apps/web/src/components/right-sidebar/right-sidebar.tsx`, `file-tree.tsx`, `changes/*` — right panel.
- `apps/web/src/components/terminal/terminal-sessions.ts` + `terminal-view.tsx` — persistent PTY sessions.
- `apps/web/src/components/file-search/file-search-dialog.tsx` — ⌘P palette + scorer.
- `apps/web/src/components/chat/chat-view.tsx` — the chat surface (large).
- `packages/ui/src/components/resizable.tsx` — thin wrapper over `react-resizable-panels` (`useDefaultLayout`).
