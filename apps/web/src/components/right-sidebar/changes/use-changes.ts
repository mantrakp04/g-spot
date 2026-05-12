import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type ViewMode = "list" | "tree" | "compact";

export type GroupId = "merge" | "staged" | "changes";

export const viewModeAtom = atomWithStorage<ViewMode>(
  "gspot.changes.viewMode.v1",
  "list",
);

const DEFAULT_EXPANDED: Record<GroupId, boolean> = {
  merge: true,
  staged: true,
  changes: true,
};

export const expandedGroupsAtom = atom<Record<GroupId, boolean>>(
  DEFAULT_EXPANDED,
);

export const selectionAtom = atom<Record<GroupId, string[]>>({
  merge: [],
  staged: [],
  changes: [],
});

export function useViewMode() {
  return useAtom(viewModeAtom);
}

export function useExpandedGroups() {
  return useAtom(expandedGroupsAtom);
}

export function useSelection() {
  return useAtom(selectionAtom);
}
