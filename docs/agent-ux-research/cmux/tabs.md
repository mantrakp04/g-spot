# cmux — Tabs / Vertical Tabs Sidebar

Research notes mined from the cmux source tree (`/tmp/cmux-analysis`). This bucket
covers the tab model, the vertical tabs sidebar, tab items, reordering / drag,
tab colors, close/restore, move-tab-to-new-workspace, and the per-surface tab bar
actions.

> **Terminology gotcha that defines this whole area:** in cmux a "Tab" *is* a
> **Workspace**. `TabManager.swift` opens with:
> `// The old Tab class is replaced by Workspace`. The sidebar shows one row per
> **workspace**; `TabManager.tabs: [Workspace]` is the ordered list. Inside a
> workspace there are **panes** (Bonsplit split tree) and **panels/surfaces**
> (a terminal or browser inside a pane), and the *pane-level tab strip* (Bonsplit)
> is a second, nested tab concept. So "tab" is overloaded: (1) sidebar workspace
> rows, (2) Bonsplit per-pane surface tabs. Both appear in this doc.

---

## Overview

cmux is a macOS/AppKit/SwiftUI app. Tabs are rendered as a **vertical sidebar**
(`VerticalTabsSidebar` in `ContentView.swift`) listing workspaces, optionally
grouped into collapsible **Workspace Groups**. Each row (`TabItemView`) can be
pinned, colored, renamed, grouped, multi-selected, reordered by drag (within a
window *and* across windows), moved to another window/new window, and closed
(with confirmation + undo-style restore via `ClosedItemHistoryStore`).

Two distinct drag systems coexist:
1. **Sidebar workspace reorder/move** — SwiftUI `.onDrag` / `DropDelegate`
   (`SidebarTabDropDelegate`) driving `SidebarDragState`.
2. **Bonsplit pane-tab drag** — AppKit `NSDraggingInfo` pasteboard flow
   (`SidebarBonsplitTabWorkspaceDropView`) for dragging an *individual surface
   tab* out of a pane into an existing or new workspace.

State ownership is split: `TabManager` (an `ObservableObject`) owns the workspace
list + group model + persistence/git/PR polling; the SwiftUI sidebar owns
transient drag/selection UI state (`SidebarDragState`, `selectedTabIds`,
`lastSidebarSelectionIndex`).

---

## Features & UX

### Sidebar workspace rows
- **One row per workspace**, in order. Selecting a row focuses that workspace.
- **Active-tab indicator** styles are configurable (`SidebarActiveTabIndicatorStyle`).
- **Unread / notification counts** per row (`notificationStore.unreadCount`); a
  collapsed group's anchor shows the *sum* of its members' unread counts.
- **Keyboard number shortcuts**: Cmd+digit jumps to the Nth workspace
  (`WorkspaceShortcutMapper.digitForWorkspace`). Holding the modifier reveals
  per-row shortcut hint pills (`modifierKeyMonitor.isModifierPressed`).
- **Per-row detail toggles** (settings-driven): git branch, directory, PR status,
  metadata, log line, progress, listening ports, custom description. Compact vs
  vertical branch/dir layout. Last-path-segment-only option.

### Pin / color / rename
- **Pin**: pinned workspaces are clamped to a *leading contiguous block*; all
  reorder/insert math enforces "pinned stay at front" (see Hardening).
- **Custom color**: per-workspace hex color, set from a palette or a custom
  `#RRGGBB` entry (`alert.customColor` NSAlert with hex validation). Palette is
  user-editable & persisted; colors are auto-**brightened for dark appearance**
  (`brightenedForDarkAppearance`). Group config (`.cmux` file, keyed by cwd) can
  supply a default color/icon resolved via `resolveWorkspaceGroupConfig(forCwd:)`.
- **Rename / custom description** via inline prompt; clearing reverts to derived
  title.

