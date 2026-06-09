# cmux — Splits & Panes

Research bucket: **splits-panes**. Scope: split layouts (Bonsplit), pane creation/resize/equalize, drag-and-drop pane routing & drop targets (terminal/browser panes), tmux pane overlay.

> Platform note: cmux is a native macOS app (Swift / AppKit / SwiftUI). The split *tree model* lives in an external Swift package called **Bonsplit** (`import Bonsplit`, pasteboard type `com.splittabbar.tabtransfer`). cmux owns the *integration* layer: drop routing, equalize, resize math, geometry reconciliation, lifecycle/teardown. Throughout, I flag **[AppKit-only]** mechanics vs **[Portable]** concepts that translate cleanly to a React/web app.

---

## Overview

cmux organizes each **Workspace** (a tab in the sidebar) as a tree of **panes** managed by `BonsplitController`. A pane is a rectangular slot; each pane has its own **tab strip** of **surfaces** (terminal / browser / file-preview / markdown / agent-session / project panels). The tree alternates `.split` nodes (with an `orientation` of `horizontal`/`vertical`, a `dividerPosition` fraction, and `first`/`second` children) and `.pane` leaves.

The user manipulates this tree four ways:
1. **Split commands** (Cmd+D etc., or buttons in the pane tab bar) — create a new pane next to the current one.
2. **Drag-and-drop routing** — drag a tab/surface onto another pane's edge to split, or onto its center to merge into that pane's tab strip. Files from Finder and file-preview surfaces also route through the same drop machinery.
3. **Resize** — drag dividers, or programmatic relative/absolute resize via the automation API.
4. **Equalize** — a single shortcut (`Ctrl+Cmd+=`) that rebalances every divider to give panes proportional space.

There's also a read-only **tmux pane overlay** that draws attention rings (unread / flash) on top of panes without intercepting input.

Most of the *interesting* code is glue and hardening: making Bonsplit's generic behavior match cmux's product expectations (no empty placeholder panes, no churn during drag, geometry/focus reconciliation after every mutation, suppressing shortcuts during transient focus states).

---

## Features & UX

