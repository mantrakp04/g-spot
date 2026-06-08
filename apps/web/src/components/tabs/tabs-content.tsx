import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@g-spot/ui/components/resizable";
import { Spinner } from "@g-spot/ui/components/spinner";
import { cn } from "@g-spot/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import {
  Columns2,
  FileText,
  GitCompare,
  Rows2,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";

import { ChatView } from "@/components/chat/chat-view";
import { TerminalView } from "@/components/terminal/terminal-view";
import { useNewChat } from "@/hooks/use-new-chat";
import { subscribeChatRuntimeFinished } from "@/lib/chat-runtime-statuses";
import { focusSurface } from "@/lib/surface-focus";
import {
  type Tab,
  type TabPaneLeaf,
  type TabPaneNode,
  type SplitDropDirection,
  useActivePaneId,
  useClosePane,
  useCloseTab,
  useFocusPane,
  useFocusTab,
  useHighlightChatTab,
  useHighlightedTabIds,
  useMoveTab,
  useNormalizeTabLayout,
  useOpenTerminalTab,
  useSplitTabToPane,
  useSplitActivePane,
  useTabLayout,
  useTabs,
} from "@/lib/tabs-store";

import { NewTabMenu } from "./new-tab-menu";
import { TabItem } from "./tab-item";

// Monaco is ~5MB — only pull it in when a file or diff tab opens.
const FileEditor = lazy(() => import("@/components/files/file-editor"));
const DiffViewer = lazy(() => import("@/components/files/diff-viewer"));

function MonacoFallback() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}

type TabsContentProps = {
  projectId: string;
};

export function TabsContent({ projectId }: TabsContentProps) {
  const tabs = useTabs();
  const layout = useTabLayout();
  const activePaneId = useActivePaneId();
  const focusPane = useFocusPane();
  const normalizeLayout = useNormalizeTabLayout();
  const moveTab = useMoveTab();
  const splitTabToPane = useSplitTabToPane();
  const openTerminal = useOpenTerminalTab();
  const highlightedTabIds = useHighlightedTabIds();
  const highlightChatTab = useHighlightChatTab();
  const { newChat, isPending: newChatPending } = useNewChat();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const tabsById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );

  useEffect(() => {
    normalizeLayout(tabs);
  }, [normalizeLayout, tabs]);

  useEffect(
    () => subscribeChatRuntimeFinished((chatId) => highlightChatTab(chatId)),
    [highlightChatTab],
  );

  const dragTargets = useMemo(() => collectDragTargets(layout), [layout]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId) return;
      const target = dragTargets.get(overId);
      if (!target) return;
      if (target.type === "split") {
        splitTabToPane(activeId, target.paneId, target.direction);
        return;
      }
      moveTab(activeId, target.paneId, target.index);
    },
    [dragTargets, moveTab, splitTabToPane],
  );

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="flex items-center gap-3 opacity-60">
            <Sparkles className="size-5" />
            <TerminalSquare className="size-5" />
            <FileText className="size-5" />
            <GitCompare className="size-5" />
          </div>
          <NewTabMenu
            onNewChat={() => {
              void newChat(projectId).then(({ id }) => focusSurface(id));
            }}
            onNewTerminal={() => {
              const tabId = openTerminal(projectId);
              focusSurface(tabId);
            }}
            disabled={newChatPending}
          />
          <p className="text-sm">
            Open a chat, terminal, or file from the{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem]">
              +
            </kbd>{" "}
            menu or right sidebar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const pointerCollisions = pointerWithin(args);
        return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
      }}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <TabPaneNodeView
          node={layout}
          projectId={projectId}
          tabsById={tabsById}
          highlightedTabIds={highlightedTabIds}
          activePaneId={activePaneId}
          onFocusPane={focusPane}
        />
      </div>
    </DndContext>
  );
}

type TabDragTarget =
  | {
      type: "move";
      paneId: string;
      index?: number;
    }
  | {
      type: "split";
      paneId: string;
      direction: SplitDropDirection;
    };

const PANE_DROP_ZONES = ["left", "right", "top", "bottom", "center"] as const;
type PaneDropZone = (typeof PANE_DROP_ZONES)[number];

function paneDropId(paneId: string) {
  return `pane-drop:${paneId}`;
}

