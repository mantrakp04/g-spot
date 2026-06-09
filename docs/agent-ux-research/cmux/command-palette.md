# cmux Command Palette — Research Notes

Bucket: **command-palette**. Scope: the view/auth/right-sidebar command palettes, the Nucleo fuzzy-matching Rust FFI, command registration/routing, and the overlay/focus machinery. This doc is aimed at porting concepts into a React/web app, so platform-specific (AppKit/Swift FFI) pieces are flagged vs. portable ideas.

---

## Overview

cmux has a single command palette surface that serves **two scopes** distinguished purely by a `>` prefix in the query field:

- **Switcher scope** (default, empty/no-prefix query): fuzzy search over *workspaces* and *surfaces* (tabs/panes) — like a "go to anything" jumper.
- **Commands scope** (query starts with `>`): fuzzy search over *registered commands* — like VS Code's command palette.

`commandPaletteListScope(for:)` is the entire scope decision: `query.hasPrefix(">")` → `.commands`, else `.switcher` (`ContentView.swift:5019`). The same overlay, field, list, keyboard handling, and search engine drive both scopes; only the corpus and prefix differ.

Commands are **contributed** from many feature modules (`ContentView+ViewCommandPalette`, `ContentView+AuthCommandPalette`, `ContentView+RightSidebarCommandPalette`, `CommandPaletteSettingsToggle`, etc.), each returning `[CommandPaletteCommandContribution]` and registering handlers into a `CommandPaletteHandlerRegistry`. A context snapshot (`when`/`enablement` predicates) gates which commands appear, so the palette is **context-sensitive** (e.g. "Sign In" only shows when signed out and not mid-auth).

Matching is done two ways that must agree: a **Rust/Nucleo FFI** (`Native/CommandPaletteNucleoFFI`) for speed, and a **pure-Swift reference matcher** (`CommandPaletteFuzzyMatcher` / `CommandPaletteSearchEngine`) used as the spec, as a fallback when the dylib is missing, and as a targeted "single-edit typo" augmentation on top of Nucleo results.

---

## Features & UX

### Invocation & mode toggling
- One global shortcut toggles the palette (`toggleCommandPalette`, `ContentView.swift:8961`); opening defaults to **commands scope** by seeding the query with `>`.
- Separate entry points open directly into a scope: `openCommandPaletteCommands()` / `openCommandPaletteSwitcher()` route through `handleCommandPaletteListRequest(scope:)` (`:8977`). **Pressing the same scope's shortcut while that scope is already showing dismisses the palette** (toggle-to-close), while pressing the *other* scope's shortcut switches scope in place rather than closing.
- Several commands open the palette into a specialized **inline input mode** instead of the list: rename tab, rename workspace, edit workspace description (`openCommandPaletteRenameTabInput`, `openCommandPaletteWorkspaceDescriptionInput`, `:8993`+). These present the palette if needed, then begin a focused text-entry flow.

### Modes
`CommandPaletteMode` (`ContentView.swift:1164`) distinguishes list mode (`.commands`) from inline-input flows (rename / workspace-description). The description input is a **multiline** editor with an auto-growing height (`commandPaletteWorkspaceDescriptionHeight`, min height from `CommandPaletteMultilineTextEditorRepresentable`).

