# cmux — Workspaces

Research notes on the **Workspace** subsystem of cmux (a Ghostty-based macOS terminal for AI coding agents, Swift/AppKit/SwiftUI). This bucket covers: the Workspace concept and lifecycle, its content view, surface configuration, the action dispatcher, remote (SSH/WebSocket) workspaces, finder/dir resolution, background priming, detached surface transfer, prompt submit, and appearance resolution.

The goal is to mine portable UX and engineering lessons for a React/web "agent workspace" app. Each section flags **[AppKit-only]** (platform-specific) vs **[Portable]** (concept transfers to web).

---

## Overview

A **`Workspace`** (`Workspace.swift`, ~823KB — the largest single file in the codebase) is the unit shown as a "tab" in the sidebar. It is an `ObservableObject` that owns:

- A **`BonsplitController`** — the split/tab layout engine. A workspace is a *tree of panes*, each pane holds a stack of *tabs*, and each tab maps to a **`Panel`** (terminal, browser, etc.). The mapping is `surfaceIdToPanelId: [TabID: UUID]`.
- A dictionary of **`panels: [UUID: any Panel]`** — the actual content surfaces.
- A large amount of **per-panel side state**: directories, git branches, PRs, titles, custom titles, pinned IDs, unread indicators, shell-activity, agent PID tracking, listening ports, TTY names, restored-agent snapshots, remote PTY session IDs.
- Optional **remote configuration** (`WorkspaceRemoteConfiguration`) when the workspace is an SSH/WebSocket remote.

Confusingly for newcomers: in cmux, a sidebar "tab" is a **Workspace**, and inside a workspace the splits also have "tabs" (panel tabs). `TabManager.tabs` is actually the array of `Workspace` objects. So "tab" is overloaded: sidebar-tab = workspace; pane-tab = panel surface.

Key supporting types:
- **`WorkspaceContentView`** — SwiftUI view that renders the workspace via `BonsplitView`.
- **`TabManager`** — owns the array of workspaces, selection, pinning, ordering, detached-workspace creation.
- **`WorkspaceActionDispatcher`** — pure logic for pin/unpin across multi-select.
- **`BackgroundWorkspacePrimeCoordinator`** — warms hidden workspaces' terminal surfaces.
- **`WorkspaceRemoteConfiguration`** / **`WorkspaceRemoteSSHBatchCommandBuilder`** — remote SSH wiring.

---

## Features & UX

### Workspace as the primary navigation unit [Portable]
- Each sidebar row is a workspace with: title, custom title override, custom description, custom color (hex), pinned state, group membership (`groupId`), and a rich set of sidebar metadata (git branch, PR state, listening ports, agent status entries, progress, log entries, conversation preview).
- **Pinning**: workspaces can be pinned; pinned ones float to the top and have a clamped insert region (new/detached workspaces can never be inserted *above* the pinned block — see `clampedDetachedWorkspaceInsertIndex`). Pin toggle works across multi-selection with an *anchor* workspace deciding the resulting pinned/unpinned direction (`WorkspaceActionDispatcher.pinState`).
- **Workspace groups**: groups have headers anchored to a workspace's cwd; group color/icon/context-menu/placement derive from the anchor's current directory. Changing a workspace's `currentDirectory` posts `.workspaceCurrentDirectoryDidChange` so the (possibly off-screen) group header refreshes.

### Splits and panel tabs [Portable concept, AppKit rendering]
- Inside a workspace, the user can split panes and stack tabs per pane (terminal or browser). Splits are instantaneous because Bonsplit keeps all content alive (`contentViewLifecycle: .keepAllAlive`).
- **Empty pane** shows a friendly "Empty Panel" card with two prominent buttons — **Terminal** and **Browser** — each rendered with a live keyboard-shortcut hint pill (`EmptyPanelView`). The shortcut shown is the user's actual configured shortcut, re-read reactively.
- **Split zoom**: a tab can be zoomed to fill the whole workspace and toggled back. Zoom enter/exit recreates the Bonsplit subtree (`.id(splitZoomRenderIdentity)`) to avoid stale pre-zoom chrome stacking over portal-hosted browser content.
- **Tab reordering & cross-pane move** are allowed; pure drag-reorders (no membership change) bump a `paneLayoutVersion` counter so observers that don't watch Bonsplit internals still learn about spatial reordering.