### Multi-select
- `selectedTabIds: Set<UUID>` + `lastSidebarSelectionIndex` anchor for Shift-range
  selection. Cmd-click toggles; Shift-click extends a range from the anchor.
- Batch context-menu actions operate on the whole selection: close, color,
  group, move to window/new window, mark read/unread.
- Selection is reconciled after every mutation (`syncSelectionAfterMutation`,
  `SidebarWorkspaceSelectionSyncPolicy`).

### Workspace Groups (collapsible sections)
- "New Group from Selection" / "New Group from Workspace", "Move to Group",
  "Remove from Group" context-menu items (`TabItemView+WorkspaceGroups.swift`).
- Group **anchor** workspace represents the group in the list; group header
  (`SidebarWorkspaceGroupHeaderView`) supports collapse, rename, pin, ungroup,
  delete (with confirm), per-cwd config-driven context-menu items, and a `+`
  button that creates a new workspace inside the group at a configured placement.
- Anchors can't change group via drag (their identity owns the group); members
  join/leave a group based on drop neighbors (`applyDragInferredGroupMembership`).

### Reorder / drag (within window)
- Drag a row to reorder. A **drop indicator** line (`SidebarDropIndicator`,
  top/bottom edge of target row) shows where it'll land.
- **Auto-scroll**: dragging near the top/bottom of the sidebar scrolls it
  (`SidebarDragAutoScrollController`, 60 Hz timer in `.eventTracking` mode, prefers
  AppKit `NSClipView.autoscroll(with:)`).
- Dragging an anchor moves the *entire group*; dragging a member can promote it
  out of the group (top-level rows mode).
- Pinned/unpinned legality enforced live during hover (indicator clamps).

### Cross-window drag
- Drag a workspace row from window A's sidebar into window B's sidebar to **move
  it into window B** at the hovered position. Multi-selection moves together; the
  grabbed workspace gets focus.
- Group **anchors cannot be cross-window dragged** (would dissolve the group).
- Mixed pinned/unpinned selections are split into "pin tiers" so they land as a
  contiguous block in the right region (see Hardening).

