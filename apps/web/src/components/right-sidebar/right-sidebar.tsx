import { cn } from "@g-spot/ui/lib/utils";
import { useAtom } from "jotai";
import {
  FileText,
  GitBranch,
  PanelRight,
  Search,
} from "lucide-react";

import {
  rightSidebarCollapsedAtom,
  rightSidebarTabAtom,
  type RightSidebarTab,
} from "@/lib/sidebars-store";
import {
  useOpenChangesTab,
  useOpenDiffTab,
  useOpenFileTab,
  useOpenFileTreeTab,
} from "@/lib/tabs-store";

import { focusSurface } from "@/lib/surface-focus";

import { ChangesPanel } from "./changes";
import { FileTree } from "./file-tree";

type RightSidebarProps = {
  projectId: string;
  onOpenSearch: () => void;
};

const TAB_DEFS: Array<{
  id: RightSidebarTab;
  label: string;
  icon: typeof FileText;
}> = [
  { id: "files", label: "All Files", icon: FileText },
  { id: "changes", label: "Changes", icon: GitBranch },
];

export function RightSidebar({ projectId, onOpenSearch }: RightSidebarProps) {
  const [collapsed, setCollapsed] = useAtom(rightSidebarCollapsedAtom);
  const [activeTab, setActiveTab] = useAtom(rightSidebarTabAtom);
  const openFile = useOpenFileTab();
  const openDiff = useOpenDiffTab();
  const openFileTree = useOpenFileTreeTab();
  const openChanges = useOpenChangesTab();

  // Promote the active sidebar view into the main split grid (reuse-or-focus:
  // the open hooks key on a stable per-project id, so an existing pane is
  // refocused rather than duplicated).
  const openActiveViewAsPane = () => {
    const id =
      activeTab === "files" ? openFileTree(projectId) : openChanges(projectId);
    focusSurface(id);
  };

  if (collapsed) {
    return (
      <div className="flex h-full shrink-0 flex-col items-center gap-1 border-l border-border bg-muted/20 py-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Search files"
          title="Search files (⌘P)"
        >
          <Search className="size-4" />
        </button>
        {TAB_DEFS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setCollapsed(false);
              }}
              className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={tab.label}
              title={tab.label}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-l border-t border-border border-t-transparent bg-background">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-muted/30">
        <div className="no-scrollbar flex flex-1 items-stretch overflow-x-auto">
          {TAB_DEFS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                title={tab.label}
                className={cn(
                  "relative grid w-9 place-items-center transition-colors",
                  active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-px bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={openActiveViewAsPane}
          className="grid size-9 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
          aria-label="Open this view as a pane"
          title="Open as pane"
        >
          <PanelRight className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          className="grid size-9 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
          aria-label="Search files"
          title="Search files (⌘P)"
        >
          <Search className="size-3.5" />
        </button>
      </div>

      {/* Keep both panels mounted so tree expansion state survives tab switches. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "min-h-0 flex-1 flex-col",
            activeTab === "files" ? "flex" : "hidden",
          )}
        >
          <FileTree
            projectId={projectId}
            onFileClick={(path) => openFile(projectId, path)}
          />
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 flex-col",
            activeTab === "changes" ? "flex" : "hidden",
          )}
        >
          <ChangesPanel
            projectId={projectId}
            onChangeClick={(path, mode, opts) => {
              if (opts?.openFile) {
                openFile(projectId, path);
                return;
              }
              openDiff(projectId, path, mode);
            }}
          />
        </div>
      </div>
    </div>
  );
}