function paneZoneDropId(paneId: string, zone: PaneDropZone) {
  return `pane-zone:${paneId}:${zone}`;
}

function collectDragTargets(node: TabPaneNode, map = new Map<string, TabDragTarget>()) {
  if (node.type === "leaf") {
    map.set(paneDropId(node.id), { type: "move", paneId: node.id });
    for (const zone of PANE_DROP_ZONES) {
      map.set(
        paneZoneDropId(node.id, zone),
        zone === "center"
          ? { type: "move", paneId: node.id }
          : { type: "split", paneId: node.id, direction: zone },
      );
    }
    node.tabIds.forEach((tabId, index) => {
      map.set(tabId, { type: "move", paneId: node.id, index });
    });
    return map;
  }
  collectDragTargets(node.children[0], map);
  collectDragTargets(node.children[1], map);
  return map;
}

function TabPaneNodeView({
  node,
  projectId,
  tabsById,
  highlightedTabIds,
  activePaneId,
  onFocusPane,
}: {
  node: TabPaneNode;
  projectId: string;
  tabsById: ReadonlyMap<string, Tab>;
  highlightedTabIds: Readonly<Record<string, number>>;
  activePaneId: string;
  onFocusPane: (paneId: string) => void;
}) {
  if (node.type === "leaf") {
    return (
      <TabPaneLeafView
        leaf={node}
        projectId={projectId}
        tabsById={tabsById}
        highlightedTabIds={highlightedTabIds}
        activePaneId={activePaneId}
        onFocusPane={onFocusPane}
      />
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.orientation}
      className="min-h-0 min-w-0 flex-1"
    >
      <ResizablePanel
        id={`${node.id}:0`}
        minSize={15}
        className="flex min-h-0 min-w-0"
      >
        <TabPaneNodeView
          node={node.children[0]}
          projectId={projectId}
          tabsById={tabsById}
          highlightedTabIds={highlightedTabIds}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id={`${node.id}:1`}
        minSize={15}
        className="flex min-h-0 min-w-0"
      >
        <TabPaneNodeView
          node={node.children[1]}
          projectId={projectId}
          tabsById={tabsById}
          highlightedTabIds={highlightedTabIds}
          activePaneId={activePaneId}
          onFocusPane={onFocusPane}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function TabPaneLeafView({
  leaf,
  projectId,
  tabsById,
  highlightedTabIds,
  activePaneId,
  onFocusPane,
}: {
  leaf: TabPaneLeaf;
  projectId: string;
  tabsById: ReadonlyMap<string, Tab>;
  highlightedTabIds: Readonly<Record<string, number>>;
  activePaneId: string;
  onFocusPane: (paneId: string) => void;
}) {
  const activeTabId =
    leaf.activeTabId && leaf.tabIds.includes(leaf.activeTabId)
      ? leaf.activeTabId
      : (leaf.tabIds.at(-1) ?? null);
  const paneActive = leaf.id === activePaneId;
  const paneHighlighted = leaf.tabIds.some((tabId) => tabId in highlightedTabIds);

  return (
    <div
      onMouseDownCapture={() => onFocusPane(leaf.id)}
      data-active-pane={paneActive}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border border-transparent bg-background",
        paneHighlighted &&
          "border-primary/60 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18),0_0_22px_hsl(var(--primary)/0.16)]",
        paneActive && "border-primary/70",
      )}
    >
      <PaneTabStrip
        leaf={leaf}
        projectId={projectId}
        activeTabId={activeTabId}
        paneActive={paneActive}
        tabsById={tabsById}
        highlightedTabIds={highlightedTabIds}
        onFocusPane={onFocusPane}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <PaneDropZones paneId={leaf.id} />
        {!activeTabId ? (
          <PaneEmptyState
            paneId={leaf.id}
            projectId={projectId}
            onFocus={() => onFocusPane(leaf.id)}
          />
        ) : (
          leaf.tabIds.map((tabId) => {
            const tab = tabsById.get(tabId);
            if (!tab) return null;
            const active = tab.id === activeTabId;
            return <TabSurface key={tab.id} tab={tab} active={active} />;
          })
        )}
      </div>
    </div>
  );
}

