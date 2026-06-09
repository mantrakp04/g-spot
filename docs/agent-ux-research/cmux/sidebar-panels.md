# cmux — Right Sidebar Tool Panels, Dock & Extension Browser

Research notes from the cmux codebase (`/tmp/cmux-analysis`). Bucket: **sidebar-panels** — right sidebar tool panels, dock panel, extension browser panel, panel lifecycle and docking.

## Overview

cmux has a **right sidebar** (toggled with `⌘⌥B`) that is a single chrome shell hosting one of several **modes**: `files`, `find`, `sessions` (labeled "Vault"), `feed` (beta), and `dock` (beta). The sidebar is a SwiftUI view (`RightSidebarPanelView`) whose active mode renders different content. Three of those modes (`files`, `find`, `sessions`) are **also openable as full panes in the main editor area** via a generic `Panel` conformer (`RightSidebarToolPanel`) — so the same tool can live docked in the sidebar *or* tabbed in the workspace split grid (Bonsplit).

Two other panel kinds round out the bucket:
- **Dock panel** (`DockPanelView`): a config-driven stack of long-lived terminal "controls" (lazygit, dev servers, log tails) loaded from `.cmux/dock.json` (project) or `~/.config/cmux/dock.json` (global), gated by a per-project trust prompt.
- **Extension browser panel** (`CMUXSidebarExtensionBrowserPanel`): wraps Apple's `ExtensionKit` `EXAppExtensionBrowserViewController` in a centered "card" so users can browse/install third-party extensions inside a workspace pane.

Everything is **AppKit + SwiftUI hybrid**: SwiftUI for layout/chrome, NSViewRepresentable bridges for keyboard-focus ownership, Ghostty NSViews for terminals, and `NSViewController` containers for ExtensionKit. The whole thing is local-first (no cloud), single-machine, embedded in a desktop shell.

For a React/web port, the **portable concepts** are: a unified sidebar with switchable modes + segmented mode bar, "open as pane" promotion of a tool into the main grid, JSON-config-driven dock with a trust gate, lazy panel content, focus-intent restoration, and live badge counts. The **AppKit-only** parts are: first-responder ownership, ExtensionKit, Ghostty terminal portaling, and the keyboard-focus coordinator.

---

## Features & UX

### Right sidebar shell (`RightSidebarPanelView`)
- **Toggle** with `⌘⌥B` (`toggleRightSidebar` action). Visibility + width + a tab/explorer **divider position** + show-hidden-files + last mode all persist to `UserDefaults` (`fileExplorer.isVisible`, `.width`, `.dividerPosition`, `.showHidden`, `rightSidebar.mode`).
- **Segmented mode bar** at top: one pill button per available mode showing SF Symbol + localized label. Selected pill is highlighted; hover state animates.
  - Per-mode keyboard shortcuts: `switchRightSidebarToFiles/Find/Sessions/Feed/Dock`. Pressing one **reveals + focuses** the sidebar in that mode (not just selects).
  - **Feed mode shows a live "pending" count chip** (inline orange capsule after the label, "9+" cap) driven by `FeedCoordinator.shared.store?.pending.count`. Re-reading the observable in the view body is intentional so SwiftUI tracks it and the badge updates live.
- **"Open as pane" button** (`rectangle.split.2x1`) appears only when the active mode `canOpenAsPane` (files/find/sessions). Clicking promotes the current mode into a real workspace pane/tab.
- **Close button** (`xmark`) hides the sidebar.
- **Shortcut hint pills**: holding ⌘/⌃ surfaces little keycap hints next to mode buttons, the focus target, and the close button (`WindowScopedShortcutHintModifierMonitor`). There's a debug "always show hints" mode and tunable X/Y offsets.
- **Titlebar drag + double-click**: the mode bar doubles as a window drag handle (`WindowDragHandleView`) and honors macOS titlebar double-click (`TitlebarDoubleClickMonitorView`).
- **Keyboard navigation inside the sidebar** (`RightSidebarKeyboardNavigation`): vim-style + arrows. `J/Down` and `K/Up` move selection; `Ctrl+N`/`Ctrl+P` also move; `H/L`/`Left/Right` collapse/expand disclosure; plain `/` jumps to search; plain printable text is treated as type-ahead. `Esc` (keyCode 53) returns focus to the terminal.