### Search behavior (both scopes)
- **Fuzzy, multi-token**: query split on whitespace; every token must match (AND semantics). Tokens match against the title *and* a set of hidden "searchable texts" (keywords, directory, branch, port, description).
- **Switcher metadata indexing** (`CommandPaletteSwitcherSearchIndexer`, `CommandPaletteSearch.swift:21`): workspaces/surfaces are searchable by directory (full path, canonical, `~`-abbreviated, basename, path components), git branch (and its components), port numbers (`3000` and `:3000` forms), and free-text description. Context keywords are auto-injected — typing `dir`, `branch`, `port`, or `note` surfaces rows that *have* that metadata even if the literal value doesn't match.
- **Title match wins**: a literal title match (exact or leading prefix) always outranks an exact match on a hidden field, so the visible row that starts with what you typed sorts to the top.
- **Initialism / acronym matching**: typing `tm` matches "Task Manager"; word initials of the title are matched in order (`title_initialism_score` in Rust, `initialismScore` in Swift).
- **Typo tolerance** ("single edit"): for tokens ≥4 chars, one insertion/deletion/substitution/transposition against a word prefix still matches (`singleEditWordPrefixMatch`). This is the Swift-only augmentation layered onto Nucleo (see Implementation).
- **Stitched word prefixes**: a 4+ char token can match across two adjacent words (e.g. `taman` → "**Ta**sk **Man**ager").
- **Match highlighting**: matched character indices in the *title* are returned and rendered as emphasized runs (`titleMatchIndices` → `CommandPaletteRenderResultRow.matchedIndices`).
- **Usage history boost**: recently/frequently run commands rank higher. Recency decays ~20 pts/day from a 320 cap; frequency adds up to 180; on a non-empty query the boost is divided by 3 so typing still dominates (`historyBoost`, `CommandPaletteSearchOrchestrator.swift:373`). Persisted under `commandPalette.commandUsage.v1`.
- **Special-case boost**: typing exactly `fork` boosts `palette.forkAgentConversationRight` by 10,000 so the obvious intent wins (`commandPaletteForkPriorityBoost`, `:5247`).

### List interaction
- **Keyboard nav**: Up/Down arrows move selection; `Ctrl-N`/`Ctrl-P`-style bindings are configurable via `commandPaletteNext`/`commandPalettePrevious` actions and matched against the live key layout (`CommandPaletteShortcutRouting.swift`). Field-editor `moveUp:`/`moveDown:` selectors are also intercepted so arrows navigate the list even while the text field has focus.
- **Return** runs the selected result; **Shift-Return** is allowed except in the workspace-description multiline mode (where it inserts a newline) — `shouldSubmitCommandPaletteWithReturn` (`ShortcutRoutingSupport.swift:376`).
- **Escape** dismisses and is *consumed* so it never leaks to the underlying terminal/browser (`shouldConsumeShortcutWhileCommandPaletteVisible:343`).
- **Mouse hover** highlights a row (`hoveredIndex`); click runs it. Selected row uses accent tint at 12% opacity, hover uses primary at 8%.
- **Scroll-follow**: selection drives scroll position via `scrollTargetID`/`scrollTargetAnchor`; manual scrolling does **not** mutate selection (the `scrollPosition` binding deliberately ignores passive readback — `CommandPaletteOverlay.swift:148`).
- **List height** is content-sized up to a 450pt cap; rows are 24pt; an empty-state row is 44pt.
- **Empty state** text is scope-aware ("Type a command" vs "Search workspaces" / "Search workspaces and surfaces"). Empty state is shown only when appropriate, otherwise a clear spacer holds layout to avoid flicker.

### Clipboard / edit passthrough
While the palette is visible, common editing chords (`⌘A/C/V/X/Z/Y`, `⇧⌘Z`, delete, arrows) are intentionally *not* consumed so the text field behaves like a normal field; everything else with `⌘` is swallowed so it can't trigger background commands (`shouldConsumeShortcutWhileCommandPaletteVisible`).

---

## Implementation

### Command registration model (portable)
- `CommandPaletteCommandContribution` (`ContentView.swift:1505`): `commandId`, closures for `title`/`subtitle` (computed from a context snapshot, so labels can be dynamic, e.g. "Enable X" vs "Disable X"), optional `shortcutHint`, `keywords`, `dismissOnRun`, and two predicates — `when` (visibility) and `enablement` (greyed/disabled). Titles being closures-of-context is the key extensibility lever.
- `CommandPaletteHandlerRegistry` (`:1536`): a `[String: () -> Void]` map; each feature module registers handlers for its own command IDs (`register(commandId:handler:)`). Contributions (metadata) and handlers (behavior) are decoupled — a clean registry pattern directly portable to web.
- `CommandPaletteContextSnapshot` (`:1428`) + `CommandPaletteContextKeys` (`:1466`): a typed bag of bools/strings (e.g. `auth.signedIn`, `panel.isBrowser`, `workspace.hasSplits`) used by `when`/`enablement`. It exposes `fingerprint()` so the palette can detect when context changed and rebuild.
- Per-feature contribution files keep concerns local. Examples: view commands (`palette.triggerFlash`, `palette.openTaskManager`); auth (`palette.auth.signIn`/`signOut`, gated on `authSignedIn`/`authWorking`); right-sidebar mode switches and "open tool as pane" generated from `RightSidebarMode` enums; settings toggles generated from descriptors (`Enable/Disable %@` with live On/Off subtitle).
- **Command → keyboard-shortcut mapping**: `commandPaletteShortcutAction(forCommandID:)` (`CommandPaletteShortcutRouting.swift:4`) maps palette command IDs to `KeyboardShortcutSettings.Action`s, so the palette can render the real bound shortcut as a trailing hint and stay in sync with user-customized keybindings.