### Detached surface transfer (drag a tab out to a new workspace) [Portable concept]
- A panel/tab can be **detached** from one workspace and moved into a brand-new workspace (the "Move Tab to New Workspace" family of files: `AppDelegate+MoveTabToNewWorkspace`, `ContentView+…`, `TerminalController+…`, `GhosttyNSView+…`, `BrowserPanel+…`, CLI `CMUXCLI+MoveTabToNewWorkspace`).
- The detach carries a full snapshot (`DetachedSurfaceTransfer`): the live `Panel` object itself, title/icon/iconImageData, kind, loading state, pinned, directory, TTY name, cached/custom titles, manual-unread, restored-unread indicator, restorable-agent snapshot + resume state, resume binding, **agent runtime state (PIDs + status entries)**, and for remotes: relay port, PTY session ID, and a remote-cleanup configuration.
- The new workspace is created *around* the existing live surface — no terminal restart, no lost scrollback, agent process continuity preserved.

### Background priming (hidden workspaces feel instant) [Portable concept]
- When you switch to a workspace, its terminal is already warm. `BackgroundWorkspacePrimeCoordinator` walks `pendingBackgroundWorkspaceLoadIds` and starts the terminal surface for hidden workspaces in the background, with a **2s timeout** per workspace, so the user never waits for a cold PTY on switch.

### Remote (SSH / cloud VM) workspaces [Partly portable]
- `cmux ssh` / `cmux vm new` create workspaces whose initial terminal runs an SSH bootstrap script. Remote workspaces:
  - Auto-reconnect: the remote PTY attach loop retries up to `CMUX_SSH_RECONNECT_LIMIT` (default 20) with a `CMUX_SSH_RECONNECT_DELAY_SECONDS` (default 2) delay, printing a yellow `[cmux] remote PTY bridge closed; reattaching (attempt N/limit)` banner.
  - **Keep PTY alive after command exit**: remote/initial-command workspaces set `waitAfterCommand = true` so Ghostty doesn't silently respawn a local login shell — a dead VM stays visibly dead instead of masquerading as a healthy local prompt.
  - **Persistent daemon sessions**: with `preserveAfterTerminalExit` + a `persistentDaemonSlot`, the remote PTY survives terminal close and can be re-attached after app restart (foreground-auth handshake + reusable SSH ControlMaster).
- `sidebarFinderDirectory()` returns `nil` for remote workspaces (no local Finder reveal for remote dirs).

### Reveal in Finder [AppKit-only, concept portable]
- `WorkspaceFinderDirectoryOpener.openInFinder` resolves the workspace's representative local directory, re-checks existence off the main thread, and calls `NSWorkspace.shared.activateFileViewerSelecting`. If the dir is gone, it **beeps** (`NSSound.beep()`) rather than failing silently.

