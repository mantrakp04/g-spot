# cmux — Workspace Groups (sidebar grouping)

Research notes for porting cmux's workspace-grouping UX into a React/web app. Source: `/tmp/cmux-analysis` (Swift / AppKit / SwiftUI macOS app).

## Overview

A **workspace group** is a named, collapsible section in the sidebar that contains one or more workspaces (tabs). cmux's grouping model is deliberately *thin*: there is no separate "container" entity that owns children. Membership is a flat back-pointer (`Workspace.groupId`), and group identity/state lives in a parallel array (`TabManager.workspaceGroups`).

The defining design choice is the **anchor workspace**: every group has exactly one member designated `anchorWorkspaceId`. The anchor is a *real* workspace, but it is **rendered implicitly as the group header** — it has no separate sidebar row. Collapsing the group hides the non-anchor members; the header (anchor) stays visible. Closing the anchor dissolves the group (other members survive as ungrouped). This collapses "header row" and "first workspace" into one entity, which is the single most portable concept here and the source of most of the hardening.

Key model (`TabManager.swift`):

```swift
struct WorkspaceGroup: Identifiable, Equatable, Sendable {
    let id: UUID
    var name: String
    var isCollapsed: Bool
    var isPinned: Bool
    var anchorWorkspaceId: UUID   // always a member whose groupId == self.id
    var customColor: String?      // hex; falls back to cwd-config color, then none
    var iconSymbol: String?       // SF Symbol; defaults to "folder.fill"
}
```

- `TabManager.tabs: [Workspace]` is the flat, ordered source of truth for rendering order.
- `TabManager.workspaceGroups: [WorkspaceGroup]` — order in this array defines section order.
- Membership relation lives on `Workspace.groupId: UUID?` (the comment explicitly calls this out so nobody invents a children-array).

## Features & UX

### Group header (anchor row)
`SidebarWorkspaceGroupHeaderView` is "a collapsible group header that doubles as the anchor workspace row." It contains:
- **Chevron** (`chevron.right`/`chevron.down`) — tap toggles collapse. Has its own tap target + a11y "Expand group" / "Collapse group".
- **Icon + name + unread badge** region — tapping it *focuses the anchor workspace* (selects it), distinct from toggling collapse. a11y hint: "Focus the group's anchor workspace".
- **Unread badge**: when collapsed, it sums unread counts across **all members**; when expanded, shows only the anchor's unread. (`anchorUnreadCount` in `VerticalTabsSidebar+WorkspaceGroups.swift`.)
- **Plus button**: visible only on hover *and* only when the keyboard-shortcut hint pill is not showing (`plusVisible = isHovered && !showsShortcutHint`). Creates a new workspace in the group, inheriting the anchor's cwd and honoring configured placement.
- **Shortcut hint pill**: when a modifier key is held, the header shows the workspace number shortcut (e.g. `⌘1`) at the anchor's index, just like a normal workspace row.
- **Active background tint**: subtle `Color.primary.opacity(0.08)` rounded background when the anchor is the selected tab.

### Collapse / expand
- Toggling collapse is UI-aware (`toggleWorkspaceGroupCollapsed`): if the currently-selected workspace is a *non-anchor* child that's about to be hidden, focus jumps to the anchor first.
- Auto-expand: selecting any non-anchor member of a collapsed group auto-expands it (via `selectedTabId` didSet → `expandWorkspaceGroupForSelectionIfNeeded`). Selecting the *anchor* does NOT expand (lets you work in the anchor with the rest folded away).
- Clicking `+` on a collapsed group auto-expands so the newly-focused workspace isn't hidden.

### Pin
- Whole-group pin (`toggleWorkspaceGroupPinned`) floats the group above unpinned rows. Independent of per-workspace pin. Pinned and unpinned form two **tiers**; ordering/reordering is clamped within a tier.

### Color & icon
- Effective color = group `customColor` ?? cwd-config color (`cmux.json`) ?? no tint.
- Effective icon = explicit group `iconSymbol` ?? configured icon ?? `folder.fill` (`RenderableSystemSymbol.resolvedWorkspaceGroupIcon`).