### Pane creation / splitting
- **Split in 4 directions**: `left | right | up | down` (`parseSplitDirection`). Direction maps to a Bonsplit `orientation` + `insertFirst` flag: left/up = `insertFirst: true`, right/down = `insertFirst: false`; left/right = `horizontal`, up/down = `vertical`.
- **Split seeds a real surface.** Pressing a split button always creates a terminal in the new pane (mirrors Cmd+D). If the source surface is a browser, the new terminal **inherits terminal config from nearby terminals** rather than leaving an empty selector pane (`didSplitPane` auto-create branch, `inheritedTerminalConfig`).
- **New split inherits context**: working directory (source panel's reported cwd → its requested startup cwd → workspace cwd), font/config template, and startup environment (`newTerminalSplit`). For remote/SSH workspaces, the split holds the pane open after the remote session ends (`waitAfterCommand = true`) so the user can read an "ssh exited…" message instead of silently falling through to a local shell.
- **Split a specific surface type**: the automation `pane.create` can spawn a `terminal` or `browser` in the new pane (agent-session is explicitly rejected — only `surface.create` supports it).
- **Optional initial divider position** at creation time (`initialDividerPosition`).

### Pane navigation & movement
- **`pane.last`** — jump focus to "the other" pane (first pane that isn't focused).
- **`pane.swap`** — swap the surfaces of two panes while keeping pane identities stable.
- **`pane.break`** — detach a surface into a brand-new workspace (tab).
- **`pane.join`** — move a surface into a target pane's tab strip (implemented as `surface.move`).
- **`pane.focus` / `pane.list` / `pane.surfaces`** — focus and introspection.

### Drag-and-drop pane routing [partially Portable]
The drop interaction model is the most reusable UX here:
- **5 drop zones per pane**: `left`, `right`, `top`, `bottom`, `center` (`DropZone`, `PaneDropRouting.zone`).
  - Edge zones occupy the outer **25%** of the pane (`edgeRatio = 0.25`) with a **minimum 80pt** band so small panes still have grabbable edges.
  - Hit order matters: left → right → top → bottom → center. Horizontal edges win over vertical when ambiguous.
  - **center** = merge into the target pane's tab strip (`.insert`); edges = split (`.split` with the matching orientation/insertFirst).
- **Animated drop-zone overlay** [AppKit-only mechanics, Portable concept]: a translucent accent-colored rounded rectangle (`PaneDropZoneOverlayAnimator`) snaps to the zone's frame as you hover, fading in (0.18s easeInEaseOut), moving smoothly between zones, and fading out (0.14s easeOut). Two frame variants: a generous `overlayFrame` (8–12pt insets, splits at the half line) and a `compactOverlayFrame` (4pt padding) used by browser panes.
- **Adjacency suppression** (`portalPaneDropZone`): if you drag a pane's tab toward the edge it already borders (e.g. drop on the *left* zone of the pane directly to its right), the zone is rewritten to **center** so you don't create a redundant split that just reproduces the existing layout. Uses `bonsplitController.adjacentPane(to:direction:)`.
- **No-op detection**: dropping a single-tab pane's own tab onto its own center returns success without mutating (`performPortalPaneDrop` / `BrowserPaneDropRouting.action` → `.noOp`).
- **File drops** (from Finder) route through the same zone machinery. The drop can do one of two things based on a **default behavior setting + Shift modifier**:
  - **Drop path text**: inserts shell-escaped file paths into the terminal/editor under the cursor.
  - **Open file preview / split**: opens the files as a preview surface, optionally as a split in the target zone.
  - Default is `text`; **Shift inverts** it. Live hint strings ("Hold Shift to drop into terminal", "Hold Shift to open as split"). Over a browser pane, file drops can also route into the hosted web page itself (web `<input type=file>` / drop handlers).
- **File-preview surfaces** are draggable into browser/terminal panes (`FilePreviewDragRegistry`, `filePreviewTransferType`).
- **Cross-process safety**: every transfer carries `sourceProcessId`; drops only act on transfers `isFromCurrentProcess` (a tab dragged from another cmux window/process is ignored for in-process moves).
- **Tab bar pass-through**: when the pointer is over a pane's tab strip during a drag, the pane drop target *defers* (returns no drag op / no hit) so the tab strip can handle reordering instead (`BonsplitTabBarPassThrough.shouldDeferToPaneTabBar`).

### Pane resize
- **Divider drag** [AppKit-only] — handled inside Bonsplit.
- **Relative resize** (automation `pane.resize`): `direction` (left/right/up/down) + `amount` in pixels. Computes a divider delta = `amount / axisPixels`, applies it to the *correct* split ancestor (the one whose divider controls the requested edge), and **clamps the divider to [0.1, 0.9]** so panes can't collapse to nothing.
- **Absolute resize**: `absolute_axis` (horizontal/vertical) + `target_pixels`. Converts target px to a fraction of the controlling split's axis, accounts for whether the pane is the first/second child, clamps to [0.1, 0.9].
- Both report `old_divider_position` / `new_divider_position` for observability.

### Equalize splits
- **Shortcut**: `Ctrl+Cmd+=` (`StoredShortcut(key: "=", command: true, control: true)`); also a **menu command** "Equalize Splits".
- Recursively walks the tree; for each split, sets the divider so children get space **proportional to how many leaf panes each subtree contains along that orientation** (`spanCount`), not a naive 50/50. So a layout of `[A | [B / C]]` equalizes to give A one-third (1 leaf) and the B/C column two-thirds (2 leaves) horizontally — every leaf ends visually equal.
- Optional `orientationFilter` lets you equalize only horizontal or only vertical splits.
- Returns a `Result { foundSplit, allSucceeded }`; `didFullyEqualize` requires both. After equalizing it fires `didProgrammaticallyChangeSplitGeometry()` to push the new layout to observers/tmux.

### Tmux pane overlay
- A **non-interactive SwiftUI overlay** (`allowsHitTesting(false)`) that draws **attention rings** on panes:
  - **Unread rings** (steady glow) for panes with unseen output.
  - **Flash rings** (animated fade, ~timed `FocusFlashPattern.duration`) when a notification arrives / focus event fires.
- Uses a `Canvas` and a custom `TimelineSchedule` that ticks at **10fps in low-power mode, 60fps otherwise**, and stops emitting once the flash duration elapses. Rings are skipped for panes too small to host the inset path.

---

## Implementation

### Architecture & state ownership
- **`Workspace`** owns a `bonsplitController: BonsplitController` and conforms to `BonsplitDelegate`. The Bonsplit tree is the source of truth for layout; `Workspace` holds the side tables: `panels[UUID: Panel]`, `surfaceIdToPanelId`, `panelTitles`, `panelDirectories`, `remotePTYSessionIDsByPanelId`, etc.
- **IDs**: Bonsplit uses `TabID` (a surface/tab) and `PaneID`. cmux uses panel `UUID`s. Bridging helpers: `panelIdFromSurfaceId`, `surfaceIdFromPanelId`, `paneId(forPanelId:)`, `indexInPane(forPanelId:)`. **Bonsplit tab IDs are pre-generated** before installing the panel mapping so the mapping exists before Bonsplit emits delegate callbacks (`newTerminalSplit`).
- **Delegate callbacks** (`splitTabBar(_:...)`): `didSplitPane`, `didClosePane`, `shouldClosePane`, `didSelectTab`, `didMoveTab`, `didFocusPane`, `didCloseTab`, `shouldCloseTab`, `didChangeGeometry`, `didRequestNewTab`, `didRequestTabContextAction`, `didRequestTabMoveToDestination`. These are how cmux reacts to user-driven tree mutations.

### Drop routing data flow [AppKit]
1. SwiftUI wraps each pane's surface region in an `NSViewRepresentable` (`PaneDropTargetRepresentable`) backing an `NSView` subclass (`PaneDropTargetView` for terminals, `BrowserPaneDropTargetView` for browsers). The view registers dragged types: `bonsplitTabTransferType`, `filePreviewTransferType`, and file-URL types.
2. **`hitTest` gating** decides whether the drop view captures the event at all (`shouldCaptureHitTesting`), based on `WindowInputRoutingContext` (event kind) + which pasteboard payloads are present. This keeps drop views transparent to normal pointer events and only "solid" during relevant drags.
3. `draggingEntered/Updated` compute the zone (`PaneDropRouting.zone`), apply adjacency suppression (`portalPaneDropZone`), show the overlay, and return `.move`/`.copy`/`[]`.
4. `performDragOperation` decodes the transfer (`PaneDragTransfer.decode` — JSON over the pasteboard) and routes:
   - In-process tab transfer → `workspace.performPortalPaneDrop(...)` → builds an `ExternalTabDropRequest` → `handleExternalTabDrop` → `AppDelegate.moveBonsplitTab(...)`.
   - File-preview transfer → consume from `FilePreviewDragRegistry` → `handleFilePreviewDrop`.
   - File URLs → either text insertion (`FileDropTextDropController`) or `handleExternalFileDrop` (opens preview/split).
5. **`handleExternalTabDrop`** also handles **session-index drags** (spawn a new terminal at the destination instead of moving an existing tab) and **file-preview drags** before falling through to the generic move.

### Resize math
- `TerminalControllerPaneResizeSupport.swift` defines `V2PaneResizeDirection` (with computed `splitOrientation`, `requiresPaneInFirstChild`, `dividerDeltaSign`) and `V2PaneResizeCandidate`.
- `v2PaneResizeCollectCandidates` does a **single recursive tree walk** that, for every split ancestor containing the target pane, records the split id, orientation, whether the target is in the first child, current divider position, and the **pixel length of that split's axis** (union of child bounds). Picking the right candidate = the ancestor whose edge the user asked to move.
- Absolute sizing (`v2SetAbsolutePaneSize`) inverts the fraction depending on `paneInFirstChild` and clamps.

### Equalize
- `SplitEqualizer.equalize` (in `SplitEqualizer.swift`) is pure tree math against `ExternalTreeNode` + `BonsplitController.setDividerPosition(_:forSplit:fromExternal:)`. `fromExternal: true` marks it as a programmatic change.
- Wired: `TabManager.equalizeSplits(tabId:)` → `SplitEqualizer.equalize` → on success `Workspace.didProgrammaticallyChangeSplitGeometry()`.
- Triggers: `AppDelegate.performEqualizeSplitsShortcut()` and `cmuxApp.equalizeSplitsCommandButton()` (menu).

### Geometry / focus reconciliation
- **`didChangeGeometry`** is the single funnel for *all* order/membership mutations (reorder, cross-pane move, split, close, divider drag, selection). It:
  - stores `tmuxLayoutSnapshot` (for the tmux overlay),
  - bumps `paneLayoutVersion` **only when the ordered panel-id sequence actually changed** (so divider drags and selection-only events don't trigger app-wide `objectWillChange`),
  - schedules `scheduleTerminalGeometryReconcile()` and (unless mid-detach) `scheduleFocusReconcile()`.

### Concurrency
- Almost everything is `@MainActor`. Automation handlers (`v2Pane*`) hop to main via `v2MainSync { ... }` and mutate the tree synchronously on the main thread, then build their JSON result.

---

## Hardening & Lessons (the gold)

These are the things they clearly learned the hard way — directly portable as *gotchas to design around* even in a web stack.

1. **No empty/placeholder panes after drag-to-split.** When you drag a single-tab pane's only tab onto a split edge, Bonsplit inserts a placeholder "Empty" tab in the source pane to avoid a tabless pane. cmux considers that undesirable, so `didSplitPane` detects "source pane has no real surface" and **reuses the placeholder tab's identity**, swapping in a real terminal panel mapping (`split.placeholderRepair`, `reusePlaceholder`). It explicitly avoids create+close churn because that *"can transiently render an empty pane during drag-to-split of a single-tab pane."* Fallback path creates a terminal then drops leftover placeholders. **Lesson for web: when a drag empties a container, repair it in-place by reusing the existing node, don't tear-down-and-recreate (avoids flicker).**

2. **Programmatic vs user-driven splits must be distinguished.** `isProgrammaticSplit` guards `didSplitPane`: programmatic splits (`newTerminalSplit`) manage their own panels, so the auto-create-terminal branch only runs for UI-driven splits. Without this you'd double-create surfaces.

3. **Divider clamping to [0.1, 0.9].** Every resize path (relative, absolute) clamps so a pane can never collapse to 0 and become unrecoverable.

4. **Equalize is leaf-weighted, not 50/50.** Naive 50/50 per split makes nested layouts look lopsided; weighting by `spanCount` (leaf count along the orientation) makes every leaf visually equal. Subtle but correct.

5. **Suppress split/equalize shortcuts during transient focus states.** `shouldSuppressSplitShortcutForTransientTerminalFocusState` bails when the focused terminal's hosted view is zero-sized, hidden in the hierarchy, detached from a window, or the first responder is the window itself — these indicate the surface is mid-transition (e.g. just attached, animating). It also **reconciles focus from the first responder** before suppressing, so the next keypress lands correctly. **Lesson: gate destructive layout keybindings on "is the focused element actually live and laid out?"**

6. **Cross-process drag rejection.** Transfers embed `sourceProcessId`; in-process move logic only runs for `isFromCurrentProcess`. Prevents corrupting another window's tree when a drag originates elsewhere.

7. **Adjacency-aware zone rewriting.** Dropping toward an edge you already border collapses to "center" (merge) instead of creating a no-op redundant split. Avoids accidental layout bloat.

8. **Pre-generated tab IDs before mapping install.** Bonsplit emits delegate callbacks during a split; if the `surfaceIdToPanelId` mapping isn't installed first, callbacks see an unmapped surface. They generate the tab id up front and install the mapping before handing it to Bonsplit.

9. **`paneLayoutVersion` is bumped surgically.** Only on real order changes, computed by diffing `orderedPanelIds` vs `lastOrderedPanelIds`. Divider drags and selection events route through the same delegate but must not invalidate the whole view tree. **Lesson: a single "layout changed" event source needs change-detection or it becomes a render storm.**

10. **Tab-bar pass-through hot-path optimization.** Hover events fire `shouldPassThroughToPaneTabBar` constantly. They (a) check a fast `BonsplitTabBarHitRegionRegistry` first, (b) **early-out if the pointer is more than 200pt below the content top** (the tab strip can't live there), and only then (c) do a recursive sibling view-tree walk — and only over **siblings rendered below the host**, never the whole window tree (a full-tree fallback *"would risk a false-positive pass-through against a tab bar painted above an unparented host"*). NSView subviews aren't clipped to bounds, so the recursive scan must check `bounds.contains` explicitly. **Lesson: drag/hover hit-testing is a hot path; bound the search region and the search scope.**

11. **Drop-overlay animation has a generation counter.** `PaneDropZoneOverlayAnimator` uses `animationGeneration` to cancel stale fade-out completions — a fade-out completing after a new zone appeared must not hide the freshly-shown overlay. Frames are compared with an epsilon (`rectApproximatelyEqual`, 0.5pt) to avoid pointless re-animations; idempotent `setZone` returns early when nothing changed.

12. **Remote splits hold the pane open.** `waitAfterCommand = true` for remote startup commands, because Ghostty otherwise respawns a local login shell when the remote command exits — *"a dead VM looks identical to a healthy workspace with a local prompt — which is what we saw during dogfood."* Real bug, documented in-code.

13. **Swap keeps pane identities stable.** `pane.swap` inserts temporary placeholder surfaces when a side has ≤1 tab so the panes don't get destroyed/collapsed mid-swap, then moves real surfaces across and closes the placeholders.

14. **Break has rollback.** `pane.break` detaches a surface into a new workspace; if workspace creation fails it **re-attaches the detached surface at its original pane/index** (`attachDetachedSurface`).

15. **Browser portal host re-arm on split.** On `didSplitPane`, browser panes in both the original and new pane get `preparePortalHostReplacementForNextDistinctClaim` — the browser web-view host (an NSView portal) must be re-claimed correctly after the layout changes, or it renders in the wrong pane.

16. **Telemetry / debug counters baked in.** Test-only counters `BonsplitDebugCounters.arrangedSubviewUnderflowCount` (Bonsplit's auto-layout underflow events) and `DebugUIEventCounters.emptyPanelAppearCount` are exposed over the automation socket (`debug.bonsplit_underflow.count`, `empty_panel_count`) and asserted by UI tests — i.e. "empty panes appearing" and "layout underflow" were real regressions they now guard against numerically. Extensive `#if DEBUG` `cmuxDebugLog` tracing at every drop/split/resize stage (`split.didSplit`, `terminal.paneDrop.perform`, `split.timing`, `split.cwd`).

17. **`fromExternal:` flag on divider sets.** Distinguishes programmatic divider changes from user drags so Bonsplit/observers can treat them appropriately.

18. **Tmux overlay never steals input** (`allowsHitTesting(false)`) and **self-terminates its animation** via the timeline `endDate` + a `completedFlashStartedAt` guard, so it doesn't keep redrawing forever after a flash.

### Portable vs AppKit-only
- **Portable concepts**: the 5-zone (edge/center) drop model with 25%/80pt edge bands; merge-on-center vs split-on-edge; adjacency suppression; animated snapping drop overlay with generation-based cancellation; leaf-weighted equalize; divider clamping; relative+absolute resize against the controlling ancestor split; in-place repair of emptied containers; surgical layout-change versioning; gating destructive shortcuts on "is target live & laid out"; rollback on failed detach.
- **AppKit-only mechanics**: `NSView.hitTest` capture gating, `NSDraggingInfo`/pasteboard transfer encoding & cross-process `sourceProcessId`, `NSViewRepresentable` bridging, portal NSView hosting for web views, `BonsplitTabBarHitRegionRegistry` view-tree walks, `NSAnimationContext`/`CATransaction` overlay animation, first-responder focus reconciliation.

---

## Key Files

| File | Role |
| --- | --- |
| `Sources/SplitEqualizer.swift` | Pure tree-walk equalize: leaf-weighted (`spanCount`) divider rebalancing via `setDividerPosition`. |
| `Sources/Workspace+EqualizeSplitsSupport.swift` | `didProgrammaticallyChangeSplitGeometry()` — pushes layout to delegate/tmux after equalize. |
| `Sources/TabManager+EqualizeSplits.swift` | `equalizeSplits(tabId:)` — workspace-level entry; fires geometry change on success. |
| `Sources/AppDelegate+EqualizeSplitsShortcut.swift` | Keyboard-shortcut handler; suppresses during transient focus state. |
| `Sources/cmuxApp+EqualizeSplitsMenu.swift` | "Equalize Splits" menu command button. |
| `Sources/TerminalControllerPaneResizeSupport.swift` | Relative/absolute resize: candidate collection, direction→split mapping, divider clamping. |
| `Sources/PaneDropRoutingSupport.swift` | Core drop model: `DropZone` computation (25%/80pt edges), overlay frames, `PaneDropZoneOverlayAnimator` (generation-guarded animation), `PaneDragTransfer` decode, `PaneDropContext`. |
| `Sources/TerminalPaneDropTargetView.swift` | `PaneDropTargetView` (NSView): hit-test gating, drag enter/update/perform, zone overlay, file-drop-as-text routing, tab-bar pass-through. |
| `Sources/BrowserPaneDropTargetView.swift` | Browser variant: also routes file drops into the hosted WKWebView; file-preview transfers; prepare/conclude drag lifecycle. |
| `Sources/WorkspacePortalPaneDrop.swift` | `portalPaneDropZone` (adjacency suppression) + `performPortalPaneDrop` (zone→`ExternalTabDropRequest`). |
| `Sources/BrowserWindowPortal.swift` | `BrowserPaneDropContext/DragTransfer/DropRouting`, `BrowserPaneDropAction`, `WindowBrowserSlotView`, `BrowserDropZoneOverlayView`. |
| `Sources/DragOverlayRoutingPolicy.swift` | Pasteboard types, file-drop behavior (text vs preview, Shift-inversion), merged modifier flags (AppKit+CGEvent), capture/pass-through policy, `FileDropTextDropController`. |
| `Sources/BonsplitTabBarPassThrough.swift` | Hot-path tab-strip pass-through: registry fast-path, 200pt scan-band cap, sibling-only recursive walk. |
| `Sources/TmuxWorkspacePaneOverlayView.swift` | Non-interactive attention-ring overlay (unread + flash) with adaptive-FPS `TimelineSchedule`. |
| `Sources/Workspace.swift` | Owns `BonsplitController`; `newTerminalSplit`/`newBrowserSplit`, `handleExternalTabDrop`, `moveSurface`/`detachSurface`, and all `BonsplitDelegate` callbacks (`didSplitPane` placeholder-repair, `didChangeGeometry` versioning). |
| `Sources/TerminalController.swift` | Automation `pane.*` verbs: `v2PaneCreate/Resize/Swap/Break/Join/Last/Focus/List`, debug underflow/empty-panel counters. |
| `Sources/TabManager.swift` | `newSplit`, `newBrowserSplit` at the manager level; workspace lifecycle around splits. |
| `Sources/AppDelegate.swift` | `moveBonsplitTab`, `moveSurface`, `shouldSuppressSplitShortcutForTransientTerminalFocusState`. |
| `cmuxUITests/BonsplitTabDragUITests.swift` | UI tests for tab-drag reorder, pane tab-bar placement, hit targets across presentation modes. |