### Prompt submit & iMessage-mode reordering [Portable]
- When an agent's `UserPromptSubmit` hook fires, the workspace records the submitted message (`recordSubmittedMessage`) and publishes `workspace.prompt.submitted` on the event bus.
- In **iMessage mode**, submitting a prompt (or the assistant's final message) **floats the workspace to the top** of the sidebar (`moveTabToTop`), mimicking a chat app's most-recent-on-top ordering. Group-internal sort vs whole-group floating are independently configurable (`IMessageModeGroupSortSettings`).

### Unread / attention indicators [Portable]
- Per-panel unread dots: notification-driven, manual-unread (user-marked), and restored-unread (from a previous session). A workspace can be "manually unread" with a single *representative* panel showing the dot. There's also a tmux-style overlay experiment that paints unread/flash rectangles directly over pane geometry (`TmuxWorkspacePaneOverlayModel`, flash tokens per workspace).

### Appearance / theming [Partly portable]
- The workspace's chrome (tab strip, split dividers, unfocused-split dim) tracks Ghostty's live theme: background, foreground, cursor, selection, opacity, blur. Theme changes are debounced/coalesced and **deferred while the workspace is hidden**, then flushed on becoming visible (`deferredThemeRefresh`).

---

## Implementation

### State ownership & data flow
- **`Workspace`** is `@MainActor`-ish `ObservableObject` with dozens of `@Published` properties. It is the single source of truth for one workspace's panels and side state.
- **Bonsplit** (a separate package) owns the *visual* split/tab tree and focus; `Workspace` owns the *semantic* panel objects and bridges via `surfaceIdToPanelId` / `panelIdFromSurfaceId`. Bonsplit callbacks are wired in `Workspace.init`: `onFileDrop`, `onExternalTabDrop`, `onExternalFileDrop`, `onTabCloseRequest`, `onTabZoomToggleRequest`, `tabContextMoveDestinationsProvider`, fork-conversation providers.
- `WorkspaceContentView` renders `BonsplitView(controller:)` with a per-tab content closure that looks up the `Panel` and wraps it in `PanelContentView`. Visibility is decided by `panelVisibleInUI(isWorkspaceVisible:isSelectedInPane:isFocused:)`.

### Surface configuration [AppKit-only / FFI]
- `WorkspaceSurfaceConfig.swift` (`CmuxSurfaceConfigTemplate`) is a Swift mirror of Ghostty's C `ghostty_surface_config_s` (font size, working dir, command, env vars, initial input, `wait_after_command`).
- New surfaces *inherit* config from a source surface via `cmuxInheritedSurfaceConfig`, including **runtime zoom font size** (read via `CTFontGetSize` on the live surface), making zoom inheritance explicit even when Ghostty's own inherit-font-size is off.
- `cmuxSurfacePointerAppearsLive()` does a best-effort liveness check on the raw C pointer using `malloc_zone_from_ptr` / `malloc_size` — a Swift wrapper can hold a non-nil `ghostty_surface_t` after the native surface was freed.

### Workspace initialization (`Workspace.init`)
- Builds the Bonsplit configuration (splits allowed, close-last-pane disallowed, cross-pane move allowed, auto-close empty panes, keep-all-alive).
- Removes Bonsplit's default "Welcome" tab(s) *after* creating the real initial surface.
- Two init paths: (a) `initialDetachedSurface` → `attachDetachedSurface` adopts the live panel into the first pane; (b) normal → creates a fresh `TerminalPanel`.
- Working directory defaults to `homeDirectoryForCurrentUser` when blank.

### Detached surface transfer (`Workspace+DetachedSurfaceTransfer.swift`, `detachSurface`, `attachDetachedSurface`, `TabManager+DetachedWorkspace.swift`)
- `detachSurface(panelId:)`: marks the tab as detaching (`detachingTabIds` + `forceCloseTabIds`), increments `activeDetachCloseTransactions`, closes the Bonsplit tab, and pulls the prepared `DetachedSurfaceTransfer` out of `pendingDetachedSurfaces` (populated during the close path). For the *last* remote terminal it sets `skipControlMasterCleanupAfterDetachedRemoteTransfer` and stamps the remote cleanup config onto the transfer so the SSH ControlMaster is reused by the destination, not torn down.
- `attachDetachedSurface(...)`: validates the target pane exists and the panel isn't already present, then *replays* every side-state field from the snapshot (directories, TTY, titles, pin, unread, restored indicators) before creating the Bonsplit tab and adopting agent runtime state.
- `TabManager.addWorkspace(fromDetachedSurface:)`: creates the destination workspace under `withExtendedLifetime` of `(tabs, sourceWorkspace, detached.panel)` to guarantee the live panel isn't deallocated mid-move, inherits cwd/font/chrome from the source, clamps insert index against the pinned block, and optionally selects + focuses the moved panel.

### Background priming (`BackgroundWorkspacePrimeCoordinator.swift`)
- `primePendingBackgroundWorkspaces` loops over sorted pending IDs, calling `primeBackgroundWorkspaceIfNeeded` per workspace.
- Per workspace it `retainBackgroundWorkspaceMount` (keeps a hidden SwiftUI mount alive so the surface can actually start), runs `stepBackgroundWorkspacePrime`, and if still pending awaits readiness via a `Waiter` with a 2s timeout.
- Readiness signals: `.terminalSurfaceDidBecomeReady`, `.terminalSurfaceHostedViewDidMoveToWindow` notifications, plus Combine sinks on `$pendingBackgroundWorkspaceLoadIds` and `$tabs` (so workspace removal also resolves the wait).
- Completion reasons are an explicit enum (`alreadyCleared`, `cancelled`, `noSurfaceWork`, `surfaceReady`, `timeout`, `workspaceRemoved`); a `timeout` keeps the mount retained so the surface can still start later.

### Action dispatcher (`WorkspaceActionDispatcher.swift`) [Portable — pure logic]
- Pure, `@MainActor` static functions over `TabManager`. `Target` carries `workspaceIds` + an `anchorWorkspaceId`. `liveWorkspaceIds` filters to currently-existing, de-duplicated workspaces (defends against stale IDs from menus). `pinState` resolves the anchor (falling back to first live target) and computes the desired pinned direction from the anchor's current state, so a mixed multi-select pins/unpins coherently.

### Remote configuration (`WorkspaceRemoteConfiguration.swift`, `WorkspaceRemoteSSHBatchCommandBuilder.swift`)
- `WorkspaceRemoteConfiguration` is the immutable description of a remote (transport, destination, port, identity, SSH options, relay port/id/token, local socket, terminal startup command, foreground-auth token, agent socket, WebSocket daemon endpoint, persistence flags).
- SSH option handling is heavily normalized:
  - `WorkspaceRemoteSSHOptionFilter` strips transient ControlMaster/ControlPath/ControlPersist for *durable* snapshots, expands `~`, validates persistent-daemon slot against `^[A-Za-z0-9._-]{1,128}$`, and only injects `SSH_AUTH_SOCK` when the agent socket actually exists on disk.
  - `SSHPTYAttachStartupCommandBuilder` generates the `/bin/sh -c` attach script with the reconnect loop, a foreground-auth pre-flight `ssh ... true` that pings `workspace.remote.foreground_auth_ready`, and sensible default keepalive options (`ConnectTimeout=6`, `ServerAliveInterval=20`, `ServerAliveCountMax=2`).
  - `WorkspaceRemoteSSHBatchCommandBuilder` builds *background* helper commands (daemon serve over stdio, socket forward, reverse-relay ControlMaster cancel) with `BatchMode=yes` + `ControlMaster=no` so helpers reuse but never create a master, and `StrictHostKeyChecking=accept-new` when unset.
- `proxyBrokerTransportKey` / `hasSamePersistentPTYIdentity` produce a canonical identity string so two configs that should share an SSH connection/broker are recognized as equal (durable options only, normalized identity path).

### Appearance resolution (`WorkspaceAppearanceResolution.swift`, `WorkspaceContentView.refreshGhosttyAppearanceConfig`)
- `resolveGhosttyAppearanceConfig` loads the Ghostty config then overlays the *live* runtime colors from `GhosttyApp.shared` (background/foreground/cursor/selection/opacity), because payload ordering across rapid theme/config updates can lag — the live app color is the source of truth.
- `ghosttyAppearanceSignature` hashes every visible appearance field (colors incl. alpha, opacity, blur, tab-bar font, unfocused-split opacity/fill, divider, host-layer flag) so a refresh is skipped entirely when nothing visible changed.

### Finder/dir resolution (`WorkspaceFinderDirectoryResolver.swift`)
- `path(for:)` expands `~`; `existingDirectoryURL` runs the `FileManager.fileExists(isDirectory:)` check on a detached utility-priority task and double-checks `Task.isCancelled` before and after. Cached by `WorkspaceFinderDirectoryCacheKey`.

### Workspace definition / config-file shape (`CmuxWorkspaceDefinition.swift`)
- The JSON/config representation: `name`, `cwd`, `color`, `layout` (a `CmuxLayoutNode` split tree). Color decoding **hard-fails** on an invalid value (throws `DecodingError`) rather than silently defaulting — it accepts either `#RRGGBB` or a named workspace color, resolved against `UserDefaults` passed through `decoder.userInfo`.

---

## Hardening & Lessons (the gold)

These are the patterns the codebase clearly earned through bugs. Many translate directly to a web app.

1. **Keep focused content visible during reparenting.** `panelVisibleInUI` returns true if `isSelectedInPane || isFocused`. Comment: "During pane/tab reparenting, Bonsplit can transiently report selected=false for the currently focused panel. Keep focused content visible to avoid blank frames." → **[Portable]** In React, don't unmount the active panel just because a layout-engine prop momentarily says "not selected" during a drag/move.

2. **Disable drop targets on inactive (but alive) workspaces.** Inactive workspaces stay mounted in a ZStack for state preservation, but their views can still intercept drags; `bonsplitController.isInteractive = isWorkspaceInputActive` turns acceptance off. → **[Portable]** Keep hidden panes mounted for instant switching, but gate pointer/drop handlers behind an `isActive` flag.

3. **Recreate the subtree on zoom to kill stale chrome.** `.id(splitZoomRenderIdentity)` forces a fresh view identity on zoom enter/exit so pre-zoom pane chrome can't stack over portal-hosted (browser) content. → **[Portable]** Use a `key` change to force-remount when a layout mode flip could leave orphaned overlay DOM.

4. **Defer expensive theme refresh while hidden, then flush on show.** `refreshGhosttyAppearanceConfig` stashes a `DeferredThemeRefresh` when `!isWorkspaceVisible` and replays it in `onChange(of: isWorkspaceVisible)`. It also short-circuits via `ghosttyAppearanceSignature` when nothing visible actually changed. → **[Portable]** Don't run layout/paint-heavy updates for off-screen tabs; coalesce and apply on reveal, and diff before applying.

5. **Live runtime color beats notification payload.** Theme payloads can arrive out of order across rapid updates, so appearance is resolved from `GhosttyApp.shared.defaultBackgroundColor` (current truth) instead of the notification's embedded color. Extensive `logTheme` breadcrumbs trace every step. → **[Portable]** When events can race, re-read current state rather than trusting the event's snapshot.

6. **Best-effort liveness check on freed native handles.** `cmuxSurfacePointerAppearsLive` guards against a Swift wrapper holding a dangling `ghostty_surface_t` after the native surface freed (`malloc_zone_from_ptr`/`malloc_size`). → **[AppKit/FFI-only]** but the lesson — *defensively validate handles that can outlive their backing object* — applies to any wrapped resource (e.g. a WebSocket whose server side already closed).

7. **Detach transaction bookkeeping with guaranteed cleanup.** `detachSurface` uses `detachingTabIds` + `forceCloseTabIds` markers, a counter `activeDetachCloseTransactions` decremented in `defer`, and rolls back all three if `closeTab` is rejected. The whole detached-workspace creation runs under `withExtendedLifetime((tabs, sourceWorkspace, detached.panel))` so the live surface can't be GC'd mid-move. → **[Portable]** Treat "move surface across containers" as a transaction with explicit in-flight markers and rollback; pin the object's lifetime across the move.

8. **Remote ControlMaster handoff, not teardown, on detach.** When detaching the *last* remote terminal, cleanup is *skipped* and the remote cleanup config is stamped onto the transfer so the destination workspace reuses the existing SSH master. → **[Concept]** When migrating a connection-backed surface between containers, transfer ownership of the connection rather than closing+reopening.

9. **Explicit completion-reason enums for async waits.** `BackgroundWorkspacePrimeCoordinator` resolves with a named reason (`timeout`, `surfaceReady`, `workspaceRemoved`, …) and a `timeout` deliberately *keeps* the retained mount so pending initial commands can still start later. → **[Portable]** Model async readiness with explicit outcomes, not just success/fail; a timeout shouldn't necessarily abandon the work.

10. **Cancellation-safe continuation `Waiter`.** The `Waiter` class uses an `NSLock` (not actor isolation) so cancellation handlers — which can't await an actor hop — can synchronously resolve the continuation, drain cleanup actions exactly once, and add-cleanup runs immediately if already resolved. `deinit` finishes with `.cancelled`. → **[Portable concept]** Single-resolution promise with synchronous teardown; in JS, an `AbortController`-aware promise that idempotently settles and always runs cleanup.

11. **Hard-fail on bad config, don't paper over it.** `CmuxWorkspaceDefinition` throws on an invalid color instead of falling back. Matches the project's "don't accept ambiguous shapes" rule. → **[Portable]** Validate config strictly with a clear error message naming the bad value and the expected format.

12. **Keep PTY open after the command exits for remotes.** `waitAfterCommand = true` so a dead VM doesn't silently become a local shell. The reconnect loop only retries on SSH transport codes (254/255) and surfaces a visible reattach banner with attempt counters. → **[Portable]** Make remote/disconnected states *visibly* distinct from a fresh healthy session; bound retries and show progress.

13. **Stale-ID hygiene in dispatchers.** `liveWorkspaceIds` filters menu/command-supplied IDs to currently-existing, de-duplicated workspaces before acting; `pinState` falls back to the first live target if the anchor vanished. → **[Portable]** Re-validate IDs from menus/commands against current state at dispatch time (the user may have closed the target since the menu opened).

14. **Gate reorder notifications on genuine change.** `paneLayoutVersion` is only bumped when `orderedPanelIds` actually changes, so divider drags and selection-only events don't spam `objectWillChange`. → **[Portable]** Diff before notifying; layout engines emit far more geometry events than semantic changes.

15. **Off-main filesystem checks with double cancellation guards.** Finder/dir existence checks run on detached tasks and check `Task.isCancelled` both before dispatching and after returning. → **[Portable]** Never block the UI thread on `fs.exists`; re-check cancellation after async hops.

16. **Agent runtime ownership reconciliation.** On detach/close, agent PIDs + status entries are captured, transferred, and on the source side `discardClosedPanelLifecycleState` exhaustively removes ~25 distinct per-panel dictionaries (directories, branches, PRs, titles, unread, shell-activity, lifecycle, TTY, remote PTY, scrollback, ports, font inheritance, notifications). Structured agent-hook PID keys clear *other* stale runtimes on the same panel when a new one is recorded. → **[Portable]** When a surface moves/closes, have one exhaustive teardown function; orphaned side-state across many maps is a classic leak. Centralize it.

17. **SSH cleanup process has a timeout + force-terminate.** `requestSSHControlMasterCleanupIfNeeded` runs `ssh -O exit` off a dedicated queue, waits 5s on a semaphore, force-`terminate()`s if still running, then waits 1 more second. nulls stdin/stdout/stderr. → **[Portable concept]** External cleanup processes need timeouts and forced kill — never await them unbounded.

18. **Telemetry & breadcrumbs everywhere.** `sentryBreadcrumb("workspace.create.fromDetachedSurface")`, extensive `cmuxDebugLog` around detach/attach/prime with elapsed-ms, `UITestRecorder` counters, and a DEBUG-only `/tmp/cmux-panel-debug.log` written when a tab has no backing panel ("PANEL NOT FOUND"). → **[Portable]** Instrument the move/create/prime hot paths; log the *invariant violations* you don't expect to happen.

---

## Key Files

| File | Role |
|---|---|
| `Sources/Workspace.swift` | Core `Workspace` `ObservableObject`; panels, bonsplit bridge, init, detach/attach, remote controllers, ~25 per-panel state maps, agent PID tracking. (~823KB) |
| `Sources/WorkspaceContentView.swift` | SwiftUI render of a workspace via `BonsplitView`; per-tab `PanelContentView`, visibility logic, deferred theme refresh, tmux overlay model, `EmptyPanelView`. |
| `Sources/WorkspaceSurfaceConfig.swift` | `CmuxSurfaceConfigTemplate` (Ghostty C config mirror), surface config inheritance incl. runtime zoom font, native-pointer liveness check. |
| `Sources/WorkspaceActionDispatcher.swift` | Pure pin/unpin logic over `TabManager` with anchor resolution and stale-ID filtering; `WorkspacePinCommands` menu glue. |
| `Sources/Workspace+PanelLifecycle.swift` | Agent runtime state capture/adopt/discard; `discardClosedPanelLifecycleState` exhaustive per-panel teardown. |
| `Sources/Workspace+DetachedSurfaceTransfer.swift` | `DetachedSurfaceTransfer` + `DetachedAgentRuntimeState` snapshot structs for moving a live surface. |
| `Sources/TabManager+DetachedWorkspace.swift` | `addWorkspace(fromDetachedSurface:)` — creates a new workspace around a live panel, inherits chrome/cwd/font, clamps insert index, lifetime-pins the panel. |
| `Sources/BackgroundWorkspacePrimeCoordinator.swift` | Warms hidden workspaces' terminal surfaces with a 2s timeout; cancellation-safe `Waiter`, explicit completion reasons. |
| `Sources/WorkspaceRemoteConfiguration.swift` | Immutable remote (SSH/WS) config; SSH option normalization, persistent PTY restore, foreground-auth, proxy-broker identity, session snapshots. |
| `Sources/WorkspaceRemoteSSHBatchCommandBuilder.swift` | Background SSH helper command builders (daemon serve, socket forward, reverse-relay ControlMaster) with BatchMode/ControlMaster=no. |
| `Sources/WorkspaceFinderDirectoryResolver.swift` | Resolves & existence-checks a workspace's local dir off-main; `WorkspaceFinderDirectoryOpener` reveals in Finder (beeps on missing). |
| `Sources/WorkspaceAppearanceResolution.swift` | `resolveGhosttyAppearanceConfig` (live-color overlay) + `ghosttyAppearanceSignature` for change-detection. |
| `Sources/WorkspacePromptSubmit.swift` | Prompt/assistant-message extraction from agent hooks; iMessage-mode "float to top" reordering; `conversationMessagePreview`. |
| `Sources/CmuxWorkspaceDefinition.swift` | Config-file shape (`name/cwd/color/layout`); strict color decoding that hard-fails. |
| `Sources/WorkspaceTabColorResolution.swift` | Resolves workspace tab color (hex/named). |
| `Sources/WorkspaceCloseTabsBatching.swift` | Batches multi-tab close operations. |
| `Sources/WorkspaceSurfaceIdentifierClipboardText.swift` | Copy surface/workspace identifiers to clipboard. |
| `Sources/RemoteInteractiveShellBootstrapBuilder.swift` | Builds the remote zsh/bash integration bootstrap script used by restored remote shells. |
| `cmuxTests/WorkspaceActionDispatcherTests.swift`, `WorkspacePromptSubmitTests.swift`, `WorkspaceRemoteConnectionTests.swift`, `WorkspaceAppearanceConfigResolutionTests.swift`, `WorkspaceContentViewVisibilityTests.swift`, `WorkspaceSSHFishShellTests.swift` | Unit coverage pinning the hardened behaviors (visibility, pin logic, prompt reorder, SSH command shapes, appearance signature). |

---

### Portability summary for the web app
- **Portable now**: workspace-as-tab model, pinning with anchor-based multi-select, iMessage float-to-top on prompt submit, unread/attention indicators with a representative surface, background priming of hidden tabs, deferred/diffed appearance updates for off-screen tabs, transactional surface move with rollback + lifetime pinning, exhaustive centralized teardown, strict config validation, stale-ID re-validation at dispatch, explicit async completion reasons.
- **Concept-portable (needs a web analog)**: detached surface transfer (= move a live iframe/terminal between layout containers without remount), remote-connection handoff on move (transfer the socket, don't reconnect), keep-PTY-open-after-exit (visibly distinguish a dead remote session).
- **AppKit/FFI-only**: Ghostty C surface config + native-pointer liveness, `NSWorkspace`/`NSSound` Finder reveal, Bonsplit-specific reparenting quirks, SSH ControlMaster process management.