### Move tab/surface to a new (or existing) workspace
- Right-click a terminal surface → **"Move Tab to New Workspace"** or
  **"Move Tab" → \<target workspace\>** submenu
  (`GhosttyNSView+MoveTabToNewWorkspace.swift`). Only enabled when the source
  workspace has >1 panel (you can't strip the last surface).
- Drag a Bonsplit surface tab into the sidebar: drop **on a row** = move into that
  workspace; drop **on a row edge / empty area** = create a new workspace at that
  index (`SidebarDropPlanner.workspaceAction`).
- CLI parity: `cmux move-tab-to-new-workspace`, `cmux move-surface`,
  `cmux reorder-surface`, `split-off` — all with `--tab/--surface/--workspace/
  --window/--before/--after/--index/--focus` flags
  (`CLI/CMUXCLI+MoveTabToNewWorkspace.swift`).

### Close / restore
- Close a workspace, "Close Other Tabs", "Close Tabs Above/Below"
  (`closeTabs/closeOtherTabs/closeTabsBelow/closeTabsAbove` in `ContentView.swift`).
- **Confirmation** for tabs needing it (running process / multiple tabs); the
  "Close other tabs?" dialog lists the affected tab titles
  (`CloseOtherTabsConfirmationPrompt`, `WorkspaceCloseTabsBatching.swift`).
- Pinned tabs are skipped by default unless `allowPinned`.
- **Restore closed item** (Cmd-Shift-T style): `ClosedItemHistoryStore` keeps a
  persisted history of closed panels, workspaces, and *whole windows*; restoring
  reopens the most recently closed restorable item, re-creating its session
  snapshot at its original index/pane.

### Per-surface tab bar built-in actions
- The Bonsplit pane tab bar can host action buttons: New Workspace, Cloud VM,
  New Terminal, New Browser, Split Right, Split Down
  (`CmuxSurfaceTabBarBuiltInAction`). Config IDs are aliased liberally (e.g.
  `cmux.cloudvm`/`cloudVM`/`startCloudVM` all map to `.cloudVM`).

---

## Implementation

### Data model & state ownership
- **`TabManager`** (`ObservableObject`, `@MainActor`) — `Sources/TabManager.swift`
  (~413 KB, the spine). Owns `tabs: [Workspace]`, `selectedTabId`,
  `workspaceGroups: [WorkspaceGroup]`, plus a large amount of background polling
  (git metadata, PR status, agent PID sweeps). `Workspace` is the real "tab"
  object; `Tab` is only a backwards-compat alias.
- **`SidebarDragState`** (`ContentView.swift`, `@Observable`-style class held via
  `@State`) — transient drag identity (`draggedTabId`), `dropIndicator`,
  `foreignDraggedIsPinned`, `originatedActiveDrag`. Plus the process-global
  `SidebarWorkspaceDragRegistry` (single active drag id, set synchronously).
- **Selection**: `@Binding selectedTabIds: Set<UUID>` and
  `lastSidebarSelectionIndex: Int?` live in the SwiftUI layer; reconciled via
  `SidebarWorkspaceSelectionSyncPolicy`.

### Sidebar view tree (AppKit + SwiftUI)
- `VerticalTabsSidebar` (SwiftUI) hosts a `ScrollView` of `TabItemView` rows and
  group headers. It injects `TabManager`, `TerminalNotificationStore`,
  `CmuxConfigStore` via `@EnvironmentObject`.
- `TabItemView: View, Equatable` — rows are made `Equatable` and fed *value
  snapshots* (`SidebarWorkspaceSnapshotBuilder.Snapshot`) so the row's `==` short-
  circuits re-renders; **rows are forbidden from reading the `@Observable` store
  directly** (snapshot-boundary rule, enforced by passing immutable snapshots like
  `workspaceGroupMenuSnapshot` in).
- Drop targets publish frame anchors via a SwiftUI `PreferenceKey`
  (`sidebarWorkspaceFrameAnchor`, gated by `shouldCollectWorkspaceDropTargets`).

### Reorder pipeline
- Drag start: `dragState.beginDragging(tabId:)` → also registers in
  `SidebarWorkspaceDragRegistry`. Payload = `SidebarTabDragPayload.provider(for:)`
  (UTType `com.cmux.sidebar-tab-reorder`, `ownProcess` visibility).
- Hover: `SidebarTabDropDelegate.dropUpdated` → `updateDropIndicator` →
  `SidebarDropPlanner.indicator(...)` computes the legal insertion (handles pinned
  clamping + a `legalInsertionRange` from `TabManager.sidebarReorderLegalInsertionRange`).
- Drop: `performDrop` → `SidebarDropPlanner.targetIndex(...)` →
  `TabManager.reorderSidebarWorkspace(tabId:toIndex:usesTopLevelRows:)`. Anchors /
  top-level mode route to `reorderTopLevelWorkspaceItem` (moves whole group, then
  `normalizeWorkspaceGroupRunsPreservingOrder` + `syncWorkspaceGroupsOrderToAnchorOrder`).
- `SidebarDropPlanner` is pure/value-based (CoreGraphics + Foundation only) → fully
  unit-testable (`SidebarTabDropIndicatorPredicateTests`).

### Cross-window move
- `SidebarTabDropDelegate.effectiveDraggedTabId` = local `draggedTabId` **or**
  `SidebarWorkspaceDragRegistry.currentWorkspaceId`. If the dragged id isn't in
  this window's `tabs`, it's a cross-window drag → `performCrossWindowDrop`.
- The destination window mirrors the foreign id into its own `dragState`
  (`activateForeignDragIfNeeded`) so all the indicator/anchor/failsafe machinery
  (gated on `draggedTabId != nil`) lights up unchanged.
- Planning happens in **top-level id space** (`crossWindowTopLevelTabIds`) and is
  split per pin-tier (`for isPinnedTier in [false, true]`), each tier inserted at
  `base + runningOffset` so the batch stays contiguous and in source order.
- Actual move via `AppDelegate.moveWorkspaceToWindow(workspaceId:windowId:atIndex:focus:)`.

### Bonsplit surface-tab → workspace drop (pure AppKit)
- `SidebarBonsplitTabWorkspaceDropView: NSView` registers for the
  `BonsplitTabDragPayload` pasteboard type. `draggingEntered/Updated/Exited`,
  `prepareForDragOperation`, `performDragOperation`, `concludeDragOperation`.
- A `TargetBridge` (`NSViewRepresentable` coordinator) pushes the live list of
  `WorkspaceDropTarget` frames (collected via SwiftUI frame anchors) into the NSView.
- Move actions resolve through `AppDelegate`:
  - `moveBonsplitTab(tabId:toWorkspace:)` / `moveSurface(panelId:toWorkspace:)`
  - `moveBonsplitTabToNewWorkspace` / `moveSurfaceToNewWorkspace`
- `moveSurfaceToNewWorkspace` (`AppDelegate+MoveTabToNewWorkspace.swift`):
  `detachSurface` → `addWorkspace(fromDetachedSurface:)` → cleanup empty source →
  focus. Returns a `SurfaceNewWorkspaceMoveResult` with src/dst window+workspace+pane.

### Tab colors
- `WorkspaceTabColorSettings` (in `TabManager.swift`) — palette persisted in
  `UserDefaults`, legacy key migration (`legacyCustomColorsKey`), normalization
  (`normalizedHex`), name resolution, dark-mode brightening,
  `paletteCacheFingerprint` for cache invalidation
  (`WorkspaceTabColorResolution.swift`).
- Apply: `TabManager.setTabColor` / `applyWorkspaceColor(_:toWorkspaceIds:)` /
  `applyWorkspacePaletteColor(named:)` (batch-aware). Groups have their own
  `customColor` (`workspaceGroups[i].customColor`).

### Close / restore
- `ClosedItemHistoryStore` (`ObservableObject`) holds
  `[ClosedItemHistoryRecord]` of `.panel | .workspace | .window` entries with a
  `revision` counter. Optional `capacity`, persisted to a JSON file via a dedicated
  **`ClosedItemHistoryPersistenceActor`** (off-main writes, revision-tagged).
- `restoreFirstRestorable(newerThan:excluding:onFailure:using:)` sorts by
  `closedAt` desc (ties broken by insertion offset), tries each candidate's restore
  closure, and only removes the record on success.
- `AppDelegate+ClosedItemHistory.swift` wires `reopenClosedHistoryItem` /
  `restoreClosedItem` and `clearRecentlyClosedHistory`.

---

## Hardening & Lessons (the gold)

These are explicitly coded defenses — most carry comments referencing the bug they
fix.

### Drag identity races (the big one)
- **Don't read the drag pasteboard synchronously.** `SidebarWorkspaceDragRegistry`
  exists because SwiftUI `.onDrag` delivers `NSItemProvider` data *asynchronously*,
  so a synchronous read inside a `DropDelegate` can race and return `nil`. They keep
  a plain in-process UUID set synchronously on the main actor instead.
- **Stale-clear guard**: `SidebarWorkspaceDragRegistry.end(workspaceId:)` only clears
  if the id still matches, so a superseded drag's teardown is a no-op.
- **Origin ownership**: `SidebarDragState.originatedActiveDrag` ensures *only* the
  window that started the drag clears the process-wide registry. A destination window
  that mirrors a foreign id for rendering must not clear it on its own reset.
- **Cache foreign pin state once** (`foreignDraggedIsPinned`): pin state can't change
  mid-drag, so resolve it when mirrored in and reuse per hover — avoids an
  `AppDelegate.tabManagerFor` scan over every window on every pointer-move.

### Drag failsafe / lifecycle
- `SidebarDragFailsafeMonitor` clears a stuck drag state on: mouse-up (local +
  **global** monitors, since the drop may land outside the app), Escape key,
  `NSApplication.didResignActiveNotification`, and even *at monitor start* if the
  left button isn't actually down (`shouldRequestClearWhenMonitoringStarts`). Clears
  are debounced via a single pending `DispatchWorkItem` (coalesced).
- `isSimulated` flag suppresses the failsafe for debug-only synthetic drags (no real
  mouse is pressed), so simulation doesn't immediately self-cancel.
- `SidebarDragAutoScrollController.tick` bails the moment `NSEvent.pressedMouseButtons == 0`
  (drag ended unexpectedly) and runs on `.eventTracking` runloop mode so it ticks
  during the modal drag loop.

### Pinned-block invariant (clamping everywhere)
- Every insertion path clamps so pinned tabs form a leading contiguous block:
  `legalInsertionPosition`, `legalCrossWindowInsertionPosition`,
  `legalNewWorkspaceInsertionIndex`, `clampedDetachedWorkspaceInsertIndex`.
- Subtle case explicitly handled: a *pinned* workspace dragged into a window with
  **zero** existing pins must still land at index 0, not at the pointer — otherwise
  it'd sit under unpinned rows and break the invariant (comment in
  `legalCrossWindowInsertionPosition`).