function PaneDropZones({ paneId }: { paneId: string }) {
  const left = useDroppable({ id: paneZoneDropId(paneId, "left") });
  const right = useDroppable({ id: paneZoneDropId(paneId, "right") });
  const top = useDroppable({ id: paneZoneDropId(paneId, "top") });
  const bottom = useDroppable({ id: paneZoneDropId(paneId, "bottom") });
  const center = useDroppable({ id: paneZoneDropId(paneId, "center") });
  const activeZone =
    (left.isOver && "left") ||
    (right.isOver && "right") ||
    (top.isOver && "top") ||
    (bottom.isOver && "bottom") ||
    (center.isOver && "center") ||
    null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <PaneDropZoneRef zone="left" droppable={left} />
      <PaneDropZoneRef zone="right" droppable={right} />
      <PaneDropZoneRef zone="top" droppable={top} />
      <PaneDropZoneRef zone="bottom" droppable={bottom} />
      <PaneDropZoneRef zone="center" droppable={center} />
      {activeZone && <PaneDropPreview zone={activeZone} />}
    </div>
  );
}

function PaneDropZoneRef({
  zone,
  droppable,
}: {
  zone: PaneDropZone;
  droppable: ReturnType<typeof useDroppable>;
}) {
  return (
    <div
      ref={droppable.setNodeRef}
      data-pane-drop-zone={zone}
      className={cn("absolute", paneDropZoneClass(zone))}
    />
  );
}

function PaneDropPreview({ zone }: { zone: PaneDropZone }) {
  return (
    <>
      <div className="absolute inset-1 rounded-sm border border-sky-400/80 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]" />
      <div
        data-pane-drop-preview={zone}
        className={cn(
          "absolute rounded-sm border border-sky-300/80 bg-sky-400/20 shadow-[0_0_24px_rgba(56,189,248,0.22)]",
          paneDropPreviewClass(zone),
        )}
      />
    </>
  );
}

function paneDropZoneClass(zone: PaneDropZone) {
  switch (zone) {
    case "left":
      return "inset-y-0 left-0 w-1/4";
    case "right":
      return "inset-y-0 right-0 w-1/4";
    case "top":
      return "left-1/4 right-1/4 top-0 h-1/4";
    case "bottom":
      return "bottom-0 left-1/4 right-1/4 h-1/4";
    case "center":
      return "inset-x-1/4 inset-y-1/4";
  }
}

function paneDropPreviewClass(zone: PaneDropZone) {
  switch (zone) {
    case "left":
      return "inset-y-2 left-2 w-[34%]";
    case "right":
      return "inset-y-2 right-2 w-[34%]";
    case "top":
      return "left-2 right-2 top-2 h-[34%]";
    case "bottom":
      return "bottom-2 left-2 right-2 h-[34%]";
    case "center":
      return "inset-2";
  }
}