### Context menus
Header context menu (`SidebarWorkspaceGroupHeaderView`):
- Rename Group… / Pin|Unpin Group / Edit Group Config… / Open Workspace Groups Docs / Ungroup (Keep Workspaces) / **Delete Group (Close Workspaces)** (destructive role).

Plus-button context menu: New Workspace in Group + cwd-config-driven custom items (separators + actions) + Edit Config / Open Docs.

Per-workspace-row group section (`TabItemView+WorkspaceGroups.swift`):
- **New Group from Selection / New Group from Workspace** (with keyboard shortcut `groupSelectedWorkspaces`, default ⌘⇧G).
- **Move to Group ▸** submenu (current group disabled).
- **Remove from Group** (only when a target is grouped).
- Filters out workspaces that are already an anchor of *another* group (can't re-anchor).

### Dialogs (`SidebarWorkspaceGroupDialogs.swift`)
- **Rename**: `NSAlert` with an `NSTextField` accessory; first-responder + select-all forced via `DispatchQueue.main.async` after the alert window exists.
- **Delete confirmation**: pluralized warning ("…and close its 2 workspaces?") with explicit Return = Delete, Esc = Cancel key equivalents. Whitespace-only rename is ignored.

### Drag & drop (the rich part)
- Dragging a workspace onto a group header's **center band** adds it to the group (`SidebarWorkspaceGroupHeaderDropDelegate` → `addWorkspaceToGroup`). Dropping near the top/bottom **edge band** is treated as a reorder, delegated to the normal `SidebarTabDropDelegate`.
- The center-vs-edge split is computed by `SidebarWorkspaceGroupHeaderDropZone.isCenterDrop` (edge band = `clamp(height*0.25, 4, height*0.4)`).
- Drop policy (`SidebarWorkspaceGroupHeaderDropPolicy.action`) refuses: pinned workspaces, group anchors, the same group, and self-drops (returns `.noOp`/`nil`).
- Drag inference on reorder (`applyDragInferredGroupMembership`): a workspace dropped *between two members of the same group* joins that group; dropped with both neighbors outside, it leaves. Ambiguous last-slot drops bias toward "reordering within the group."

### New-workspace placement
`WorkspaceGroupNewPlacement` = `.afterCurrent` (default) | `.top` | `.end`. Resolution order: explicit call-site override → per-cwd `cmux.json` → global UserDefaults default. The "After current" semantics insert after the active member or after the anchor.

### Config opener
`SidebarWorkspaceGroupConfigOpener.openCmuxConfigInEditor` opens `~/.config/cmux/cmux.json`, **materializing `{}` if absent** (atomic write, creates intermediate dirs), routed through the user's `preferredEditorCommand`. Docs opener launches the GitHub docs URL.

### Extension sidebar rows
`CmuxExtensionSidebarWorkspaceRowView` renders provider-contributed rows (title/subtitle/trailing/accessory). The accessory opens a popover **inspector** with Notes + an in-app Browser (WKWebView). Rows are indented (28pt) to nest under their section. There's also a detachable inspector window (`CmuxExtensionSidebarInspectorWindowController`) keyed per workspace.

## Implementation

### Rendering pipeline
`SidebarWorkspaceRenderItem.renderItems(tabs:groupsById:)` is the pure projection from `tabs[] + groups` to a flat draw list of `.groupHeader(group, memberWorkspaceIds:)` / `.workspace(tab)`:
- Walks `tabs` in order; emits a header the first time it sees a new group id.
- **Skips the anchor's own row** (anchor is the header).
- When a group is collapsed, skips its non-anchor children.
- Defensive: dedupes headers (`emittedHeaders`) and keeps a `collapsedByGroupId` decision so "legacy reorder paths that leave a group in two runs" still honor one collapse state.

### Header view wiring (`VerticalTabsSidebar+WorkspaceGroups.swift`)
`sidebarWorkspaceGroupHeader(...)` builds `SidebarWorkspaceGroupHeaderView` from a `WorkspaceListRenderContext`, resolving effective color/icon/cwd-menu-items/placement, computing unread, shortcut digit, drop-indicator visibility, and the drag/drop delegate factory. Closures capture `[weak tabManager]` and stable scalar ids.

### Equatable + memoization
`SidebarWorkspaceGroupHeaderView` is `Equatable` with a hand-written `==` comparing only **scalar render inputs** (id, name, icon, tint, collapsed/pinned/active, counts, shortcut, offsets, fontScale, drag/drop flags). Closures and delegate factories are *excluded* — they're recreated each parent eval, so including them would defeat the memo. `.equatable()` is applied in the parent. This is the SwiftUI equivalent of `React.memo` with a custom comparator.

### Metrics scaling
`SidebarWorkspaceGroupHeaderMetrics` is the single place that scales every header dimension (chevron, icon, name, badge padding, plus button) by `settings.sidebarFontScale`, so the header grows in lockstep with workspace rows from one scaling path. `SidebarWorkspaceGroupingMetrics.memberIndent = 12` is the nesting inset for member rows.

### TabManager mutations (state ownership)
All group ops live on `@MainActor class TabManager` (`@Published var tabs`, `@Published var workspaceGroups`). Notable methods:
- `createWorkspaceGroup` — **creates a fresh anchor workspace** (never promotes a member), appends group, assigns eligible children, places at the first child's position.
- `createWorkspaceInGroup` / `addWorkspaceToGroup` / `removeWorkspaceFromGroup`.
- `ungroupWorkspaceGroup` (flatten-in-place, nothing closed) vs `deleteWorkspaceGroup` (closes all members).
- `setWorkspaceGroupCollapsed`/`Pinned`/`Color`/`Icon`/`Anchor`, `moveWorkspaceGroup`.
- `normalizeWorkspaceGroupContiguity` / `normalizeWorkspaceGroupRunsPreservingOrder` — rebuild `tabs[]` so each group is one contiguous, **anchor-first** run, preserving pinned/unpinned tier order.
- `syncWorkspaceGroupsOrderToAnchorOrder` — keeps `workspaceGroups` array order in sync with anchor positions in `tabs[]`.

### Cross-surface paths
- UI methods (`toggle*`, `selectWorkspace`) move focus; **pure-data twins** (`setWorkspaceGroupCollapsed`) exist specifically so socket/CLI handlers never steal the user's selection (the "socket focus policy"). This UI-vs-data split is a recurring theme.
- `SidebarWorkspaceGroupContextMenuRunner` → `AppDelegate.runWorkspaceGroupConfiguredAction` executes cwd-configured custom menu actions, temporarily focusing the anchor so the action derives the right cwd, then joins any newly-created workspace to the group and restores selection.

### Persistence (`SessionPersistence.swift`)
`SessionWorkspaceGroupSnapshot` stores id, name, isCollapsed, isPinned, customColor, iconSymbol, and **both** `anchorWorkspaceId` (UUID hint) and `anchorMemberIndex` (restore-stable index). On restore, anchor resolves: index → stored UUID → first member. Groups with no surviving members are dropped; dangling `groupId`s are cleared.

### Config resolution (`CmuxConfig.swift`)
`resolveWorkspaceGroupConfig(forCwd:)` picks the **longest-prefix / most-specific** matching `cmux.json` entry. Supports exact path, prefix (`key + "/"` so `/Users/x` doesn't match `/Users/x-fork`), `/` catch-all, and a minimal `fnmatch` (`*`/`?`). Resolved config supplies color, icon, contextMenuItems, and newWorkspacePlacement.

## Hardening & Lessons

These are the battle-scars — most are portable as logic even though the platform is AppKit/SwiftUI.

1. **Anchor is created, never promoted.** Comment in `WorkspaceGroup` and `createWorkspaceGroup` insists the anchor is a fresh workspace so "closing it dissolves the group" is a clean invariant. Pulling an existing anchor into a new group is rejected silently (would orphan the source group) — eligibility filters drop existing anchors everywhere (`createWorkspaceGroup`, `addWorkspaceToGroup`, `TabItemView+WorkspaceGroups`).

2. **Collapse must scrub stale selection.** `toggleWorkspaceGroupCollapsed` strips multi-selection entries pointing at now-hidden children and moves focus to the anchor, *"Without this, a close/group shortcut fired after the collapse would still act on workspaces the user can no longer see."* Uses `.sidebarMultiSelectionDidHide` (not collapse-to-one) to keep visible out-of-group selections.

3. **Auto-expand timing bug.** `createWorkspaceInGroup` manually expands the group because the `selectedTabId` auto-expand hook fires inside `addWorkspace` *before* `assignGroup`, so it can't see the new membership. Same manual-expand exists in `addWorkspaceToGroup` because selecting an already-selected workspace doesn't trip the didSet.

4. **Restore can't trust anchor UUIDs.** Each restored workspace gets a fresh UUID, so `anchorMemberIndex` is the primary anchor resolver, with UUID and "first member" fallbacks for old snapshots. Atomic single assignment of `tabs`/`workspaceGroups`/`selectedTabId` so SwiftUI never sees an intermediate empty state. `isRestoringSessionSnapshot` flag suppresses auto-expand side-effects mid-restore.

5. **Delete with one tab left.** `deleteWorkspaceGroup` notes `closeWorkspace` short-circuits when `tabs.count <= 1`, which would leave the last workspace alive with a stale groupId — so it converts the holdout to ungrouped instead, and still cleans up the group entry afterward in case "every member was non-anchor (callers can construct that shape via socket `workspace.group.set_anchor` races)."

6. **Set-anchor must hoist + republish.** `setWorkspaceGroupAnchor` re-normalizes so the header renders at the new anchor's position (otherwise the shortcut digit/focus target point at the wrong row), and posts the order-change event — noting "other group-mutation paths post; this one was a hole."

7. **Drop no-op consumption.** `SidebarWorkspaceGroupHeaderDropPolicy.shouldConsumeNoOpEdgeDrop` deliberately *consumes* edge drops that would be no-ops (drop onto own group / self) so they don't fall through to a confusing reorder. Center-drop clears the reorder drop indicator and drives auto-scroll.

8. **Ungroup is flatten-in-place, not a move.** `ungroupWorkspaceGroup` intentionally does NOT re-normalize, with a long comment: re-normalizing would shove ungrouped members to the bottom tier and "makes Ungroup feel like a destructive move instead of a flatten-in-place." Members keep their `tabs[]` positions.

9. **Dangling-group cleanup is everywhere.** Multiple normalize paths clear `groupId`s pointing at unknown groups (`normalizeWorkspaceGroupRunsPreservingOrder`, restore). The render projection dedupes headers and tolerates a group split across two runs.

10. **Memo correctness.** Excluding closures/delegates from `==` is documented as intentional ("recreated by the parent on each evaluation"). Forgetting this would either break memoization or capture stale closures.

11. **Rename refreshes imperatively-cached chrome.** `renameWorkspaceGroup` notes the group name is the source of truth for the anchor's title; it nudges the window title bar / toolbar command label and posts `.workspaceGroupNameDidChange` because those surfaces don't observe the `@Published` array.

12. **Group-create collapses multi-selection** to avoid a second ⌘⇧G reusing the same child ids and creating a duplicate group. Skipped on the socket/CLI path (focus policy).

13. **Config opener materializes `{}` atomically** so "Edit Config" never opens a missing file; write is `.atomic`, dirs created with intermediates.

## Platform-specific vs portable

| Concept | Portable to web? |
| --- | --- |
| Anchor = header-as-first-workspace model | **Fully portable** — the cleanest idea here |
| Contiguity/anchor-first normalization of a flat ordered list | **Portable** algorithm |
| Collapse scrubs stale selection; auto-expand on selecting hidden member | **Portable** behavior, watch ordering bugs |
| Pinned/unpinned tiers with clamped reorder | **Portable** |
| Longest-prefix cwd config + fnmatch resolution | **Portable** |
| Restore via member-index (not UUID) | **Portable** lesson |
| UI-mutating vs pure-data method twins (focus policy) | **Portable** as a principle (interactive vs programmatic) |
| Center-band vs edge-band drop on a header | **Portable** with HTML5 DnD / pointer events |
| `Equatable` `==` excluding closures | Maps to `React.memo` custom comparator |
| `NSAlert` rename/delete dialogs, first-responder timing | **AppKit-only** — use a web modal |
| WKWebView inspector popover, `NSWindowController` | **AppKit/WebKit-only** |
| SF Symbols / `sidebarFontScale` metrics | Concept portable (icon set + scale token), values not |
| `~/.config/cmux/cmux.json` editor launch | Desktop-shell-only (no browser equivalent) |

## Key Files

| File | Role |
| --- | --- |
| `Sources/TabManager.swift` | `WorkspaceGroup` model, `WorkspaceGroupNewPlacement`, all group CRUD/normalize/restore logic, state ownership (`@Published tabs`/`workspaceGroups`) |
| `Sources/SidebarWorkspaceRenderItem.swift` | Pure projection `tabs+groups → [groupHeader | workspace]`; anchor-row suppression, collapse skipping, dedupe |
| `Sources/VerticalTabsSidebar+WorkspaceGroups.swift` | Builds the header view from render context; resolves color/icon/menu/placement, unread, shortcut, drop delegate factory |
| `Sources/SidebarWorkspaceGroupHeaderView.swift` | The header SwiftUI view (chevron/icon/name/badge/+), context menus, drag/drop, `Equatable`; plus `SidebarWorkspaceGroupHeaderDropZone/DropPolicy/DropDelegate` |
| `Sources/SidebarWorkspaceGroupHeaderMetrics.swift` | Font-scaled dimensions for the header |
| `Sources/SidebarWorkspaceGroupingMetrics.swift` | `memberIndent` nesting inset |
| `Sources/SidebarWorkspaceGroupDialogs.swift` | Rename prompt + delete confirmation `NSAlert`s (pluralized, key-equivalent wiring) |
| `Sources/SidebarWorkspaceGroupConfigOpener.swift` | Opens/materializes `cmux.json`; opens docs URL |
| `Sources/SidebarWorkspaceGroupContextMenuRunner.swift` | Bridges header cwd-config menu items to `AppDelegate.runWorkspaceGroupConfiguredAction` |
| `Sources/TabItemView+WorkspaceGroups.swift` | Per-workspace-row context menu: New Group / Move to Group / Remove from Group; anchor-eligibility filtering |
| `Sources/WorkspaceGroupMenuSnapshot.swift` | Immutable `{id,name}` snapshot of groups for the row context menu |
| `Sources/ExtensionSidebarWorkspaceRowView.swift` | Extension-provider workspace rows + Notes/Browser inspector popover & detachable window |
| `Sources/AppDelegate.swift` | `runWorkspaceGroupConfiguredAction`, `WorkspaceGroupNewWorkspaceTarget`, async cloudVM workspace-join observer |
| `Sources/CmuxConfig.swift` | cwd→group config resolution (`resolveWorkspaceGroupConfig`, longest-prefix + fnmatch), `CmuxResolvedWorkspaceGroupConfig` |
| `Sources/SessionPersistence.swift` | `SessionWorkspaceGroupSnapshot` (index + UUID anchor hints) |
| `Sources/RenderableSystemSymbol.swift` | `resolvedWorkspaceGroupIcon`, `folder.fill` default, symbol normalization |
| `Sources/App/TerminalDirectoryOpenSupport.swift` | `WorkspaceShortcutMapper.digitForWorkspace(at:workspaceCount:)` |
| `cmuxTests/WorkspaceGroupTests.swift`, `SidebarWorkspaceGroupHeaderMetricsTests.swift`, `SidebarWorkspaceGroupConfigOpenerTests.swift` | Test coverage for grouping, metrics, config opener |