### Group integrity
- Cross-window **anchor** drags are rejected in both `validateDrop` and
  `performCrossWindowDrop` — moving only the anchor would dissolve the source group
  and strand members.
- `applyDragInferredGroupMembership` documents the ambiguous "last slot of group vs.
  first slot after group" case and deliberately biases toward "reordering within the
  group", because neighbor inspection can't distinguish them; explicit "Remove from
  Group" is the escape hatch.
- Cross-window batch: planning per pin-tier with a running offset, recomputed against
  the *live* destination each tier, "otherwise re-anchoring to the hovered row would
  reverse the batch."

### Move-surface atomicity
- `moveSurfaceToNewWorkspace` **rolls back** the detached surface to its original
  pane/index if `addWorkspace(fromDetachedSurface:)` fails
  (`rollbackDetachedSurface`). Guarded by `panels.count > 1` (never strip the last
  surface).
- Cross-window focus is re-asserted after the move
  (`reassertCrossWindowSurfaceMoveFocusIfNeeded`) because focus can be lost crossing
  window boundaries.
- Browser panels get a special activation intent (`.browser(.addressBar)`) so a moved
  browser tab shows chrome even if web content was the last responder.

### Close confirmation
- `closeConfirmationInFlight` mutex (`beginCloseConfirmationSession`) prevents
  overlapping confirm dialogs; reset is deferred to the next runloop
  (`endCloseConfirmationSession` uses `DispatchQueue.main.async`) so a re-entrant
  close can't slip in before the alert fully tears down.
