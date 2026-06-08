import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback } from "react";

import { disposeTerminalSession } from "@/components/terminal/terminal-sessions";

/**
 * Tab state is split into three layers:
 *
 * - tabsById: tab metadata keyed by id.
 * - panesById: each pane's ordered tab ids and active tab.
 * - paneLayout: the split tree, with leaves referencing pane ids only.
 *
 * Rendering uses a hydrated derived tree so UI code can stay simple while
 * mutations are explicit about whether they touch tab data, pane membership,
 * or split geometry.
 */

export type ChatTab = {
  id: string;
  kind: "chat";
  projectId: string;
  chatId: string | null;
  title: string;
  /** Deep-link hints from the URL - read once by ChatView, then cleared. */
  focusMessageId?: string;
  searchText?: string;
};

export type TerminalTab = {
  id: string;
  kind: "terminal";
  projectId: string;
  title: string;
};

export type FileTab = {
  id: string;
  kind: "file";
  projectId: string;
  /** Project-relative posix path. */
  path: string;
  title: string;
};

export type DiffMode = "uncommitted" | "staged" | "unstaged";

export type DiffTab = {
  id: string;
  kind: "diff";
  projectId: string;
  path: string;
  title: string;
  mode: DiffMode;
};

export type Tab = ChatTab | TerminalTab | FileTab | DiffTab;
export type SplitOrientation = "horizontal" | "vertical";
export type SplitDropDirection = "left" | "right" | "top" | "bottom";

export type TabPane = {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
};

export type TabPaneLayoutLeaf = {
  type: "leaf";
  id: string;
};

export type TabPaneLayoutSplit = {
  type: "split";
  id: string;
  orientation: SplitOrientation;
  children: [TabPaneLayoutNode, TabPaneLayoutNode];
};

export type TabPaneLayoutNode = TabPaneLayoutLeaf | TabPaneLayoutSplit;

export type TabPaneLeaf = TabPane & {
  type: "leaf";
};

export type TabPaneSplit = {
  type: "split";
  id: string;
  orientation: SplitOrientation;
  children: [TabPaneNode, TabPaneNode];
};

export type TabPaneNode = TabPaneLeaf | TabPaneSplit;

type TabsById = Record<string, Tab>;
type PanesById = Record<string, TabPane>;

const TABS_STORAGE_KEY = "gspot.tabs.byId.v2";
const TAB_PANES_STORAGE_KEY = "gspot.tabs.panesById.v2";
const TAB_LAYOUT_STORAGE_KEY = "gspot.tabs.layout.v2";
const ACTIVE_PANE_STORAGE_KEY = "gspot.tabs.activePane.v2";
const MAIN_PANE_ID = "main";

const initialPane: TabPane = {
  id: MAIN_PANE_ID,
  tabIds: [],
  activeTabId: null,
};