### Search corpus & two-engine architecture
- `CommandPaletteSearchCorpusEntry<Payload>` (`CommandPaletteSearch.swift:1128`): precomputes per entry — normalized title, prepared candidate texts, a `Set<String>` of exact searchable texts, a per-token whole-candidate prefix-score table, and a newline-joined `nucleoSearchText` blob. All the expensive normalization happens once at corpus-build time.
- **Swift reference engine** (`CommandPaletteFuzzyMatcher` + `CommandPaletteSearchEngine`, same file): the canonical scoring spec. Implements tiers — exact (8000) > whole-candidate prefix (~6800) > word prefix/exact-word > contains (with boundary boost) > initialism > stitched word prefix > single-edit prefix > short-token subsequence. Uses a **bounded worst-first heap** (`appendScoredEntry`, sift up/down) to keep only the top-N without sorting everything. Tie-break: score → rank → localized title → index.
- **ASCII bitmask prefilter** (`ASCIIScalarMask`, `:145`): each token/candidate gets two `UInt64`s representing which ASCII chars are present. `couldMatch` rejects a candidate in O(1) if the token needs chars the candidate lacks (allowing 1 missing bit when single-edit is permitted). Same trick mirrored in Rust (`ascii_mask`, `ascii_mask_query`, `ascii_prefilter_safe`).
- **Rust/Nucleo FFI** (`Native/CommandPaletteNucleoFFI/src/lib.rs`): wraps the `nucleo` crate. Builds an index from a flat UTF-8 blob + spans (title/search offsets + rank). Per token it scores title and each search line, applies `+2000` title bonus, plus exact-keyword and initialism tiers, and a `title_literal_score` that is *scaled by token count* so a visible title match beats a sum of hidden exact-keyword matches (extensive comments at `lib.rs:414-588` document this ranking war and past mis-ranks). Thread-local `Matcher` scratch (`SEARCH_STATE`) keeps the index immutable and search reentrant. Supports an optional per-candidate `boosts` array (used for history boost).

### FFI bridge & safety (AppKit/Swift-only, but the discipline is instructive)
- `CommandPaletteNucleoSearchLibrary` (`CommandPaletteNucleoSearch.swift:15`): `dlopen`s the dylib lazily (`static let shared`), resolving symbols via `dlsym` + `unsafeBitCast`. Tries several paths: `CMUX_NUCLEO_FFI_LIB` env override → app bundle PrivateFrameworks → multiple cargo `target/...` dirs (dev). If anything fails it returns `nil` and the app **silently falls back to the Swift engine**.
- **Version pinning**: `cmux_nucleo_ffi_version()` must equal `supportedVersion = 2`, else the library is rejected (prevents ABI drift after a Rust change).
- **ABI layout assertions** (`CommandPaletteNucleoABI.assertCompatibleLayout`, `:369`): preconditions on exact `MemoryLayout` size/stride/alignment and field offsets of the `#[repr(C)]` structs, run once at load. A mismatch crashes loudly at startup instead of silently corrupting memory.
- `CommandPaletteNucleoSearchIndex<Payload>`: owns the opaque pointer, destroys it in `deinit`, validates returned `index` is in-bounds, clamps/rounds the `f64` score to `Int` handling infinities/NaN (`clampedRoundedScore:342`).