- The close dialog wires Enter→Close and Esc→Cancel explicitly and sets the default
  button cell / initial first responder.

### Restore persistence robustness
- Writes go through a dedicated actor, are **revision-tagged** so a stale async write
  can be ignored, and there's a synchronous `flushPendingSaves()` (with semaphore)
  for app-termination.
- Mutations that arrive *before* the async load finishes are queued
  (`pendingPersistedRecordMutations`: remap workspace/panel/window ids, remove panel
  records) and replayed after load — handles id remapping when sessions are restored
  under new ids.
- `removeAll()` before load sets `shouldDiscardPersistedRecordsOnLoad` so an
  in-flight load can't resurrect cleared history.
- `insert(at:)` protects the just-inserted record's id when trimming to capacity.

### Hot-path pointer perf
- `BonsplitTabBarPassThrough` caps the recursive view-tree walk to a 200pt band below
  the titlebar (`tabStripScanBandHeight`) because `mouseMoved`/`cursorUpdate` fire on
  every hover; below the band it short-circuits without scanning.
- It walks only siblings *below* the portal host (not the whole window tree) to avoid
  false-positive pass-through against a tab bar painted *above* an unparented host.

### Selection consistency
- Group collapse posts `sidebarMultiSelectionDidHide` to strip only hidden ids from
  the selection without wiping the rest or moving focus.