### Modes
- **Files / Find**: file explorer tree (`FileExplorerPanelView`), find is the same store in search presentation. Opening a file from the sidebar opens a file-preview surface in the focused pane; for **remote (SSH) workspaces** it first materializes the remote file locally (`materializeRemoteFileForPreview`) before previewing, beeping on failure.
- **Sessions ("Vault")**: `SessionIndexView` listing resumable agent sessions; selecting one resumes via `SessionEntryResumeCoordinator`. Lazily reloads when first selected if empty.
- **Feed** (beta): notification/event feed with the pending badge.
- **Dock** (beta): see below.

### Open-as-pane (`RightSidebarToolPanel`)
- Command palette entries: "Open Files/Find/Vault as Pane" (`palette.openFilesPane` etc.). Also a tool button in the sidebar header.
- Promotes the tool into a Bonsplit tab in the focused pane (`openOrFocusRightSidebarToolSurface` → `newRightSidebarToolSurface`). **Reuses** an existing matching tool pane if one already exists for that mode (focuses it instead of duplicating).
- A paned tool participates in the full panel system: focus flash ring on attention (`WorkspaceAttentionFlashRingView`), drop-target overlay, focus restoration.

### Dock panel (`DockPanelView` / `DockControlsStore` / `DockControlRuntime`)
- **Config-driven terminal stack.** Each `DockControlDefinition` (`id`, `title`, `command`, optional `cwd`, `height`, `env`) renders a section: a header (ordinal number, title, monospace command preview, **focus** button `keyboard`, **restart** button `arrow.clockwise`) over a live Ghostty terminal.
- **Config resolution order**: walk up from the workspace root looking for `.cmux/dock.json` (project, shareable); else `~/.config/cmux/dock.json` (global); else empty.
- **Trust gate**: a *project* dock config requires explicit trust before any command runs (`DockTrustView`, "Trust and Start"). Trust is fingerprinted on the serialized control set + canonical config path + project root (`CmuxActionTrust`), so editing the config re-prompts.
- **Toolbar**: shows source label ("Project Dock" / "Global Dock" / "Dock"), **Open Dock Config** (`doc.text`, creates a template with a `lazygit` example if missing then opens in default editor), **Reload** (`arrow.clockwise`).
- **Empty state** (`DockEmptyView`): explains `.cmux/dock.json`, with **Copy Agent Prompt** (a long, ready-to-paste prompt instructing an AI agent how to author a dock config safely), an info popover previewing the prompt, and a **Docs** link.
- **Error state** (`DockErrorView`): shows decode errors (blank id/command, duplicate ids).
- **Layout**: fixed-`height` controls keep their requested height (clamped to ≥160pt); flexible controls share remaining vertical space evenly (≥160pt each); if all are fixed, extra space is distributed equally. Scrollable.
- **Restart** replaces the terminal (kills old, spawns new) without losing the slot.
- Dock terminals are **excluded from normal "terminal focus" intent** — pressing a mode shortcut from inside a dock terminal still routes to the sidebar (`isRightSidebarDockSurface`).

### Extension browser panel (`CMUXSidebarExtensionBrowserPanel`)
- Wraps ExtensionKit's `EXAppExtensionBrowserViewController` so users can browse/enable cmux extensions inside a pane.
- Rendered as a **centered card** (max width 1200pt, rounded 8pt, subtle border) with responsive insets; below a minimum usable size (600×420) it collapses to a compact **"Open larger"** label instead of cramping the browser.
- Installed extensions get a **per-extension permission grant model** (`CMUXSidebarExtensionGrantStore`): read/action scopes default to empty; the UI surfaces when an extension `needsAdditionalApproval` or `hasSensitiveAccess`, with grant/revoke.

### Remote control (`RightSidebarRemoteCommand`)
- CLI/socket command `right_sidebar <toggle|show|hide|focus|set|mode|state> [mode] [--no-focus] [--workspace=<id>] [--window=<id>]`. `set <files|find|vault|sessions|feed|dock>` switches mode (with optional `--no-focus`); `mode`/`state` returns current `{visible, mode}`. Strict arg validation with localized errors.

---

## Implementation