function jsonStorage<T>(storageKey: string) {
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

export const tabsByIdAtom = atomWithStorage<TabsById>(
  TABS_STORAGE_KEY,
  {},
  jsonStorage<TabsById>(TABS_STORAGE_KEY),
  { getOnInit: true },
);

export const tabPanesByIdAtom = atomWithStorage<PanesById>(
  TAB_PANES_STORAGE_KEY,
  { [MAIN_PANE_ID]: initialPane },
  jsonStorage<PanesById>(TAB_PANES_STORAGE_KEY),
  { getOnInit: true },
);

export const tabPaneLayoutAtom = atomWithStorage<TabPaneLayoutNode>(
  TAB_LAYOUT_STORAGE_KEY,
  { type: "leaf", id: MAIN_PANE_ID },
  jsonStorage<TabPaneLayoutNode>(TAB_LAYOUT_STORAGE_KEY),
  { getOnInit: true },
);

export const activePaneIdAtom = atomWithStorage<string>(
  ACTIVE_PANE_STORAGE_KEY,
  MAIN_PANE_ID,
  jsonStorage<string>(ACTIVE_PANE_STORAGE_KEY),
  { getOnInit: true },
);

export const tabsAtom = atom<Tab[]>((get) => Object.values(get(tabsByIdAtom)));

export const tabLayoutAtom = atom<TabPaneNode>((get) =>
  hydratePaneLayout(get(tabPaneLayoutAtom), get(tabPanesByIdAtom)),
);

export const activeTabIdAtom = atom<string | null>((get) => {
  const panes = get(tabPanesByIdAtom);
  const activePane = panes[get(activePaneIdAtom)];
  return activePane ? paneActiveTab(activePane) : null;
});

export const activeTabAtom = atom<Tab | null>((get) => {
  const activeId = get(activeTabIdAtom);
  const tabsById = get(tabsByIdAtom);
  if (activeId) return tabsById[activeId] ?? null;
  return Object.values(tabsById)[0] ?? null;
});

export const highlightedTabIdsAtom = atom<Record<string, number>>({});

function chatTabId(projectId: string, chatId: string) {
  return `chat:${projectId}:${chatId}`;
}

function newTerminalTabId() {
  return `terminal:${crypto.randomUUID()}`;
}

function fileTabId(projectId: string, path: string) {
  return `file:${projectId}:${path}`;
}

function diffTabId(projectId: string, path: string) {
  // Mode is mutable on a single diff tab - not part of identity.
  return `diff:${projectId}:${path}`;
}

function basename(p: string) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

export function useTabs() {
  return useAtomValue(tabsAtom);
}

export function useActiveTab() {
  return useAtomValue(activeTabAtom);
}

export function useTabLayout() {
  return useAtomValue(tabLayoutAtom);
}

export function useActivePaneId() {
  return useAtomValue(activePaneIdAtom);
}

export function useHighlightedTabIds() {
  return useAtomValue(highlightedTabIdsAtom);
}

type OpenChatOptions = {
  focusMessageId?: string;
  searchText?: string;
  paneId?: string;
  replaceTabId?: string;
};

function newPaneId() {
  return `pane:${crypto.randomUUID()}`;
}

function newSplitId() {
  return `split:${crypto.randomUUID()}`;
}

function newDraftChatTabId() {
  return `draft-chat:${crypto.randomUUID()}`;
}

function createPane(id = newPaneId()): TabPane {
  return { id, tabIds: [], activeTabId: null };
}

function paneActiveTab(pane: TabPane) {
  return pane.activeTabId && pane.tabIds.includes(pane.activeTabId)
    ? pane.activeTabId
    : (pane.tabIds.at(-1) ?? null);
}

function hydratePaneLayout(
  node: TabPaneLayoutNode,
  panesById: Readonly<PanesById>,
): TabPaneNode {
  if (node.type === "leaf") {
    const pane = panesById[node.id] ?? createPane(node.id);
    return { type: "leaf", ...pane, activeTabId: paneActiveTab(pane) };
  }
  return {
    ...node,
    children: [
      hydratePaneLayout(node.children[0], panesById),
      hydratePaneLayout(node.children[1], panesById),
    ],
  };
}

function findLeafIdByPaneId(
  node: TabPaneLayoutNode,
  paneId: string,
): string | null {
  if (node.type === "leaf") return node.id === paneId ? node.id : null;
  return (
    findLeafIdByPaneId(node.children[0], paneId) ??
    findLeafIdByPaneId(node.children[1], paneId)
  );
}

function firstLeafId(node: TabPaneLayoutNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.children[0]);
}

function leafCount(node: TabPaneLayoutNode): number {
  if (node.type === "leaf") return 1;
  return leafCount(node.children[0]) + leafCount(node.children[1]);
}

function layoutLeafIds(node: TabPaneLayoutNode, ids: string[] = []) {
  if (node.type === "leaf") {
    ids.push(node.id);
    return ids;
  }
  layoutLeafIds(node.children[0], ids);
  layoutLeafIds(node.children[1], ids);
  return ids;
}

function findPaneIdByTabId(panesById: Readonly<PanesById>, tabId: string) {
  return (
    Object.values(panesById).find((pane) => pane.tabIds.includes(tabId))?.id ?? null
  );
}

function ensurePane(panesById: PanesById, paneId: string): TabPane {
  return panesById[paneId] ?? createPane(paneId);
}