### Orchestration & fallback merge
`CommandPaletteSearchOrchestrator.resolvedSearchMatches` (`:35`) is the coordinator:
1. If a Nucleo index exists, run it (with combined history + additional boosts).
2. If the query has a single-edit-eligible token (≥4 chars), and Nucleo's top-12 don't already cover that token without a typo edit, run the Swift engine's single-edit results and **merge** them into Nucleo's, deduped by ID, keeping the better score (`mergedSwiftFallbackMatches`). This patches the one capability Nucleo lacks vs. the Swift spec.
3. If no Nucleo index, use the Swift engine outright.

### Palette state & async pipeline (in `ContentView.swift`)
- State is a large set of `@State` fields (`isCommandPalettePresented`, `commandPaletteQuery`, `commandPaletteMode`, selected index, scroll target, corpus, corpus-by-ID, `commandPaletteNucleoSearchIndex`, build task/generation, visible results + version/scope/fingerprint).
- **Index build** is debounced/generational: `scheduleCommandPaletteSearchIndexBuild` (`:5215`) cancels the prior build, bumps a generation counter, builds the Nucleo index on a `Task.detached(.userInitiated)`, then on the main actor re-checks generation + scope + fingerprint before installing it. Stale builds are dropped.
- **Search** runs on `Task.detached` (`:5428`), in two phases: a fast **preview** pass over already-visible candidates for instant feedback, then the full `resolvedSearchMatches`. Both re-validate `requestID == commandPaletteSearchRequestID`, still presented, same scope/query/fingerprint before applying — so out-of-order async results can never overwrite newer ones. `shouldCancel: { Task.isCancelled }` is threaded all the way into the scoring loop (checked every 16 entries, `CommandPaletteSearch.swift:1316`).
- **Render model** (`CommandPaletteOverlayRenderModel`, `CommandPaletteOverlay.swift:34`): an `@Observable` that holds the immutable render state. `scheduleCommandListUpdate` uses two monotonic counters (`scheduledCommandListSequence` + `appliedCommandListResultsVersion`) and a `Task.yield()` so a newer render can't be clobbered by a late older one. `updateCommandList` early-returns if state is unchanged (Equatable diff).

### Overlay & focus (AppKit-only, very platform-specific)
- The palette is **not** a separate window; it's an `NSHostingView` (SwiftUI) inside a custom `CommandPaletteOverlayContainerView` injected into the window's content overlay (`WindowCommandPaletteOverlayController`, `ContentView.swift:145`). One controller per window, attached via `objc_setAssociatedObject` (`:628`).
- Container `hitTest` returns `nil` unless `capturesMouseEvents` is on, so the overlay is click-through when hidden and capturing when shown. Show/hide toggles `isHidden`/`alphaValue`/`capturesMouseEvents` and (re)mounts the SwiftUI root only while visible to avoid retaining UI when closed.

---

## Hardening & Lessons (the gold)

These are the things they clearly learned the hard way — most are encoded with comments or defensive scaffolding.

### Focus is the hardest problem (AppKit specifics, portable lesson: own your focus aggressively)
- **Focus lock timer**: while visible and the window is key, an 80ms repeating `DispatchSource` timer (`startFocusLockTimer:517`) re-asserts first-responder onto the palette text input if anything stole it. There's also a retrying scheduler (`scheduleFocusIntoPalette`, up to 8 retries, 20ms apart) for the initial grab, because SwiftUI text fields don't reliably become first responder on the first try.
- **Window key observers** (`installWindowKeyObservers:454`): on `didBecomeKey` it re-starts the lock + restores focus; on `didResignKey` it stops the timer and *releases* the palette's first-responder so the palette doesn't hold focus in a background window.
- **Field-editor ownership detection** is multi-path because "SwiftUI text fields can keep a field editor delegate that isn't an NSView" — it falls back to matching `textField.currentEditor() === textView` (`isPaletteFieldEditor:237`). Comment-documented surprise.
- **Selection normalization after programmatic focus** (`normalizeSelectionAfterProgrammaticFocus:543`): when AppKit re-focuses and selects the *entire* `>foo` query, it restores caret-at-end so the next keystroke appends instead of replacing the `>` and silently switching out of commands mode. Direct fix for a real mode-switch bug.
- Extensive `#if DEBUG cmuxDebugLog("palette.focus.*")` tracing around every focus attempt (direct/retry/lock/exhausted) — they instrumented this because it was flaky.

