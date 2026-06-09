import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

/**
 * Central registry of every app-level keyboard shortcut.
 *
 * This is the single source of truth: components register their shortcuts by
 * `id` (via `useKeybind`/`useKeybinds`) instead of hard-coding key strings, and
 * the settings UI reads the same list to display and rebind them. User
 * overrides (custom combo / disabled) live in `store.ts`.
 *
 * Listbox-style navigation that is intrinsic to a focused widget (e.g. the
 * changes panel) is matched imperatively via `useKeybindMatcher` but still
 * resolves its combo from this registry, so it stays visible and rebindable.
 */

export type KeybindGroupId = "global" | "tabs" | "changes" | "inbox" | "review";

export type KeybindGroup = {
  id: KeybindGroupId;
  /** Section title in the settings UI. */
  label: string;
  /** Short hint about when these shortcuts are active. */
  description: string;
};

export const KEYBIND_GROUPS: readonly KeybindGroup[] = [
  {
    id: "global",
    label: "Global",
    description: "Available anywhere in the app.",
  },
  {
    id: "tabs",
    label: "Tabs & panes",
    description: "Managing the workspace tab bar and split panes.",
  },
  {
    id: "changes",
    label: "Source control",
    description: "Active while the changes panel is focused.",
  },
  {
    id: "inbox",
    label: "Inbox",
    description: "Active while viewing an email thread.",
  },
  {
    id: "review",
    label: "Code review",
    description: "Active while reviewing a pull request.",
  },
] as const;

export type KeybindDef = {
  id: string;
  group: KeybindGroupId;
  /** Human-readable name, also used as `meta.name` for the hotkey manager. */
  name: string;
  description?: string;
  /**
   * Factory-default combo. Usually a `@tanstack/hotkeys` string; a raw object
   * for layout-dependent keys the string type can't express (e.g. `?`).
   */
  defaultHotkey: RegisterableHotkey;
  /**
   * Whether the shortcut should be suppressed while typing in an input.
   * Defaults follow the library's per-key heuristic when omitted; we only set
   * it where the migrated handler relied on a specific behavior.
   */
  ignoreInputs?: boolean;
};

export const KEYBINDS = [
  // --- Global -------------------------------------------------------------
  {
    id: "global.commandPalette",
    group: "global",
    name: "Command palette",
    description: "Open the global command palette / search.",
    defaultHotkey: "Mod+K",
  },
  {
    id: "global.fileSearch",
    group: "global",
    name: "Search files",
    description: "Fuzzy-find a file in the current project.",
    defaultHotkey: "Mod+P",
  },
  {
    id: "global.toggleSecondarySidebar",
    group: "global",
    name: "Toggle secondary sidebar",
    defaultHotkey: "Mod+B",
  },
  {
    id: "global.toggleRightSidebar",
    group: "global",
    name: "Toggle right sidebar",
    defaultHotkey: "Mod+L",
  },
  // --- Tabs & panes -------------------------------------------------------
  {
    id: "tabs.newChat",
    group: "tabs",
    name: "New chat tab",
    defaultHotkey: "Mod+T",
  },
  {
    id: "tabs.newTerminal",
    group: "tabs",
    name: "New terminal tab",
    defaultHotkey: "Mod+Alt+T",
  },
  {
    id: "tabs.reopenClosed",
    group: "tabs",
    name: "Reopen closed tab",
    defaultHotkey: "Mod+Shift+T",
  },
  {
    id: "tabs.close",
    group: "tabs",
    name: "Close active tab",
    defaultHotkey: "Mod+W",
  },
  {
    id: "tabs.splitHorizontal",
    group: "tabs",
    name: "Split pane right",
    defaultHotkey: "Mod+D",
  },
  {
    id: "tabs.splitVertical",
    group: "tabs",
    name: "Split pane down",
    defaultHotkey: "Mod+Shift+D",
  },
  // --- Source control -----------------------------------------------------
  {
    id: "changes.selectAll",
    group: "changes",
    name: "Select all changes",
    description: "Select every file in the focused group.",
    defaultHotkey: "Mod+A",
  },
  {
    id: "changes.selectPrev",
    group: "changes",
    name: "Select previous file",
    defaultHotkey: "ArrowUp",
  },
  {
    id: "changes.selectNext",
    group: "changes",
    name: "Select next file",
    defaultHotkey: "ArrowDown",
  },
  {
    id: "changes.openDiff",
    group: "changes",
    name: "Open selected diff",
    defaultHotkey: "Enter",
  },
  {
    id: "changes.stage",
    group: "changes",
    name: "Stage / unstage selection",
    defaultHotkey: "Space",
  },
  // --- Inbox --------------------------------------------------------------
  {
    id: "inbox.nextThread",
    group: "inbox",
    name: "Next thread",
    defaultHotkey: "J",
  },
  {
    id: "inbox.prevThread",
    group: "inbox",
    name: "Previous thread",
    defaultHotkey: "K",
  },
  // --- Code review --------------------------------------------------------
  {
    id: "review.nextFile",
    group: "review",
    name: "Next file",
    defaultHotkey: "J",
  },
  {
    id: "review.prevFile",
    group: "review",
    name: "Previous file",
    defaultHotkey: "K",
  },
  {
    id: "review.prevStack",
    group: "review",
    name: "Previous PR in stack",
    defaultHotkey: "[",
  },
  {
    id: "review.nextStack",
    group: "review",
    name: "Next PR in stack",
    defaultHotkey: "]",
  },
  {
    id: "review.toggleHelp",
    group: "review",
    name: "Toggle keyboard help",
    // `?` is layout-dependent (Shift+/) and not a typed Hotkey string, so it's
    // expressed as a raw key object.
    defaultHotkey: { key: "?" },
  },
] as const satisfies readonly KeybindDef[];

export type KeybindId = (typeof KEYBINDS)[number]["id"];

export const KEYBIND_BY_ID: Record<KeybindId, KeybindDef> = Object.fromEntries(
  KEYBINDS.map((k) => [k.id, k]),
) as Record<KeybindId, KeybindDef>;