function addTabToPane(
  panesById: PanesById,
  layout: TabPaneLayoutNode,
  paneId: string,
  tabId: string,
) {
  const existingPaneId = findPaneIdByTabId(panesById, tabId);
  const targetPaneId =
    existingPaneId ?? findLeafIdByPaneId(layout, paneId) ?? firstLeafId(layout);
  const targetPane = ensurePane(panesById, targetPaneId);
  const tabIds = targetPane.tabIds.includes(tabId)
    ? targetPane.tabIds
    : [...targetPane.tabIds, tabId];

  return {
    panesById: {
      ...panesById,
      [targetPaneId]: {
        ...targetPane,
        tabIds,
        activeTabId: tabId,
      },
    },
    paneId: targetPaneId,
  };
}

function updatePane(
  panesById: PanesById,
  paneId: string,
  updater: (pane: TabPane) => TabPane,
) {
  const pane = ensurePane(panesById, paneId);
  return { ...panesById, [paneId]: updater(pane) };
}

function removeTabFromPane(pane: TabPane, tabId: string): TabPane {
  const idx = pane.tabIds.indexOf(tabId);
  if (idx === -1) return pane;
  const tabIds = pane.tabIds.filter((id) => id !== tabId);
  const activeTabId =
    pane.activeTabId === tabId
      ? (tabIds[idx] ?? tabIds[idx - 1] ?? null)
      : pane.activeTabId;
  return { ...pane, tabIds, activeTabId };
}

function removeTabFromPanes(panesById: PanesById, tabId: string): PanesById {
  const paneId = findPaneIdByTabId(panesById, tabId);
  if (!paneId) return panesById;
  return updatePane(panesById, paneId, (pane) => removeTabFromPane(pane, tabId));
}

function replaceTabInPanes(
  panesById: PanesById,
  fromTabId: string,
  toTabId: string,
) {
  const paneId = findPaneIdByTabId(panesById, fromTabId);
  if (!paneId) return { panesById, paneId: null };
  return {
    panesById: updatePane(panesById, paneId, (pane) => {
      const tabIds = pane.tabIds
        .map((id) => (id === fromTabId ? toTabId : id))
        .filter((id, index, all) => all.indexOf(id) === index);
      return {
        ...pane,
        tabIds,
        activeTabId: pane.activeTabId === fromTabId ? toTabId : pane.activeTabId,
      };
    }),
    paneId,
  };
}

function addTabsToPane(
  panesById: PanesById,
  paneId: string,
  tabIds: readonly string[],
  activeTabId: string | null,
) {
  const target = ensurePane(panesById, paneId);
  const incoming = tabIds.filter((id) => !target.tabIds.includes(id));
  return {
    ...panesById,
    [paneId]: {
      ...target,
      tabIds: [...target.tabIds, ...incoming],
      activeTabId: activeTabId ?? target.activeTabId ?? target.tabIds.at(-1) ?? null,
    },
  };
}

function removePane(panesById: PanesById, paneId: string) {
  const next = { ...panesById };
  delete next[paneId];
  return next;
}

function collapsePane(
  node: TabPaneLayoutNode,
  panesById: PanesById,
  paneId: string,
): {
  node: TabPaneLayoutNode;
  panesById: PanesById;
  closed: boolean;
  activePaneId: string | null;
} {
  if (node.type === "leaf") {
    return { node, panesById, closed: false, activePaneId: null };
  }

  const [first, second] = node.children;
  if (first.type === "leaf" && first.id === paneId) {
    const targetPaneId = firstLeafId(second);
    const closedPane = ensurePane(panesById, first.id);
    return {
      node: second,
      panesById: addTabsToPane(
        removePane(panesById, first.id),
        targetPaneId,
        closedPane.tabIds,
        paneActiveTab(closedPane),
      ),
      closed: true,
      activePaneId: targetPaneId,
    };
  }
  if (second.type === "leaf" && second.id === paneId) {
    const targetPaneId = firstLeafId(first);
    const closedPane = ensurePane(panesById, second.id);
    return {
      node: first,
      panesById: addTabsToPane(
        removePane(panesById, second.id),
        targetPaneId,
        closedPane.tabIds,
        paneActiveTab(closedPane),
      ),
      closed: true,
      activePaneId: targetPaneId,
    };
  }

  const collapsedFirst = collapsePane(first, panesById, paneId);
  if (collapsedFirst.closed) {
    return {
      ...collapsedFirst,
      node: { ...node, children: [collapsedFirst.node, second] },
    };
  }

  const collapsedSecond = collapsePane(second, panesById, paneId);
  if (collapsedSecond.closed) {
    return {
      ...collapsedSecond,
      node: { ...node, children: [first, collapsedSecond.node] },
    };
  }

  return { node, panesById, closed: false, activePaneId: null };
}

