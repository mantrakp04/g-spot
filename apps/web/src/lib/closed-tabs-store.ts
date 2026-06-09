import { atomWithStorage } from "jotai/utils";

import { jsonStorage } from "./json-storage";
import type { Tab } from "./tabs-store";

/**
 * Capacity-bounded, persisted history of recently-closed tabs so a user can
 * reopen them (⌘⇧T). Each record carries enough to reconstruct the tab at its
 * original pane + index; reopen falls back to the first live pane when the
 * original pane no longer exists. Terminal tabs reopen as a fresh shell (the
 * PTY is torn down on close).
 */
export type ClosedTabRecord = {
  tab: Tab;
  paneId: string;
  index: number;
  closedAt: number;
};

const STORAGE_KEY = "gspot.tabs.closed.v1";
const MAX_CLOSED_TABS = 25;

export const closedTabsAtom = atomWithStorage<ClosedTabRecord[]>(
  STORAGE_KEY,
  [],
  jsonStorage<ClosedTabRecord[]>(STORAGE_KEY),
  { getOnInit: true },
);

/** Prepend newly-closed records (most-recent first) and clamp to capacity. */
export function pushClosedTabs(
  prev: ClosedTabRecord[],
  records: readonly ClosedTabRecord[],
): ClosedTabRecord[] {
  if (records.length === 0) return prev;
  return [...records, ...prev].slice(0, MAX_CLOSED_TABS);
}