### Panel abstraction (`Panel.swift`)
- `protocol Panel: AnyObject, Identifiable, ObservableObject where ID == UUID`, `@MainActor`. Every surface type (terminal, browser, markdown, filePreview, **rightSidebarTool**, agentSession, project, **extensionBrowser**) conforms. `PanelType` enum is the discriminator; its `Decodable` is lenient about case for a few legacy raw values and hard-fails on unknown types.
- Rich **focus-intent protocol**: `captureFocusIntent`, `preferredFocusIntentForActivation`, `prepareFocusIntentForActivation`, `restoreFocusIntent`, `ownedFocusIntent(for:in:)`, `yieldFocusIntent`. `PanelFocusIntent` is a semantic target (`.panel`, `.terminal(...)`, `.browser(...)`, `.filePreview(...)`, `.project(...)`) so reactivating a tab restores the *exact* inner control (e.g. find field vs surface), not just "the panel". Default impls live in an extension.
- `PanelContentView` is the single switch that maps `panelType` → the matching SwiftUI view, downcasting `any Panel`. It also installs a **pane drop-target overlay** for non-terminal/non-browser panels only.

### Right sidebar tool panel (`RightSidebarToolPanel.swift`)
- `RightSidebarToolPanel: Panel, ObservableObject` holds a `mode`, a `weak workspace`, and **lazily-created** stores (`FileExplorerStore`, `FileExplorerState`, `SessionIndexStore`) created on first access. This keeps a paned tool cheap until shown.
- **Re-attachable**: `reattach(to:)` lets a tool panel be moved to a different workspace; it re-subscribes to root changes and resyncs.
- **Live root sync** via Combine: merges `workspace.$currentDirectory`, `$remoteConfiguration`, `$remoteConnectionState`, `$remoteConnectionDetail`, `$remoteDaemonStatus` and re-syncs the file/session root on any change (hopped to `@MainActor` via `Task`).
- **Remote awareness**: for SSH workspaces, builds an `SSHFileExplorerConnection` root with availability state; non-SSH remote / disconnected → `.none`; session index is disabled for remote.
- **Focus ownership** uses a zero-size `RightSidebarToolFocusAnchorView` (NSView, `acceptsFirstResponder`) bridged via `NSViewRepresentable`. `ownsKeyboardFocus(_:)` walks up to the NSHostingView root to decide if a responder belongs to this panel. `ownedFocusIntent` returns `.panel` only when this panel actually owns the responder.
- **Focus flash**: `focusFlashToken` (`@Published Int`) bumped on attention; the view animates a multi-segment opacity pulse (`FocusFlashPattern`: opacities `[0,1,0,1,0]` over 0.9s, ease in/out segments) and **guards each delayed step against a generation counter** so a new flash cancels the in-flight one.

### Right sidebar shell (`RightSidebarPanelView.swift`)
- `RightSidebarMode` enum: `String/CaseIterable/Codable/Sendable`, `nonisolated`. Carries `label`, `symbolName`, `shortcutAction`. `paneModes = [.files,.find,.sessions]` with `canOpenAsPane`.
- Beta modes gated by `@AppStorage` (`RightSidebarBetaFeatureSettings`); `availableModes(feedEnabled:dockEnabled:)` filters. `RightSidebarMode+Availability.swift` centralizes availability + CLI-arg parsing (`vault`/`sessions` both map to `.sessions`).
- `contentForMode` switches the body; dock owns a `@StateObject DockControlsStore` and the shell calls `synchronizeDockLifecycle(...)` on appear/disappear and on changes to mode, visibility, root directory, and workspace id.
- Keyboard focus bridged via `RightSidebarKeyboardFocusView` (registers itself with the per-window `keyboardFocusCoordinator` on move-to-window/layout). `cmuxCanAcceptRightSidebarKeyboardFocus` (NSView extension) refuses focus if the view or any ancestor is ≤0.5pt or hidden — prevents focusing a collapsed sidebar.