### Z-order / overlay teardown
- `promoteOverlayAboveSiblingsIfNeeded` re-adds the container `.above` siblings only on the visible transition (`CommandPaletteOverlayPromotionPolicy.shouldPromote`), so other overlays inserted later can't end up on top.
- `ensureInstalled` re-validates the container is still parented to the right install target and rebuilds constraints if the window's view tree changed (glass-effect portal etc.).
- On hide, the SwiftUI root is swapped back to `EmptyView()` and `hasMountedPaletteRootView=false` — explicit teardown so a closed palette retains no view state and no responder.

### Async race protection (portable)
- Every async result-apply re-checks a bundle of invariants (request ID, still presented, scope, matching query, context fingerprint) before mutating UI. Generation counters on index builds; monotonic version counters on render updates; `resultsVersion >= appliedResultsVersion` guards. The recurring theme: **never let a stale async response overwrite newer state** — checked at three layers (search task, orchestrator, render model).
- Cooperative cancellation is plumbed into the inner scoring loop and sampled (`index % 16 == 0`) to balance responsiveness vs. overhead.
- `shouldPreserveEmptyStateWhileSearchPending` (`Orchestrator:355`) avoids flashing "no results" while a search is still in flight for the same scope/fingerprint.
- `shouldSynchronouslySeedResults` (`:347`): if there are no visible results yet and the corpus is small (≤256) or an index exists, seed synchronously so the first frame isn't empty.

### Ranking correctness (battle-tested, comment-heavy)
- The Rust `title_literal_score` constants and per-token scaling exist specifically because a flat title constant lost to a *sum* of per-token hidden exact-keyword matches (`lib.rs:550-588` spells out the "ios app" → hidden "ios"+"app" ≈ 60,060 scenario). Prefix matches deliberately share one score to avoid a "shortest title wins" mis-rank where one title is a char-prefix of another.
- The Swift engine and Rust engine are kept in deliberate parity (comments cite "mirrors the Swift `CommandPaletteSearchEngine` reference ordering"); the Swift side is the spec and is also a test oracle (many `...ForTests` entry points).
- Diacritic + case folding via `Smart`/`folding(options:)` on both sides so `"e"` prefix-matches `"Éclair"`.

### ABI / FFI robustness
- Version check + exact memory-layout preconditions guard the C boundary; bad shapes crash at load, not mid-search.
- Multiple dylib search paths + env override + graceful Swift fallback mean a missing/incompatible native lib degrades to pure Swift instead of breaking the palette.
- Rust side defends against null pointers, bad UTF-8 (`-2`), and boost-array length mismatch (`-3`), and zeroes `out_count` up front.

### Input edge cases
- **IME / marked text**: `commandPaletteFieldEditorHasMarkedText` (`:394`) checks for in-progress composition so Return during IME composition isn't treated as submit.
- **Multi-window event targeting**: `shouldHandleCommandPaletteShortcutEvent` (`:405`) carefully resolves which window an event belongs to (event.window → windowNumber → keyWindow) so a palette in one window doesn't eat another window's keys.
- Escape and editing chords passthrough rules (above) prevent leaking keystrokes into terminal/browser content underneath.

---

## Portability notes for a React/web app

**Directly portable concepts:**
- The **contribution + handler registry** split (metadata vs. behavior), with `title`/`subtitle` as functions of a context snapshot and `when`/`enablement` predicates.
- The **single-field, prefix-switched dual scope** (`>` for commands, otherwise a "go to" switcher).
- **Metadata-derived searchable keywords** (path components, branch, port `:3000`, description) + auto-injected context keywords ("dir", "branch", "port").
- **Tiered fuzzy scoring** (exact > prefix > word-prefix > contains > initialism > subsequence) with **title-match bonus over hidden-field matches**, **usage-history recency/frequency boost** (divided down when typing), and **match-index highlighting**.
- **Async race discipline**: request IDs + monotonic version counters + invariant re-checks before applying results; cooperative cancellation; instant-preview-then-full-search two-phase.
- Keeping a **reference scorer as the spec/oracle** even if a faster engine does the real work, and using it to fill capability gaps (typo tolerance).