function splitLeaf(
  node: TabPaneLayoutNode,
  panesById: PanesById,
  paneId: string,
  orientation: SplitOrientation,
): { node: TabPaneLayoutNode; panesById: PanesById; createdPaneId: string | null } {
  if (node.type === "leaf") {
    if (node.id !== paneId) return { node, panesById, createdPaneId: null };
    const newPane = createPane();
    const pane = ensurePane(panesById, paneId);
    const activeTabId = paneActiveTab(pane);
    const shouldMoveActiveTab = activeTabId && pane.tabIds.length > 1;
    const currentPane = shouldMoveActiveTab
      ? removeTabFromPane(pane, activeTabId)
      : pane;
    const siblingPane = shouldMoveActiveTab
      ? { ...newPane, tabIds: [activeTabId], activeTabId }
      : newPane;

    return {
      node: {
        type: "split",
        id: newSplitId(),
        orientation,
        children: [{ type: "leaf", id: paneId }, { type: "leaf", id: siblingPane.id }],
      },
      panesById: {
        ...panesById,
        [paneId]: currentPane,
        [siblingPane.id]: siblingPane,
      },
      createdPaneId: siblingPane.id,
    };
  }
  const first = splitLeaf(node.children[0], panesById, paneId, orientation);
  if (first.createdPaneId) {
    return {
      node: { ...node, children: [first.node, node.children[1]] },
      panesById: first.panesById,
      createdPaneId: first.createdPaneId,
    };
  }
  const second = splitLeaf(node.children[1], panesById, paneId, orientation);
  return {
    node: { ...node, children: [node.children[0], second.node] },
    panesById: second.panesById,
    createdPaneId: second.createdPaneId,
  };
}

function replaceLeafWithSplit(
  node: TabPaneLayoutNode,
  paneId: string,
  droppedPaneId: string,
  orientation: SplitOrientation,
  direction: SplitDropDirection,
): TabPaneLayoutNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) return node;
    const droppedFirst = direction === "left" || direction === "top";
    const droppedLeaf: TabPaneLayoutLeaf = { type: "leaf", id: droppedPaneId };
    return {
      type: "split",
      id: newSplitId(),
      orientation,
      children: droppedFirst ? [droppedLeaf, node] : [node, droppedLeaf],
    };
  }
  return {
    ...node,
    children: [
      replaceLeafWithSplit(
        node.children[0],
        paneId,
        droppedPaneId,
        orientation,
        direction,
      ),
      replaceLeafWithSplit(
        node.children[1],
        paneId,
        droppedPaneId,
        orientation,
        direction,
      ),
    ],
  };
}

function moveTabInPanes(
  panesById: PanesById,
  layout: TabPaneLayoutNode,
  tabId: string,
  targetPaneId: string,
  targetIndex?: number,
): { panesById: PanesById; moved: boolean; targetPaneId: string | null } {
  const sourcePaneId = findPaneIdByTabId(panesById, tabId);
  const targetExists = findLeafIdByPaneId(layout, targetPaneId);
  if (!sourcePaneId || !targetExists) {
    return { panesById, moved: false, targetPaneId: null };
  }

  let next = updatePane(panesById, sourcePaneId, (pane) =>
    removeTabFromPane(pane, tabId),
  );

  next = updatePane(next, targetPaneId, (pane) => {
    const tabIds = pane.tabIds.filter((id) => id !== tabId);
    const insertIndex =
      targetIndex === undefined
        ? tabIds.length
        : Math.max(0, Math.min(targetIndex, tabIds.length));
    return {
      ...pane,
      tabIds: [
        ...tabIds.slice(0, insertIndex),
        tabId,
        ...tabIds.slice(insertIndex),
      ],
      activeTabId: tabId,
    };
  });

  return { panesById: next, moved: true, targetPaneId };
}