### Dock (`DockPanelView.swift`)
- `DockControlDefinition` is `Codable` with a **hand-written decoder** that trims/normalizes and hard-fails on blank id/command (localized `DecodingError`s). `loadConfig` rejects **duplicate ids**.
- `DockControlRuntime` (`@MainActor`, `ObservableObject`) owns a `TerminalPanel` per control, a stable `PaneID`, and injects `CMUX_DOCK_CONTROL_ID/TITLE` env. `makePanel` writes a **self-deleting shell startup script** to a temp file (0700 perms) that: decodes base64 command+cwd, resolves the user's real login shell via `dscl`/`$SHELL`/`/bin/sh`, prepends the bundled CLI bin to `PATH` (fish-aware branch), `cd`s, `eval`s the command, then `exec`s an interactive login shell. Falls back to `/bin/sh` if the script can't be written.
- `DockControlsStore` is the lifecycle brain: `synchronizeSidebarLifecycle` activates only when sidebar is visible **and** mode == dock, else deactivates. `activate` short-circuits if config + root + workspace are unchanged (just toggles UI visibility). `reload` resolves config, handles trust, builds runtimes, sets error/source labels.
- Visibility is propagated to each terminal via `setVisibleInUI` which also drives `TerminalWindowPortalRegistry` (hosted-view portaling) so off-screen dock terminals are hidden but kept alive.
- `DockKeyboardFocusView` registers with the focus coordinator, owns focus iff the responder's Ghostty surface is a registered dock surface, and intercepts mode shortcuts in `performKeyEquivalent`/`keyDown`.

### Extension browser (`CMUXSidebarExtensionBrowserPanel.swift`)
- `NSViewControllerRepresentable` wrapping a custom `CMUXSidebarExtensionBrowserContainerViewController`. The browser `EXAppExtensionBrowserViewController` is created once by the panel and **re-parented** into the container; `dismantleNSViewController` calls `detachBrowserForTransientReparent()` so SwiftUI churn doesn't destroy/recreate the (expensive, stateful) ExtensionKit controller.
- Container builds a flipped root view + card via Auto Layout with priority/safety constraints; recomputes width/insets and compact-mode on every `layout()`.

### Lifecycle teardown (`Workspace+PanelLifecycle.swift`)
- `discardClosedPanelLifecycleState(panelId:...)` is the **single drain point** when a tab/pane/workspace closes. It: optionally publishes a `cmuxSurfaceClosed` event, snapshots agent runtime state, cancels Combine subscriptions, optionally cleans controller surface state, calls `panel.close()`, then removes the panel from ~30 per-panel dictionaries/sets (directories, branches, PRs, titles, custom titles, pinned, unread, shell activity, TTY names, remote PTY session, resume bindings, listening ports, restored scrollback, etc.), unregisters from `PortScanner`, and discards agent runtime/snapshots.
- Heavy machinery around **agent PID ↔ panel ownership** (`agentPIDKeysByPanelId`, `agentPIDPanelIdsByKey`) so closing a panel correctly releases ports and structured agent-hook statuses, and so detached agent runtime can be **adopted/transferred** to another panel (`adoptDetachedAgentRuntimeState`) — supports moving/restoring panels without orphaning processes.