- Keyboard nav posts `sidebarMultiSelectionShouldCollapse` to collapse a stale
  Shift-click range to the newly-focused workspace, "otherwise batch context-menu /
  shortcut actions would still target the stale range."
- A `workspaceCurrentDirectoryDidChange` → `anchorCwdRevision` bump forces re-resolve
  of group config (color/icon/menu/`+` placement) when a non-selected anchor's cwd
  changes, fixing stale group chrome.

### Drag config (macOS 26+)
- `internalOnlyTabDrag()` sets `DragConfiguration` to allow move-within-app but
  **disallow everything outside the app**, "so Finder rejects them instead of
  materializing placeholder files from the payload."

### Telemetry / debug
- Extensive `cmuxDebugLog`/`dlog` breadcrumbs on every drag phase
  (entered/updated/exited/prepare/perform/conclude) with short 5-char ids.
- `sentryBreadcrumb("workspace.create.fromDetachedSurface", ...)` and a `UITestRecorder`
  record key tab operations (`addTabInvocations`, close-confirmation labels) for UI tests.
- `SidebarDragStateRegistry` (DEBUG-only) exposes live drag state per window so the
  `debug.sidebar.simulate_drag` socket method can drive deterministic drags for
  profiling without HID synthesis.

---

## Platform-specific vs portable (for a React/web port)

**Portable concepts (replicate these):**
- The pure planner logic: `SidebarDropPlanner` (indicator/targetIndex/cross-window
  insertion, pinned-block clamping) is value-in/value-out and maps cleanly to JS.
- Drag identity via a synchronous in-memory registry rather than reading the drop
  payload mid-drag — same race exists in HTML5 DnD (`dataTransfer` is restricted
  during `dragover`); keep the dragged id in app state.
- Failsafe drag-clear on blur / Escape / mouseup-anywhere (use `window` listeners).
- Pinned-leading-block invariant + per-tier batch insertion for mixed selections.
- Closed-item history with capacity, revision-tagged persistence, queued
  pre-load mutations, and most-recent-restorable semantics.
- Move-to-new-workspace atomicity: rollback if the create step fails; never strip
  the last surface.
- Snapshot/`Equatable` row rendering → in React, pass memoized value props and
  `React.memo`; forbid rows from reading the global store directly.
- Group membership inference from drop neighbors + explicit "remove from group".

**AppKit-only (needs a web equivalent):**
- `NSView` pasteboard drag (`SidebarBonsplitTabWorkspaceDropView`), `NSClipView.autoscroll`,
  `NSEvent` global/local monitors, `NSAlert`, `NSMenu` context menus,
  `DragConfiguration`/UTType, `.eventTracking` runloop mode, IOSurface/vsync timeline.
- The two-drag-systems split is an AppKit/SwiftUI bridging artifact; a web app can
  unify on one DnD system.
- `BonsplitTabBarPassThrough` hit-testing band optimization is specific to overlapping
  NSViews; not needed with DOM event bubbling.

---

## Key Files

