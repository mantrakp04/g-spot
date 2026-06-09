import type { Hotkey } from "@tanstack/react-hotkeys";
import {
  normalizeHotkey,
  normalizeRegisterableHotkey,
} from "@tanstack/react-hotkeys";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useMemo } from "react";

import { jsonStorage } from "../json-storage";
import {
  KEYBINDS,
  KEYBIND_BY_ID,
  type KeybindDef,
  type KeybindGroupId,
  type KeybindId,
} from "./registry";

/** A user's customization of a single keybind. Absent fields fall back to defaults. */
export type KeybindOverride = {
  hotkey?: Hotkey;
  disabled?: boolean;
};

export type KeybindOverrides = Partial<Record<KeybindId, KeybindOverride>>;

const STORAGE_KEY = "gspot.keybinds";

/** Persisted map of user overrides keyed by keybind id. */
export const keybindOverridesAtom = atomWithStorage<KeybindOverrides>(
  STORAGE_KEY,
  {},
  jsonStorage<KeybindOverrides>(STORAGE_KEY),
  { getOnInit: true },
);

/** A keybind def resolved against the current user overrides. */
export type ResolvedKeybind = {
  def: KeybindDef;
  hotkey: Hotkey;
  enabled: boolean;
  /** True when the combo differs from the factory default. */
  isCustomHotkey: boolean;
  /** Ids of other enabled keybinds that share this combo in an overlapping scope. */
  conflictsWith: KeybindId[];
};

/** Two scopes overlap (and can collide) when either is global or they're the same group. */
function scopesOverlap(a: KeybindGroupId, b: KeybindGroupId): boolean {
  return a === "global" || b === "global" || a === b;
}

const resolvedKeybindsAtom = atom<ResolvedKeybind[]>((get) => {
  const overrides = get(keybindOverridesAtom);

  const base = KEYBINDS.map((def) => {
    const override = overrides[def.id as KeybindId];
    const defaultHotkey = normalizeRegisterableHotkey(def.defaultHotkey);
    const hotkey = override?.hotkey ?? defaultHotkey;
    return {
      def,
      hotkey,
      enabled: !override?.disabled,
      isCustomHotkey:
        normalizeHotkey(hotkey) !== normalizeHotkey(defaultHotkey),
      normalized: normalizeHotkey(hotkey),
    };
  });

  return base.map((entry) => {
    const conflictsWith = entry.enabled
      ? base
          .filter(
            (other) =>
              other.def.id !== entry.def.id &&
              other.enabled &&
              other.normalized === entry.normalized &&
              scopesOverlap(entry.def.group, other.def.group),
          )
          .map((other) => other.def.id as KeybindId)
      : [];
    return {
      def: entry.def,
      hotkey: entry.hotkey,
      enabled: entry.enabled,
      isCustomHotkey: entry.isCustomHotkey,
      conflictsWith,
    };
  });
});

/** Resolved keybinds as a flat list (registry order). */
export function useResolvedKeybinds(): ResolvedKeybind[] {
  return useAtomValue(resolvedKeybindsAtom);
}

/** Resolved keybinds keyed by id, for O(1) lookup. */
export function useResolvedKeybindMap(): Map<KeybindId, ResolvedKeybind> {
  const resolved = useResolvedKeybinds();
  return useMemo(
    () => new Map(resolved.map((r) => [r.def.id as KeybindId, r])),
    [resolved],
  );
}

/** Mutation helpers for the settings UI. */
export function useKeybindActions() {
  const setOverrides = useSetAtom(keybindOverridesAtom);

  const setHotkey = useCallback(
    (id: KeybindId, hotkey: Hotkey) => {
      setOverrides((prev) => {
        const next = { ...prev };
        const isDefault =
          normalizeHotkey(hotkey) ===
          normalizeRegisterableHotkey(KEYBIND_BY_ID[id].defaultHotkey);
        const rest = { ...next[id] };
        if (isDefault) delete rest.hotkey;
        else rest.hotkey = hotkey;
        if (rest.hotkey === undefined && rest.disabled === undefined)
          delete next[id];
        else next[id] = rest;
        return next;
      });
    },
    [setOverrides],
  );

  const setEnabled = useCallback(
    (id: KeybindId, enabled: boolean) => {
      setOverrides((prev) => {
        const next = { ...prev };
        const rest = { ...next[id] };
        if (enabled) delete rest.disabled;
        else rest.disabled = true;
        if (rest.hotkey === undefined && rest.disabled === undefined)
          delete next[id];
        else next[id] = rest;
        return next;
      });
    },
    [setOverrides],
  );

  const reset = useCallback(
    (id: KeybindId) => {
      setOverrides((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setOverrides],
  );

  const resetAll = useCallback(() => setOverrides({}), [setOverrides]);

  return { setHotkey, setEnabled, reset, resetAll };
}
