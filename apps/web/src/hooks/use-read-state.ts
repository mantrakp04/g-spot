import { useState, useCallback, useSyncExternalStore } from "react";

const STORAGE_PREFIX = "g-spot:read:";

/** Shared in-memory cache so all hook instances see the same Set within a session */
const cache = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();

function getOrLoad(key: string): Set<string> {
  let set = cache.get(key);
  if (set) return set;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    set = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    set = new Set();
  }
  cache.set(key, set);
  return set;
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/**
 * Client-side read/unread tracking backed by localStorage.
 * Survives API refetches since it's separate from the query cache.
 */
export function useReadState(namespace: string) {
  const key = namespace;

  // Subscribe to changes so all components using this namespace re-render together
  const readIds = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => getOrLoad(key),
    () => getOrLoad(key),
  );

  const markAsRead = useCallback(
    (id: string) => {
      const prev = getOrLoad(key);
      if (prev.has(id)) return;
      // Create a new Set so useSyncExternalStore detects a changed snapshot
      const next = new Set(prev);
      next.add(id);
      cache.set(key, next);
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify([...next]));
      notify(key);
    },
    [key],
  );

  const isUnread = useCallback(
    (id: string) => !readIds.has(id),
    [readIds],
  );

  return { isUnread, markAsRead };
}