| File | Role |
| --- | --- |
| `Sources/TabManager.swift` | Core: owns `tabs:[Workspace]`, groups, selection, reorder (`reorderSidebarWorkspace`), colors (`WorkspaceTabColorSettings`, `setTabColor`), close confirmation, placement settings, git/PR/PID polling. |
| `Sources/TabManager+CompatibilityTypes.swift` | `SplitDirection`/`ResizeDirection` back-compat enums. |
| `Sources/TabManager+DetachedWorkspace.swift` | `addWorkspace(fromDetachedSurface:)` — create a workspace from a detached surface; pinned-clamped insert index math. |
| `Sources/TabManager+EqualizeSplits.swift` | `equalizeSplits(tabId:)` bridge to `SplitEqualizer`. |
| `Sources/WorkspaceCloseTabsBatching.swift` | `Workspace.closeTabsFromContextMenu`, `CloseOtherTabsConfirmationPrompt` (lists affected tab titles, skip-pinned). |
| `Sources/WorkspaceTabColorResolution.swift` | Hex/palette-name resolution + `paletteCacheFingerprint`. |
| `Sources/CmuxSurfaceTabBarBuiltInAction.swift` | Enum of pane tab-bar action buttons (new workspace/terminal/browser, split, cloud VM) + config-id aliasing. |
| `Sources/ContentView.swift` | Hosts `VerticalTabsSidebar`, `TabItemView`, `SidebarDragState`, `SidebarWorkspaceDragRegistry`, `SidebarTabDropDelegate`, `SidebarDragFailsafeMonitor`, `SidebarDragAutoScrollController`, `SidebarTabDragPayload`, multi-select & close/move-to-window actions. |
| `Sources/Sidebar/SidebarDropPlanner.swift` | Pure drop-indicator / insertion-index planner (intra & cross-window), pinned clamping, workspace-drop actions. |
| `Sources/Sidebar/SidebarBonsplitTabWorkspaceDropOverlay.swift` | AppKit `NSView` drop target for dragging a Bonsplit surface tab into a workspace / new workspace; pending-drop teardown handling. |
| `Sources/Sidebar/InternalTabDragConfiguration.swift` | macOS 26 `DragConfiguration` — move-within-app only, reject outside-app. |
| `Sources/VerticalTabsSidebar+WorkspaceGroups.swift` | Group header view wiring (collapse/rename/pin/ungroup/delete/`+`, drop delegates, config-driven menu). |
| `Sources/TabItemView+WorkspaceGroups.swift` | Row context-menu group section (new group, move to group, remove from group). |
| `Sources/SidebarWorkspaceGroupHeaderView.swift` | The group header SwiftUI view. |
| `Sources/ClosedItemHistory.swift` | `ClosedItemHistoryStore` — closed panel/workspace/window history, capacity, revision-tagged actor persistence, queued pre-load mutations, restore-first-restorable. |
| `Sources/AppDelegate+ClosedItemHistory.swift` | `reopenClosedHistoryItem`, `restoreClosedItem`, `clearRecentlyClosedHistory`. |
| `Sources/AppDelegate+MoveTabToNewWorkspace.swift` | `moveSurfaceToNewWorkspace` / `moveSurface(toWorkspace:)` / Bonsplit variants; rollback + cross-window focus reassert. |
| `Sources/GhosttyNSView+MoveTabToNewWorkspace.swift` | Terminal surface context-menu items: "Move Tab to New Workspace" + "Move Tab → \<target\>" submenu. |
| `Sources/TerminalController+MoveTabToNewWorkspace.swift` | Controller-side wiring of move-to-new-workspace. |
| `Sources/ContentView+MoveTabToNewWorkspace.swift` | View-side wiring. |
| `Sources/BonsplitTabBarPassThrough.swift` | Pointer-event pass-through to the minimal-mode pane tab strip; 200pt scan-band perf cap. |
| `Sources/BonsplitTabBarDebug.swift` | DEBUG-only tunables for pane tab-bar fade/width rendering. |
| `CLI/CMUXCLI+MoveTabToNewWorkspace.swift` | CLI: `move-tab-to-new-workspace`, `move-surface`, `reorder-surface`, `split-off`. |
| `cmuxTests/SidebarTabDropIndicatorPredicateTests.swift`, `BonsplitTabDragUITests.swift`, `PortalTabDragRoutingTests.swift`, `WorkspaceCloseTabsContextMenuTests.swift`, `TabManagerUnitTests.swift`, `AppDelegateMoveTabToNewWorkspaceTests.swift` | Test coverage for the above. |