### Focus coordinator (`MainWindowFocusController.swift`)
- Per-window coordinator tracks `intent` (`.rightSidebar(mode)` vs `.mainPanel(workspaceId,panelId)`), `rightSidebarFocusState`, and `rememberedRightSidebarMode`.
- Hosts register themselves: `registerRightSidebarHost`, `registerFileExplorerHost`, `registerFeedHost`, `registerDockHost`. If a focus request for that mode is pending, it's applied as soon as the host registers (handles async view creation).
- `focusRightSidebar(mode:focusFirstItem:)` falls back to `.files` when the remembered/requested mode is unavailable, makes the sidebar visible, yields terminal focus, switches mode, then focuses the mode's endpoint with a host fallback.
- `allowsTerminalFocus` returns false while intent is `.rightSidebar` (so terminals don't steal focus back) **except** dock surfaces, which are always allowed.

---

## Hardening & Lessons (the gold)

- **Stranded focus host bug (issue #5269)** — `isRightSidebarFocusResponder` requires `(responder as? NSView)?.window === window`. A focus host reparented out of its window must NOT be treated as the legitimate focus owner, or it blocks focus recovery. Cited directly in `AppDelegate.swift:6541`.
- **Zero/collapsed-size focus guard** — `cmuxCanAcceptRightSidebarKeyboardFocus` walks the ancestor chain and refuses focus if any view is ≤0.5pt or hidden. Stops the app from "focusing" an invisible/collapsed sidebar.
- **Flash animation generation guard** — each delayed `DispatchQueue.main.asyncAfter` step checks `focusFlashAnimationGeneration == generation` before applying, so a new flash cleanly cancels the old multi-segment animation instead of fighting it.
- **Sidebar visibility toggling suppresses ALL animation** — `FileExplorerState.setVisible` wraps the change in `NSAnimationContext` grouping + `CATransaction(setDisableActions)` + a SwiftUI `Transaction(disablesAnimations: true)`. They had to suppress *both* AppKit/Core-Animation implicit layout and SwiftUI transactions to avoid a janky reveal/hide.
- **Dock trust fingerprinting** — trust is keyed on the *serialized control set* (sorted-keys JSON) plus canonicalized config path + project root, so any edit to a project's dock commands re-triggers the trust prompt. Project configs require trust; global config does not. This is a real supply-chain/RCE guard: arbitrary shell commands ship in `.cmux/dock.json`.
- **Dock startup script is self-deleting and bundled-CLI aware** — `rm -f -- "$0"` after read; fish vs POSIX `PATH` branches; resolves the *real* login shell via `dscl` (not just `$SHELL`); base64-encodes command+cwd to avoid quoting injection. Falls back to `/bin/sh` if write fails.
- **Dock config validation hard-fails** — blank id/command and duplicate ids throw localized decode errors rather than silently producing broken controls (matches the project rule "hard-fail on genuinely wrong shapes").
- **Dock activation short-circuit** — `activate` avoids reloading config/respawning terminals when root+workspace+config are unchanged; it just flips UI visibility. Prevents killing long-running dock processes (lazygit, dev servers) every time you toggle the sidebar.
- **Dock terminals kept alive but portaled off-screen** — `setVisibleInUI(false)` unfocuses and hides via `TerminalWindowPortalRegistry` instead of tearing down, so switching away from dock mode doesn't lose terminal state.
- **Dock surfaces bypass terminal-focus suppression** — `isRightSidebarDockSurface` is special-cased in `allowsTerminalFocus`, `terminalKeyboardFocusRequest`, and portal filtering so dock terminals behave like sidebar chrome, not main-grid terminals (mode shortcuts still work inside them).
- **ExtensionKit controller is re-parented, never recreated** — `attachBrowserIfNeeded`/`detachBrowserForTransientReparent` handle SwiftUI representable churn so the stateful, expensive `EXAppExtensionBrowserViewController` survives view rebuilds. `dismantleNSViewController` only detaches.
- **Extension permissions default-deny** — grants start with empty read/action scopes; sensitive access must be explicitly granted and is independently revocable; grant is invalidated if the manifest id or API version changes.
- **Lifecycle drain is centralized** — one `discardClosedPanelLifecycleState` removes a panel from *every* tracking dictionary (the comment notes ~30 maps); avoids the classic "closed a tab but its ports/notifications/agent PIDs leaked" bug. Agent PID ownership is reference-counted per panel and can be transferred, not just dropped.
- **Live badge requires intentional observable read** — comment in `RightSidebarPanelView` explains re-reading `FeedCoordinator.shared.store?.pending.count` inside the body is deliberate so SwiftUI tracks dependency and the badge updates when hooks push items.
- **Focus requests survive async host creation** — the coordinator stores a pending `rightSidebarFocusState.request` and applies it when the matching host *later* registers; views are created lazily so focus can be requested before the host exists.
- **`Esc` routes back to terminal first** — `RightSidebarKeyboardFocusView.keyDown` for keyCode 53 tries `keyboardFocusCoordinator.focusTerminal()` before clearing first responder, keeping keyboard flow predictable.
- **UI-test geometry telemetry** — `RightSidebarChromeGeometryReporting` and `reportRightSidebarChromeNamedGeometryForBonsplitUITest(...)` write precise frame geometry (mode bar, named controls) to a JSON file under env-gated DEBUG, so UI tests can assert exact pixel positions of sidebar chrome / drag handles. Many components carry `reportRightSidebarChromeNamedGeometryForBonsplitUITest` + accessibility identifiers, indicating heavy drag/positioning test coverage.
- **Remote-file preview is async + beeps on failure** — opening a sidebar file on an SSH workspace materializes it locally first; failures `NSSound.beep()` rather than crashing.

---

## Key Files

| File | Role |
|---|---|
| `Sources/Panels/Panel.swift` | `Panel` protocol, `PanelType`, focus-intent model, focus-flash animation pattern, attention-ring coordinator |
| `Sources/Panels/PanelContentView.swift` | Maps `panelType` → SwiftUI view; installs pane drop-target overlay; shared panel header components |
| `Sources/RightSidebarPanelView.swift` | Right sidebar shell: `RightSidebarMode`, mode bar, open-as-pane/close buttons, keyboard nav, dock lifecycle sync, focus bridge |
| `Sources/RightSidebarToolPanel.swift` | `RightSidebarToolPanel` (Panel for files/find/sessions as a pane) + its view; lazy stores, remote root sync, focus anchor, flash |
| `Sources/RightSidebarMode+Availability.swift` | Mode availability (beta gating), CLI-arg parsing (`vault`→sessions) |
| `Sources/FileExplorerState.swift` | Persistent sidebar state (visible/width/divider/mode/show-hidden); animation-suppressed `setVisible` |
| `Sources/DockPanelView.swift` | Dock: `DockControlDefinition`, `DockControlsStore`, `DockControlRuntime`, config resolution/trust, layout, terminal sections, focus host |
| `Sources/DockEmptyView.swift` | Dock empty state + "Copy Agent Prompt" (full agent-authoring prompt) + docs link |
| `Sources/CMUXSidebarExtensionBrowserPanel.swift` | Extension browser Panel; NSViewController card container with re-parent/compact-mode handling |
| `Sources/CMUXInstalledExtensionSidebarHostView.swift` | Installed-extension host + per-extension permission grant store (default-deny scopes) |
| `Sources/ExtensionSidebarWorkspaceRowView.swift` | Extension sidebar workspace row UI |
| `Packages/CMUXExtensionHostSupport/.../CMUXSidebarExtensionBrowserPresenter.swift` | Factory wrapping Apple `EXAppExtensionBrowserViewController` |
| `Sources/Workspace+PanelLifecycle.swift` | Centralized panel teardown; agent PID↔panel ownership, adopt/transfer/discard runtime state |
| `Sources/MainWindowFocusController.swift` | Per-window keyboard-focus coordinator; host registration, sidebar↔terminal focus arbitration, pending-focus replay |
| `Sources/RightSidebarRemoteCommand.swift` | CLI/socket `right_sidebar` command parsing (toggle/show/hide/focus/set/state, targets, --no-focus) |
| `Sources/CmuxSidebarActionDispatch.swift` | Action sink running custom-sidebar buttons through `TerminalController` v2 command line |
| `Sources/RightSidebarChromeGeometryReporting.swift` | DEBUG UI-test telemetry for sidebar chrome geometry |
| `Sources/RightSidebarChromeStyle.swift` | Chrome metrics, pill/bar/border styling, header control sizing |
| `Sources/ContentView+RightSidebarCommandPalette.swift` | Command palette entries for mode switch + open-as-pane; shortcut-action mapping |
| `Sources/ContentView.swift` (`openRightSidebarToolPane`) | Entry that promotes a sidebar tool into a focused pane (reuse-or-create) |
| `Sources/Workspace.swift` (`newRightSidebarToolSurface`, ext-browser panel) | Creates tool/extension panels as Bonsplit tabs; focus preservation on non-focus splits |
| `Sources/AppDelegate.swift` (`focusRightSidebarInActiveMainWindow`, `isRightSidebarFocusResponder`) | App-level sidebar focus routing + stranded-host guard (#5269) |

### Portability notes for a React/web port
- **Portable:** unified sidebar with switchable modes + segmented bar, persisted visibility/width/mode, live count badges, "open as pane" promotion with reuse-or-focus, JSON-config dock with trust gate + validation + agent-prompt empty state, lazy panel content, semantic focus restoration, centralized close-time state drain, keyboard nav (j/k, arrows, `/` typeahead, esc-to-content).
- **AppKit/macOS-only:** first-responder ownership & the keyboard-focus coordinator (web uses DOM focus/`activeElement`), Ghostty terminal portaling/`setVisibleInUI`, ExtensionKit `EXAppExtensionBrowserViewController`, `dscl`/login-shell resolution, `NSViewController` re-parenting, Core Animation/`NSAnimationContext` suppression, window drag handles & titlebar double-click.