function PaneTabStrip({
  leaf,
  projectId,
  activeTabId,
  paneActive,
  tabsById,
  highlightedTabIds,
  onFocusPane,
}: {
  leaf: TabPaneLeaf;
  projectId: string;
  activeTabId: string | null;
  paneActive: boolean;
  tabsById: ReadonlyMap<string, Tab>;
  highlightedTabIds: Readonly<Record<string, number>>;
  onFocusPane: (paneId: string) => void;
}) {
  const droppable = useDroppable({ id: paneDropId(leaf.id) });
  const focusTab = useFocusTab();
  const closeTab = useCloseTab();
  const closePane = useClosePane();
  const openTerminal = useOpenTerminalTab();
  const splitActivePane = useSplitActivePane();
  const { newChat, isPending: newChatPending } = useNewChat();
  const navigate = useNavigate();

  const handleNewChat = useCallback(async () => {
    onFocusPane(leaf.id);
    const { id } = await newChat(projectId, { paneId: leaf.id });
    focusSurface(id);
  }, [leaf.id, newChat, onFocusPane, projectId]);

  const handleNewTerminal = useCallback(() => {
    onFocusPane(leaf.id);
    const tabId = openTerminal(projectId, "Terminal", leaf.id);
    focusSurface(tabId);
  }, [leaf.id, onFocusPane, openTerminal, projectId]);

  const handleFocus = useCallback(
    (tab: Tab) => {
      onFocusPane(leaf.id);
      focusTab(tab.id);
      focusSurface(tab.id);
      void navigate({
        to: "/agent/$projectId",
        params: { projectId: tab.projectId },
      });
    },
    [focusTab, leaf.id, navigate, onFocusPane],
  );

  const handleSplit = useCallback(
    (orientation: "horizontal" | "vertical") => {
      onFocusPane(leaf.id);
      splitActivePane(orientation, leaf.id);
    },
    [leaf.id, onFocusPane, splitActivePane],
  );

  const handleClosePane = useCallback(() => {
    closePane(leaf.id);
  }, [closePane, leaf.id]);

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-stretch border-b border-sidebar-border bg-muted/20",
        paneActive && "bg-primary/[0.04]",
      )}
    >
      <div className="no-scrollbar flex min-w-12 flex-1 items-stretch overflow-x-auto">
        <SortableContext
          items={leaf.tabIds}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={droppable.setNodeRef}
            className={cn(
              "flex min-w-0 flex-1 items-stretch",
              droppable.isOver && "bg-primary/10",
            )}
          >
            {leaf.tabIds.map((tabId) => {
              const tab = tabsById.get(tabId);
              if (!tab) return null;
              return (
                <SortableTabItem
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  highlighted={tab.id in highlightedTabIds}
                  onFocus={() => handleFocus(tab)}
                  onClose={() => closeTab(tab.id)}
                />
              );
            })}
          </div>
        </SortableContext>
      </div>
      <div className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden border-l border-sidebar-border px-1">
        <NewTabMenu
          onNewChat={() => void handleNewChat()}
          onNewTerminal={handleNewTerminal}
          disabled={newChatPending}
        />
        <button
          type="button"
          onClick={() => handleSplit("horizontal")}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Split pane left/right"
          title="Split pane left/right"
        >
          <Columns2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleSplit("vertical")}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Split pane top/bottom"
          title="Split pane top/bottom"
        >
          <Rows2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClosePane}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close pane"
          title="Close pane"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SortableTabItem({
  tab,
  active,
  highlighted,
  onFocus,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  highlighted: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });
  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("touch-none", isDragging && "z-50 opacity-50")}
      {...attributes}
      {...listeners}
    >
      <TabItem
        tab={tab}
        active={active}
        highlighted={highlighted}
        onFocus={onFocus}
        onClose={onClose}
      />
    </div>
  );
}

function PaneEmptyState({
  paneId,
  projectId,
  onFocus,
}: {
  paneId: string;
  projectId: string;
  onFocus: () => void;
}) {
  const openTerminal = useOpenTerminalTab();
  const { newChat, isPending } = useNewChat();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <NewTabMenu
          onNewChat={() => {
            onFocus();
            void newChat(projectId, { paneId }).then(({ id }) => focusSurface(id));
          }}
          onNewTerminal={() => {
            onFocus();
            const tabId = openTerminal(projectId, "Terminal", paneId);
            focusSurface(tabId);
          }}
          disabled={isPending}
        />
        <span className="text-xs">Open a surface in this pane</span>
      </div>
    </div>
  );
}

function TabSurface({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <div
      data-active={active}
      className={cn(
        "min-h-0 min-w-0 flex-1 flex-col",
        active ? "flex" : "hidden",
      )}
      aria-hidden={!active}
    >
      {tab.kind === "chat" && (
        <ChatView
          tabId={tab.id}
          projectId={tab.projectId}
          chatId={tab.chatId}
          focusMessageId={tab.focusMessageId}
          searchText={tab.searchText}
          active={active}
        />
      )}
      {tab.kind === "terminal" && (
        <TerminalView projectId={tab.projectId} tabId={tab.id} active={active} />
      )}
      {tab.kind === "file" && (
        <Suspense fallback={<MonacoFallback />}>
          <FileEditor projectId={tab.projectId} path={tab.path} active={active} />
        </Suspense>
      )}
      {tab.kind === "diff" && (
        <Suspense fallback={<MonacoFallback />}>
          <DiffViewer
            tabId={tab.id}
            projectId={tab.projectId}
            path={tab.path}
            mode={tab.mode}
            active={active}
          />
        </Suspense>
      )}
    </div>
  );
}