function splitTabIntoPane(
  node: TabPaneLayoutNode,
  panesById: PanesById,
  tabId: string,
  targetPaneId: string,
  direction: SplitDropDirection,
): {
  node: TabPaneLayoutNode;
  panesById: PanesById;
  moved: boolean;
  targetPaneId: string | null;
} {
  const sourcePaneId = findPaneIdByTabId(panesById, tabId);
  const targetExists = findLeafIdByPaneId(node, targetPaneId);
  if (!sourcePaneId || !targetExists) {
    return { node, panesById, moved: false, targetPaneId: null };
  }
  const sourcePane = ensurePane(panesById, sourcePaneId);
  if (sourcePaneId === targetPaneId && sourcePane.tabIds.length <= 1) {
    return { node, panesById, moved: false, targetPaneId: null };
  }

  const orientation =
    direction === "left" || direction === "right" ? "horizontal" : "vertical";
  const droppedPane = { ...createPane(), tabIds: [tabId], activeTabId: tabId };
  const panesWithoutTab = updatePane(panesById, sourcePaneId, (pane) =>
    removeTabFromPane(pane, tabId),
  );

  return {
    node: replaceLeafWithSplit(node, targetPaneId, droppedPane.id, orientation, direction),
    panesById: { ...panesWithoutTab, [droppedPane.id]: droppedPane },
    moved: true,
    targetPaneId: droppedPane.id,
  };
}

function deleteUnassignedPanes(
  panesById: PanesById,
  layout: TabPaneLayoutNode,
): PanesById {
  const livePaneIds = new Set(layoutLeafIds(layout));
  const next: PanesById = {};
  for (const paneId of livePaneIds) {
    next[paneId] = ensurePane(panesById, paneId);
  }
  return next;
}

export function useOpenChatTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (projectId: string, chatId: string, title: string, options?: OpenChatOptions) => {
      const id = chatTabId(projectId, chatId);
      setTabsById((prev) => {
        const existing = prev[id];
        if (existing?.kind === "chat") {
          return {
            ...prev,
            [id]: {
              ...existing,
              title,
              focusMessageId: options?.focusMessageId ?? existing.focusMessageId,
              searchText: options?.searchText ?? existing.searchText,
            },
          };
        }
        const chatTab: ChatTab = {
          id,
          kind: "chat",
          projectId,
          chatId,
          title,
          focusMessageId: options?.focusMessageId,
          searchText: options?.searchText,
        };
        const next = {
          ...prev,
          [id]: chatTab,
        };
        if (options?.replaceTabId && options.replaceTabId !== id) {
          delete next[options.replaceTabId];
        }
        return next;
      });
      setPanesById((prev) => {
        if (options?.replaceTabId && options.replaceTabId !== id) {
          const replaced = replaceTabInPanes(prev, options.replaceTabId, id);
          if (replaced.paneId) {
            setActivePane(replaced.paneId);
            return replaced.panesById;
          }
        }
        const targetPaneId =
          findPaneIdByTabId(prev, id) ?? options?.paneId ?? activePaneId;
        const next = addTabToPane(prev, layout, targetPaneId, id);
        setActivePane(next.paneId);
        return next.panesById;
      });
    },
    [activePaneId, layout, setActivePane, setPanesById, setTabsById],
  );
}

export function useOpenDraftChatTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (projectId: string, title = "New Chat", options?: { paneId?: string }) => {
      const id = newDraftChatTabId();
      setTabsById((prev) => ({
        ...prev,
        [id]: {
          id,
          kind: "chat",
          projectId,
          chatId: null,
          title,
        },
      }));
      setPanesById((prev) => {
        const next = addTabToPane(prev, layout, options?.paneId ?? activePaneId, id);
        setActivePane(next.paneId);
        return next.panesById;
      });
      return id;
    },
    [activePaneId, layout, setActivePane, setPanesById, setTabsById],
  );
}

