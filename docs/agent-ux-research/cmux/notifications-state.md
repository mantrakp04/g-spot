# cmux — Notifications & State (Feed, Closed-Item History, Telemetry, Debug Logging, Crash/Restore)

Research notes from the cmux codebase (`/tmp/cmux-analysis`). Bucket: **notifications-state**. Covers agent-activity notifications, the Feed (event classification + actionable approvals), closed-item history & restore, socket operation telemetry, debug-log redaction, and crash/restore persistence.

Annotations: **[AppKit]** = macOS/AppKit-specific; **[Portable]** = concept transfers cleanly to a React/web app; **[Hybrid]** = portable idea, native plumbing.

---

## Overview

cmux notifies the user about agent activity through two parallel surfaces:

1. **In-app notifications** (`TerminalNotificationStore`) — a record store of per-workspace/per-surface "something happened" cards driving sidebar badges, dock badge, pane flashes, and (when the app isn't focused) native macOS banners. These are *informational*.
2. **The Feed** (`FeedCoordinator` + `WorkstreamStore`) — *actionable* agent items (permission requests, plan approvals, questions). A blocking hook on the agent side waits for the user's decision, which is returned inline over a socket.

The split between "informational notification" and "actionable approval" is the central design decision. The classification of *which* agent hook events are actionable lives in one pure, unit-tested file (`FeedEventClassifier`), explicitly to prevent a tool-start from being mistaken for an approval (the bug behind issue #4985).

Surrounding these are: **closed-item history** (recently-closed tabs/workspaces/windows, persisted and restorable), **socket telemetry** (phase/byte tracking for CLI socket ops), **redacting debug logger**, and **crash breadcrumbs** (detect a Ghostty crash across launches and surface it as a notification).

---

## Features & UX

### In-app notifications
- **Per-workspace and per-pane unread indicators.** A notification is keyed by `(tabId, surfaceId)`; the store derives unread badges at workspace level and pane level. **[Portable]**
- **Dock badge** with unread count, capped at `99+`, optionally prefixed with a run tag (`CMUX_TAG`, e.g. `prod:5`). Toggleable via settings. **[AppKit]** dock badge; **[Portable]** count/cap/tag logic.
- **Pane flash / pane ring** — a visual flash on the pane that produced an unread notification. Controlled by `paneFlash` per-notification flag and `NotificationPaneFlashSettings`. **[Portable]** concept (highlight the source pane).
- **Workspace auto-reorder** — when enabled, a workspace that gets a notification moves to the top of the tab list (`moveTabToTopForNotification`). **[Portable]**
- **Focused-read suppression** — if the app is focused AND the target tab+surface is the focused one, the external banner is suppressed but a subtle "focused read indicator" is shown so the user knows activity happened where they're already looking. **[Portable]** (don't toast what the user is staring at).
- **Mark read / unread** at notification, surface, workspace, and "all" granularity. "Mark latest as oldest unread" re-surfaces a workspace as unread without spamming. **[Portable]**
- **Click action: reveal in Finder** — a notification can carry a `clickAction` (`.revealInFinder(path:)`) acted on when the banner is clicked. **[AppKit]** plumbing, **[Portable]** concept.
- **Custom notification sound** — choice of system sounds, a custom audio file, or none. Custom files are transcoded (via `afconvert`) and staged into `~/Library/Sounds`. **[AppKit]**
- **Custom notification command** — user can run a shell command on each notification, with `CMUX_NOTIFICATION_TITLE/SUBTITLE/BODY` env vars. **[Hybrid]** (web equivalent: webhook).
- **Notification policy hooks** — per-project executable hooks that receive the notification envelope as JSON on stdin and can rewrite title/body or suppress effects (`record`, `markUnread`, `reorderWorkspace`, `desktop`, `sound`, `command`, `paneFlash`). **[Hybrid]**
- **iPhone mirroring (opt-in)** — desktop-delivered notifications can be forwarded to the user's phone (`PhonePushClient.forward`). Suppressed/focused notifications are *not* forwarded. **[Portable]**
- **Authorization UX** — if notifications are denied, an alert offers "Open Settings"; first-launch authorization is deferred until the app is active to avoid prompting at a bad moment. **[AppKit]**

### Feed (actionable agent items)
- **Permission request / plan approval / question cards.** An agent hook blocks; the user approves/denies/answers from the Feed sidebar without switching focus to the terminal. The decision returns inline to the hook. **[Portable]** (core agent-UX pattern).
- **Jump to source** — a Feed card can focus the originating workspace+surface (`focusIfPossible`), resolved by mapping `workstream_id` → `(workspaceId, surfaceId)` via the agent's hook-session JSON. **[Portable]**
- **Reply inline** — Stop-kind cards let the user type text that is sent into the agent's terminal followed by Return (`sendTextToWorkstream`), so you can reply from the Feed. **[Portable]**
- **Native banner with inline actions when the app is backgrounded** — if a blocking actionable event arrives and the app isn't focused, a UN banner with approve/deny buttons is posted so the user can respond without switching windows. Suppressed entirely if the app is active. **[AppKit]** for inline action buttons; **[Portable]** concept.
- **Automatic expiry of stale cards** — if the agent process dies while a card is pending, the card is marked `.expired` instantly. Timed-out blocking waits also expire. **[Portable]**
- **Read-only tools never prompt** — Read/Grep/Glob/etc. stay non-actionable telemetry; only state-mutating tools (Bash/Write/Edit/shell/…) escalate to an approval. **[Portable]**

### Closed-item history (recently closed)
- **Reopen most-recently-closed** (panel/tab, workspace, or whole window) — Cmd-style "reopen closed tab" that also handles workspaces and windows, restoring split layout, anchor placement, and titles. **[Portable]** concept.
- **Reopen a specific item** from a History menu listing each closed item with a title + "Closed 3:42 PM" subtitle and a Tab/Workspace/Window kind label. **[Portable]**
- **Clear recently-closed history.** **[Portable]**
- **Survives quit** — history persists to disk and is restorable across launches. **[Portable]**

### Crash / restore
- **Crash breadcrumb notification** — on launch, if a Ghostty crash file newer than the last clean exit (and matching the current executable) is found, a notification is posted; clicking it reveals the crash file in Finder. Shown once per crash. **[Hybrid]** (web: detect dirty shutdown, surface a banner).

---

## Implementation

### State ownership & wiring
- **`TerminalNotificationStore`** (`@MainActor`, `ObservableObject`, singleton) owns `@Published notifications: [TerminalNotification]` plus four unread-indicator sets (`manualUnread…`, `panelDerived…`, `restored…`, and the `notifications` themselves) and `focusedReadIndicatorByTabId`. A `didSet` rebuilds derived `NotificationIndexes` (unread counts by tab, by tab+surface, latest-by-tab) so lookups are O(1) — the published list is the source of truth, indexes are a cache. **[Portable]** pattern (derive memoized selectors from one source array).
- **`TerminalMutationBus`** (`@unchecked Sendable`, lock-protected, singleton) is a **serialized mutation queue** between the socket thread and the main actor. Socket handlers enqueue `deliverNotification` / `clearAll` / `clearForTab` / `clearForSurface` / `perform(@MainActor closure)`; the bus drains them on the main actor in **sequence-ordered batches of ≤16** to keep ordering deterministic and avoid flooding the run loop. **[AppKit/concurrency]**, but the **batched, ordered, coalescing queue is [Portable]**.
- **`FeedCoordinator`** (`@unchecked Sendable`, singleton) owns the main-actor `WorkstreamStore` and bridges the socket thread to it. Blocking hooks park on a `DispatchSemaphore` keyed by `requestId` in a lock-protected `waiters` dict; `deliverReply` fills the decision slot and signals. **[AppKit/concurrency]**, concept **[Portable]** (request/response correlation table + condition var).
- **`WorkstreamStore`** owns the `[WorkstreamItem]` with statuses (`pending`/`resolved`/`expired`/`telemetry`). Item kind drives `isActionable` → pending vs telemetry status.

### Feed event classification (`CLI/FeedEventClassifier.swift`) — **[Portable]**
- A **pure, typed registry** keyed on `(source, event)` → `FeedEventSemantic` (`approvalRequest`, `toolStart`, `toolStartMaybeApproval`, `toolEnd`, `promptSubmit`, `response`, `subagentResponse`, `sessionStart/End`, `statusNotification`, `unknown`). Notification eligibility is derived *only* from the resolved semantic, never from raw event-name string matching.
- Agents with a **dedicated approval event** (Claude/Codex `PermissionRequest`, Hermes `pre_approval_request`) classify their pre-tool event as `toolStart` (always telemetry). Agents whose *only* signal is the pre-tool event (gemini, copilot, generic) use `toolStartMaybeApproval`, which escalates **side-effecting tools** to approvals while read-only tools stay telemetry.
- `isSideEffectingTool` is an explicit allow-set (`Bash`, `Write`, `Edit`, `shell`, `terminal`, `apply_patch`, …). Kiro gets case-insensitive aliases (`fs_write`, `execute_bash`, …), scoped to the `kiro` source only so other agents' lowercase tool names aren't broadened.
- Compiled into both the CLI target and the test target so the decision is unit-tested without launching the app (`FeedEventClassificationTests`).

### Closed-item history (`ClosedItemHistory.swift`, `AppDelegate+ClosedItemHistory.swift`)
- `ClosedItemHistoryEntry` is an enum of `.panel` / `.workspace` / `.window`, each carrying a `Session*Snapshot`. Records are `Codable` with `id`, `closedAt`, and a versioned persistence wrapper (`ClosedItemHistoryPersistenceSnapshot`, `currentVersion = 1`). **[Portable]** (tagged union + version field).
- **`ClosedItemHistoryStore`** (`@MainActor`, `ObservableObject`) holds `[ClosedItemHistoryRecord]` and a monotonically-incrementing `revision`. Persistence is async by default through a dedicated **actor** (`ClosedItemHistoryPersistenceActor`) that **drops stale writes** by tracking the latest revision per file path (so an out-of-order async save can't clobber newer state). Writes are atomic and skipped if the encoded bytes are byte-identical to what's on disk.
- **Restore is by recency with fallback**: `restoreFirstRestorable(newerThan:excluding:onFailure:)` sorts candidates newest-first, tries each, and on failure records the id in an exclusion set and continues. `reopenClosedHistoryItem(id:)` removes the record, tries to restore, and **re-inserts at the original index if restore fails** (no silent data loss).
- File path is namespaced per bundle id (`closed-item-history-<bundleId>.json`) and disabled under automated tests.

### Notification policy engine (`TerminalNotificationPolicy.swift`) — **[Hybrid]**
- Hooks run as `posix_spawn`'d `/bin/sh -c` processes in their own process group, fed the envelope JSON on stdin + as env vars. Output is parsed as a JSON **patch** merged into the envelope (`…EnvelopePatch.merged(into:)`).
- The engine (`NotificationHookProcessRun`) is a hand-rolled async process runner using `DispatchSource` read/process/timer sources: non-blocking pipes, output capped at 1 MiB (stdout) / 64 KiB (stderr), SIGTERM on timeout/overflow followed by SIGKILL after a 750 ms grace period. Termination status is normalized (`128 + signal`).

### Socket operation telemetry (`CLI/SocketOperationTelemetry.swift`) — **[Portable]**
- `CLISocketOperationTelemetry.State` tracks a single socket op: `name`, `timeout`, `startedAt`, `phase` (`writeRequest` → `waitForResponse` → `readMultilineResponse` → `completed`), `bytesRead`, `sawNewline`. `context()` emits a flat dict (op name, phase, timeout, duration-ms, bytes, sawNewline) for diagnostics.
- `operationName(for:)` derives a stable op label: if the command is JSON it uses the `method` field; otherwise the first whitespace-delimited token; `"unknown"` on empty/garbage.
- Used in `cmux.swift`'s `send`/`sendOneWay` to record the live phase before each blocking read, so a hung CLI can be diagnosed (which phase, how many bytes, did we see a newline).

### Debug logging (`Packages/CMUXDebugLog/DebugEventLog.swift`) — **[Portable]**
- DEBUG-only ring buffer (cap 500) that *also* appends every line to a resolved log file immediately (so `tail -f` shows live diagnostics). Serial dispatch queue. Log path resolves from `CMUX_DEBUG_LOG` → `CMUX_TAG` → `CMUX_SOCKET_PATH`-derived → bundle-id → `/tmp/cmux-debug.log`.
- **Automatic field redaction**: a regex finds `key=value` pairs and redacts values for sensitive keys (`token`, `cookie`, `authorization`, `path`, `url`, `body`, `stdout`, `command`, `*args`, `*input`, …). URL-like fields keep only `scheme://host`; everything else becomes `<redacted:Nb>`. "Greedy" keys (`body`, `payload`, `stdout`, `*command`) consume the rest of the line. A `knownDebugFieldNames` allow-list bounds where a greedy redaction stops.

### Crash breadcrumb (`GhosttyCrashBreadcrumb.swift`) — **[Hybrid]**
- On a *clean* exit, `markCleanExit()` writes a timestamp to `UserDefaults`. On launch, `pendingCrash()` scans `~/.local/state/cmux/crash` for `.ghosttycrash` files newer than both the last clean exit and the last-shown crash, and matching the current executable path (`crashReportMatchesCurrentExecutable`). The newest match becomes a notification on a fixed sentinel tab id; `markShown` records it so it's shown once.

---

## Hardening & Lessons (the gold)

These are things they clearly learned the hard way — defensive patterns and bug-specific guards.

1. **Classify by semantic, never by raw event-name string (issue #4985).** A tool-*starting* hook was being mistaken for an approval request, blocking the agent and spamming "needs approval". Fix: a typed `(source,event)→semantic` registry where notification eligibility is derived only from the semantic. Comments explicitly say "Conflating a tool-start with an approval is the bug behind #4985." **Lesson for web: route agent events through one typed classifier, default unknown events to non-actionable.**

2. **`isAwaitingDecision` re-checks at every async boundary.** The Feed banner pipeline re-checks the waiter table *before posting, after policy-hook authorization, after policy evaluation, in `getNotificationSettings`, in the auth callback, and in the `center.add` completion*. A resolved/timed-out request can never post a stale banner while the main queue / hooks / notification center catch up. If it resolved mid-flight, it cancels any banner already added. **Lesson: for any async notify pipeline, re-validate "is this still relevant?" at each hop, not just at entry.**

3. **Register the waiter BEFORE the store sees the event.** "Register the waiter before the store sees the event so a very fast reply can't slip through." Classic register-then-fire ordering to avoid a lost wakeup. **[Portable]**

4. **Cap pending lifetime to the agent process lifetime via kqueue, not polling.** `FeedCoordinator` installs one `DispatchSourceProcess(.exit)` per agent PID; the instant the process dies (or immediately if already dead), every pending card for that PID is expired and the source cancelled. Idempotent per-PID. At startup, `expireAbandonedItems` sweeps restored-from-disk items whose PID is gone (`kill(pid,0)`; `EPERM` = alive). **Lesson: tie "pending request" UI lifetime to the producer's liveness, not a generic timeout, so killed agents don't leak cards.**

5. **`kill(pid,0)` liveness probe treats `EPERM` as alive.** Comment notes hook PIDs are same-user in practice, but the safe interpretation is "alive but not ours" rather than "gone." **[Portable]** reasoning.

6. **Stale-write protection on async persistence.** `ClosedItemHistoryPersistenceActor` tracks the latest `revision` per file path and **drops any save whose revision is older** than what it last wrote — prevents an out-of-order async task from resurrecting old state. Also: skip the write entirely if the encoded bytes equal the file on disk. **[Portable]** (revision-guarded last-writer-wins).

7. **Restore failure is non-destructive.** `reopenClosedHistoryItem` re-inserts the record at its original index if restore fails; `restoreFirstRestorable` excludes failed ids and keeps trying older candidates rather than giving up. Closed-window restore validates it actually produced usable live panels (`ClosedWindowRestoreValidation.hasUsableRestoredContent`) and discards the spawned window + remaps history ids back if not. **Lesson: never delete history on a restore attempt until restore is confirmed.**

8. **Pending mutations queued while history is still loading from disk.** Remaps/removes that arrive before the async load completes are queued (`pendingPersistedRecordMutations`) and replayed onto the loaded records; `removeAll` during load sets a `shouldDiscardPersistedRecordsOnLoad` flag instead of racing. **[Portable]** (buffer mutations until hydration completes).

9. **Off-main XPC for notification removal.** Comment: `UNUserNotificationCenter.removeDelivered/PendingNotifications` "perform synchronous XPC to usernoted… When usernoted is slow, this blocks the calling thread indefinitely." Fix: dedicated utility queue (`removeDeliveredNotificationsOffMain`). **[AppKit-specific]** but the lesson is **[Portable]**: never call a potentially-blocking platform API on the UI thread.

10. **Notification coalescing + generation boundaries in the mutation bus.** Notifications for the same `(tab,surface)` within a generation coalesce (newest replaces older queued ones). `markNotificationClearBoundary()` returns a generation so a "clear" can discard exactly the notifications enqueued *before* it without dropping ones enqueued after. Drains are capped at 16/batch and sequence-numbered. **Lesson: dedupe rapid-fire notifications by key, and use a monotonic boundary so clear/deliver races resolve deterministically.**

11. **Unique-id guarantee on restore.** `restoreSessionNotifications` reassigns a fresh UUID to any restored notification whose id collides with an in-memory one (`notificationWithUniqueId`), so a session restore can't create duplicate-keyed entries. There's even a cross-reference comment in `CmuxEventPublishing.swift` pointing at this invariant. **[Portable]**

12. **Cooldown reservations are transactional.** Adding a notification reserves a cooldown slot; if the policy hook ultimately produces *no* effect, the reservation is *restored* (rolled back) rather than committed, so a no-op doesn't burn the cooldown window. **[Portable]**

13. **Hook failures are throttled and surfaced once.** `reportNotificationHookFailure` throttles per `(hookId, sourcePath)` to one alert / 5 min and logs with `privacy: .private`. The notification policy engine kills runaway hooks (timeout, 1 MiB output cap, SIGTERM→SIGKILL grace). **[Hybrid]**

14. **Focus suppression is narrowly scoped.** `AppFocusState.isAppFocused()` only counts the app as "focused for suppression" when a *main terminal window* (`cmux.main*`) is key — Settings/About/debug panels being key still allows notifications. **[Portable]** reasoning: "focused" for suppression purposes means "looking at the relevant surface," not just "app is frontmost."

15. **Authorization request deferral.** First-time notification permission is *not* requested while the app is inactive (would prompt at a confusing time); it's deferred and retried on `applicationDidBecomeActive`. The "open settings" prompt retries up to 20× (0.5 s) waiting for a window, and resets its one-shot flag if no window ever appears so a later denial can re-prompt. **[AppKit]**, lesson **[Portable]** (don't ask for permissions out of context).

16. **Crash detection guards against false positives.** A crash is only surfaced if its file is newer than the last clean exit *and* the last shown crash *and* the executable path matches the current binary — so stale crashes from an old build or already-acknowledged crashes don't re-nag. **[Portable]**

17. **Debug-log redaction is allow-list-bounded and length-preserving.** Redacted values become `<redacted:Nb>` (keeps byte count for debugging) and URL fields keep `scheme://host`. Greedy fields stop at the next *known* field name to avoid over-redacting. **Lesson: redact-by-default for sensitive keys in any diagnostics that might be shared.**

18. **Socket telemetry records phase before each blocking read.** Because the CLI does multi-line reads with an idle timeout after the first newline, telemetry captures which phase + how many bytes + whether a newline was seen — making a hung socket diagnosable post-mortem. **[Portable]**

19. **Test seams everywhere.** `FeedCoordinatorTestHooks`, injectable notification delivery/feedback handlers, `setDrainsSuspendedForTesting`, injectable window/alert/scheduler/url-opener for the settings prompt, and the classifier being a pure function. Heavy investment in making concurrency-/AppKit-coupled code unit-testable. **[Portable]** practice.

---

## Key Files

| File | Role |
| --- | --- |
| `CLI/FeedEventClassifier.swift` | Pure, typed `(source,event)→semantic` classifier; single source of truth for which agent hook events are actionable. Guard against #4985. |
| `Sources/Feed/FeedCoordinator.swift` | Bridges socket thread ↔ main-actor `WorkstreamStore`; blocking-hook semaphores; per-PID kqueue expiry; backgrounded native banner pipeline with re-checked `isAwaitingDecision`; `FeedJumpResolver` (jump/reply); `FeedSocketEncoding` (wire JSON + text limits). |
| `Sources/TerminalNotificationStore.swift` | Main-actor notification record store; unread indexes; read/unread/clear ops; dock badge; sound/custom-command/policy-hook delivery; authorization UX; session-restore + unique-id guarantee. |
| `Sources/TerminalNotificationQueue.swift` | `TerminalMutationBus` — serialized, coalescing, generation-aware, batched (≤16) mutation queue between socket thread and main actor. |
| `Sources/TerminalNotificationPolicy.swift` | Notification policy envelope/effects/patch types; `posix_spawn` hook runner (`NotificationHookProcessRun`) with caps, timeouts, SIGTERM→SIGKILL; trust authorization. |
| `Sources/ClosedItemHistory.swift` | `ClosedItem*` entry/record types; `ClosedItemHistoryStore` (revision-tracked, versioned, atomic persistence); `ClosedItemHistoryPersistenceActor` (stale-write drop); menu snapshot/title derivation; restore validation. |
| `Sources/AppDelegate+ClosedItemHistory.swift` | Reopen most-recent / by-id / clear; non-destructive restore (re-insert on failure); window/workspace/panel restore + history-id remap. |
| `CLI/SocketOperationTelemetry.swift` | `CLISocketOperationTelemetry.State` phase/byte/timeout tracking; `operationName(for:)` (JSON `method` or first token). |
| `CLI/cmux.swift` (≈1660–1845) | Consumer of socket telemetry; records live phase across multi-line reads with idle-timeout. |
| `Packages/CMUXDebugLog/Sources/CMUXDebugLog/DebugEventLog.swift` | DEBUG ring-buffer + live file logger with allow-list-bounded, length-preserving field redaction; env-driven log path. |
| `Sources/App/DebugLogging.swift` | `cmuxDebugLog` shim (DEBUG only) forwarding to `DebugEventLog`. |
| `Sources/GhosttyCrashBreadcrumb.swift` | Clean-exit timestamping + crash-file detection (newer-than + executable-match) surfaced as a one-shot reveal-in-Finder notification. |
| `Packages/CMUXWorkstream/Sources/CMUXWorkstream/WorkstreamStore.swift` | Item store; `expireItems(forPpid:)`, `expireAbandonedItems(isProcessAlive:)`, `kill(pid,0)` liveness; kind→pending/telemetry status. |
| `cmuxTests/FeedEventClassificationTests.swift` | Regression suite locking in #4985 behavior (Hermes pre_tool_call stays non-actionable even for Bash/Write). |
| `Sources/NotificationsPage.swift` / `Sources/Feed/FeedPanelView*.swift` | SwiftUI surfaces for notification list and Feed panel. **[AppKit/SwiftUI]** |

---

## Portability summary for the web app

- **Steal directly:** the typed event classifier (unknown→non-actionable default), the actionable-vs-informational split, the request/reply correlation table for blocking approvals, expiry of pending UI when the producer dies, revision-guarded last-writer-wins persistence, non-destructive restore, notification coalescing by key + clear/deliver generation boundaries, transactional cooldowns, redact-by-default diagnostics, crash/dirty-shutdown detection guarded by clean-exit timestamps, and re-validating relevance at every async hop.
- **Adapt:** notification policy hooks (→ server-side webhook/transform), custom sound/command (→ browser notification + optional webhook), iPhone mirroring (→ web push), focus suppression (→ suppress toasts for the surface the user is actively viewing).
- **AppKit-only (re-implement natively per platform):** dock badge, UN banners with inline action buttons, off-main XPC removal, OS authorization flow, `afconvert` sound staging, `posix_spawn`/`DispatchSource` process plumbing.
