import {
  matchesKeyboardEvent,
  useHotkeys,
  type UseHotkeyDefinition,
  type UseHotkeyOptions,
} from "@tanstack/react-hotkeys";
import { useCallback } from "react";

import { KEYBIND_BY_ID, type KeybindId } from "./registry";
import { useResolvedKeybindMap } from "./store";

/** Per-call options for `useKeybind` — a subset of the library's options plus our gate. */
export type KeybindOptions = Omit<UseHotkeyOptions, "enabled"> & {
  /**
   * Extra enable gate (ANDed with the user's enable/disable preference). Use
   * for context scoping, e.g. only while a thread is selected.
   */
  enabled?: boolean;
};

type KeybindBinding = {
  id: KeybindId;
  callback: (event: KeyboardEvent) => void;
  options?: KeybindOptions;
};

/**
 * Register several registry-defined keybinds at once. The combo and
 * enable/disable state are resolved from the registry + user overrides; callers
 * only supply the id, the callback, and optional scoping.
 */
export function useKeybinds(bindings: KeybindBinding[]): void {
  const resolved = useResolvedKeybindMap();

  const definitions: UseHotkeyDefinition[] = bindings.map(
    ({ id, callback, options }) => {
      const def = KEYBIND_BY_ID[id];
      const entry = resolved.get(id);
      const hotkey = entry?.hotkey ?? def.defaultHotkey;
      const userEnabled = entry?.enabled ?? true;
      const { enabled: callerEnabled = true, ...rest } = options ?? {};
      return {
        hotkey,
        callback,
        options: {
          ...(def.ignoreInputs !== undefined
            ? { ignoreInputs: def.ignoreInputs }
            : {}),
          ...rest,
          enabled: userEnabled && callerEnabled,
          meta: { name: def.name, description: def.description },
        },
      };
    },
  );

  useHotkeys(definitions);
}

/** Register a single registry-defined keybind. */
export function useKeybind(
  id: KeybindId,
  callback: (event: KeyboardEvent) => void,
  options?: KeybindOptions,
): void {
  useKeybinds([{ id, callback, options }]);
}

/**
 * Returns a matcher for element-scoped `onKeyDown` handlers (e.g. a focused
 * listbox). Lets such handlers honor the registry's combo + enable state
 * without registering a document-level hotkey.
 */
export function useKeybindMatcher(): (
  id: KeybindId,
  event: KeyboardEvent | React.KeyboardEvent,
) => boolean {
  const resolved = useResolvedKeybindMap();
  return useCallback(
    (id, event) => {
      const entry = resolved.get(id);
      if (!entry || !entry.enabled) return false;
      return matchesKeyboardEvent(
        "nativeEvent" in event ? event.nativeEvent : event,
        entry.hotkey,
      );
    },
    [resolved],
  );
}