export function useOpenTerminalTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (projectId: string, title = "Terminal", paneId = activePaneId) => {
      const id = newTerminalTabId();
      setTabsById((prev) => ({
        ...prev,
        [id]: { id, kind: "terminal", projectId, title },
      }));
      setPanesById((prev) => {
        const next = addTabToPane(prev, layout, paneId, id);
        setActivePane(next.paneId);
        return next.panesById;
      });
      return id;
    },
    [activePaneId, layout, setActivePane, setPanesById, setTabsById],
  );
}

export function useOpenFileTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (projectId: string, filePath: string) => {
      const id = fileTabId(projectId, filePath);
      const title = basename(filePath);
      setTabsById((prev) =>
        prev[id]
          ? prev
          : { ...prev, [id]: { id, kind: "file", projectId, path: filePath, title } },
      );
      setPanesById((prev) => {
        const next = addTabToPane(prev, layout, activePaneId, id);
        setActivePane(next.paneId);
        return next.panesById;
      });
      return id;
    },
    [activePaneId, layout, setActivePane, setPanesById, setTabsById],
  );
}

export function useOpenDiffTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (projectId: string, filePath: string, mode: DiffMode = "uncommitted") => {
      const id = diffTabId(projectId, filePath);
      const title = basename(filePath);
      setTabsById((prev) => {
        const existing = prev[id];
        if (existing?.kind === "diff") {
          if (existing.mode === mode) return prev;
          return { ...prev, [id]: { ...existing, mode } };
        }
        return {
          ...prev,
          [id]: { id, kind: "diff", projectId, path: filePath, title, mode },
        };
      });
      setPanesById((prev) => {
        const next = addTabToPane(prev, layout, activePaneId, id);
        setActivePane(next.paneId);
        return next.panesById;
      });
      return id;
    },
    [activePaneId, layout, setActivePane, setPanesById, setTabsById],
  );
}

export function useUpdateDiffMode() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  return useCallback(
    (id: string, mode: DiffMode) => {
      setTabsById((prev) => {
        const tab = prev[id];
        if (tab?.kind !== "diff") return prev;
        return { ...prev, [id]: { ...tab, mode } };
      });
    },
    [setTabsById],
  );
}

