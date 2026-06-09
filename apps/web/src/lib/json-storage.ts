/**
 * A localStorage-backed `SyncStorage` adapter for jotai's `atomWithStorage`,
 * storing JSON under a fixed key and degrading silently when storage is
 * unavailable. Shared across the tab-related stores so they all persist the
 * same way.
 */
export function jsonStorage<T>(storageKey: string) {
  return {
    getItem(_key: string, initialValue: T): T {
      if (typeof window === "undefined") return initialValue;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return initialValue;
        return JSON.parse(raw) as T;
      } catch {
        return initialValue;
      }
    },
    setItem(_key: string, value: T) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Storage may be disabled - degrade silently.
      }
    },
    removeItem(_key: string) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Storage may be disabled - degrade silently.
      }
    },
  };
}