**Platform-specific (don't port literally):**
- The entire `WindowCommandPaletteOverlayController` focus machinery (first-responder, field editors, 80ms focus-lock timer, key-window observers) — web has `focus()`/`blur()` and the DOM focus model; the *lesson* (aggressively own and restore focus, normalize caret/selection after programmatic focus) ports, the mechanism does not.
- `dlopen`/`dlsym`/`#[repr(C)]` FFI and `MemoryLayout` ABI assertions — irrelevant to JS; the analogue is a WASM module with a version check and graceful JS fallback if it fails to load.
- AppKit z-order/`objc_setAssociatedObject` overlay injection — web uses a portal/`z-index`.
- `NSEvent` keyCode handling — web uses `KeyboardEvent`; the consume/passthrough policy (swallow Escape and unrelated `⌘` chords, let `⌘A/C/V/X/Z/Y` through) is the portable part.

---

## Key Files

| File | Role |
|------|------|
| `Sources/CommandPalette/CommandPaletteSearch.swift` | Pure-Swift fuzzy matcher (`CommandPaletteFuzzyMatcher`), corpus entry, bounded-heap search engine (`CommandPaletteSearchEngine`), switcher metadata indexer, ASCII bitmask prefilter. The scoring **spec/oracle**. |
| `Native/CommandPaletteNucleoFFI/src/lib.rs` | Rust C-ABI wrapper around the `nucleo` crate: index build, weighted scoring, title-literal/initialism/exact-keyword tiers, ASCII prefilter, boosts, thread-local matcher. |
| `Native/CommandPaletteNucleoFFI/Cargo.toml` / `Cargo.lock` | Rust crate manifest (builds `libcmux_command_palette_nucleo_ffi.dylib`). |
| `Sources/CommandPalette/CommandPaletteNucleoSearch.swift` | Swift FFI bridge: `dlopen`/`dlsym` loader, version check, ABI layout assertions, index lifecycle, score clamping, Sendable safety. |
| `Sources/CommandPalette/CommandPaletteSearchOrchestrator.swift` | Coordinates Nucleo vs. Swift engines, single-edit fallback merge, history-boost math, preview/seed/empty-state policies. |
| `Sources/CommandPalette/CommandPaletteOverlay.swift` | SwiftUI render model (`@Observable`, monotonic version guards) and the list/rows view (selection/hover/scroll-follow). |
| `Sources/CommandPalette/CommandPaletteSettingsToggle.swift` | Generates "Enable/Disable %@" toggle commands from setting descriptors with live On/Off subtitles. |
| `Sources/ContentView.swift` | Central palette state, overlay controller + focus machinery (`WindowCommandPaletteOverlayController`), contribution/registry/context types, async search & index-build pipeline, scope/prefix logic, present/dismiss/toggle. |
| `Sources/ContentView+ViewCommandPalette.swift` | View-scope command contributions (`palette.triggerFlash`, `palette.openTaskManager`) + handlers. |
| `Sources/ContentView+AuthCommandPalette.swift` | Auth commands (`palette.auth.signIn`/`signOut`) gated on `authSignedIn`/`authWorking`. |
| `Sources/ContentView+RightSidebarCommandPalette.swift` | Right-sidebar mode-switch & "open tool as pane" commands generated from `RightSidebarMode`; command↔shortcut mapping. |
| `Sources/App/CommandPaletteShortcutRouting.swift` | Maps palette command IDs → `KeyboardShortcutSettings.Action`; computes up/down selection delta from key events & `commandPaletteNext/Previous` bindings. |
| `Sources/App/ShortcutRoutingSupport.swift` | Key-event routing while palette visible: consume/passthrough policy, Return/Shift-Return submit, IME marked-text check, multi-window event targeting, arrow-key field-editor routing. |