export function useCloseTab() {
  const setTabsById = useSetAtom(tabsByIdAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setHighlightedTabIds = useSetAtom(highlightedTabIdsAtom);
  return useCallback(
    (id: string) => {
      setPanesById((prev) => removeTabFromPanes(prev, id));
      setHighlightedTabIds((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTabsById((prev) => {
        const closing = prev[id];
        if (!closing) return prev;
        if (closing.kind === "terminal") {
          disposeTerminalSession(closing.id);
        }
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setHighlightedTabIds, setPanesById, setTabsById],
  );
}

export function useCloseActiveTab() {
  const closeTab = useCloseTab();
  const activeTabId = useAtomValue(activeTabIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const closePane = useClosePane();
  return useCallback(() => {
    if (activeTabId) {
      closeTab(activeTabId);
      return;
    }
    closePane(activePaneId);
  }, [activePaneId, activeTabId, closePane, closeTab]);
}

export function useFocusTab() {
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const setHighlightedTabIds = useSetAtom(highlightedTabIdsAtom);
  return useCallback(
    (id: string) => {
      setHighlightedTabIds((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPanesById((prev) => {
        const paneId = findPaneIdByTabId(prev, id);
        if (!paneId) return prev;
        setActivePane(paneId);
        return updatePane(prev, paneId, (pane) => ({ ...pane, activeTabId: id }));
      });
    },
    [setActivePane, setHighlightedTabIds, setPanesById],
  );
}

export function useHighlightChatTab() {
  const tabsById = useAtomValue(tabsByIdAtom);
  const setHighlightedTabIds = useSetAtom(highlightedTabIdsAtom);
  return useCallback(
    (chatId: string) => {
      const tab = Object.values(tabsById).find(
        (candidate) => candidate.kind === "chat" && candidate.chatId === chatId,
      );
      if (!tab) return;
      setHighlightedTabIds((prev) => ({ ...prev, [tab.id]: Date.now() }));
    },
    [setHighlightedTabIds, tabsById],
  );
}

export function useFocusPane() {
  const setActivePane = useSetAtom(activePaneIdAtom);
  return useCallback(
    (paneId: string) => {
      setActivePane(paneId);
    },
    [setActivePane],
  );
}

export function useSplitActivePane() {
  const activePaneId = useAtomValue(activePaneIdAtom);
  const panesById = useAtomValue(tabPanesByIdAtom);
  const setLayout = useSetAtom(tabPaneLayoutAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  return useCallback(
    (orientation: SplitOrientation, paneId = activePaneId) => {
      setLayout((prev) => {
        const result = splitLeaf(prev, panesById, paneId, orientation);
        if (result.createdPaneId) {
          setPanesById(result.panesById);
          setActivePane(result.createdPaneId);
        }
        return result.node;
      });
    },
    [activePaneId, panesById, setActivePane, setLayout, setPanesById],
  );
}

export function useClosePane() {
  const panesById = useAtomValue(tabPanesByIdAtom);
  const setLayout = useSetAtom(tabPaneLayoutAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  return useCallback(
    (paneId: string) => {
      setLayout((prev) => {
        if (leafCount(prev) <= 1) return prev;
        const result = collapsePane(prev, panesById, paneId);
        if (!result.closed) return prev;
        setPanesById(result.panesById);
        if (result.activePaneId) setActivePane(result.activePaneId);
        return result.node;
      });
    },
    [panesById, setActivePane, setLayout, setPanesById],
  );
}

export function useMoveTab() {
  const layout = useAtomValue(tabPaneLayoutAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  return useCallback(
    (tabId: string, targetPaneId: string, targetIndex?: number) => {
      setPanesById((prev) => {
        const result = moveTabInPanes(prev, layout, tabId, targetPaneId, targetIndex);
        if (result.moved && result.targetPaneId) {
          setActivePane(result.targetPaneId);
        }
        return result.panesById;
      });
    },
    [layout, setActivePane, setPanesById],
  );
}

export function useSplitTabToPane() {
  const panesById = useAtomValue(tabPanesByIdAtom);
  const setLayout = useSetAtom(tabPaneLayoutAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  return useCallback(
    (tabId: string, targetPaneId: string, direction: SplitDropDirection) => {
      setLayout((prev) => {
        const result = splitTabIntoPane(prev, panesById, tabId, targetPaneId, direction);
        if (result.moved && result.targetPaneId) {
          setPanesById(result.panesById);
          setActivePane(result.targetPaneId);
        }
        return result.node;
      });
    },
    [panesById, setActivePane, setLayout, setPanesById],
  );
}

export function useNormalizeTabLayout() {
  const setLayout = useSetAtom(tabPaneLayoutAtom);
  const setPanesById = useSetAtom(tabPanesByIdAtom);
  const setActivePane = useSetAtom(activePaneIdAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  return useCallback(
    (tabs: readonly Tab[]) => {
      const liveIds = new Set(tabs.map((tab) => tab.id));
      setLayout((layout) => {
        const leafIds = layoutLeafIds(layout);
        setPanesById((prev) => {
          let next = deleteUnassignedPanes(prev, layout);
          const assignedIds = new Set<string>();
          for (const paneId of leafIds) {
            const pane = ensurePane(next, paneId);
            const tabIds = pane.tabIds.filter((id) => liveIds.has(id));
            for (const id of tabIds) assignedIds.add(id);
            next = {
              ...next,
              [paneId]: {
                ...pane,
                tabIds,
                activeTabId:
                  pane.activeTabId && liveIds.has(pane.activeTabId)
                    ? pane.activeTabId
                    : (tabIds.at(-1) ?? null),
              },
            };
          }

          const targetPaneId = leafIds.includes(activePaneId)
            ? activePaneId
            : (leafIds[0] ?? MAIN_PANE_ID);
          const missing = tabs
            .filter((tab) => !assignedIds.has(tab.id))
            .map((tab) => tab.id);
          if (missing.length > 0) {
            const target = ensurePane(next, targetPaneId);
            next = {
              ...next,
              [targetPaneId]: {
                ...target,
                tabIds: [...target.tabIds, ...missing],
                activeTabId: target.activeTabId ?? missing[0] ?? null,
              },
            };
          }

          setActivePane(targetPaneId);
          return next;
        });
        return layout;
      });
    },
    [activePaneId, setActivePane, setLayout, setPanesById],
  );
}
