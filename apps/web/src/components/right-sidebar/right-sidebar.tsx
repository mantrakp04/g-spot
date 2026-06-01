import { cn } from "@g-spot/ui/lib/utils";
import { useAtom } from "jotai";
import { FileText, GitBranch, Search, TerminalSquare } from "lucide-react";

import { TerminalView } from "@/components/terminal/terminal-view";
import {
  rightSidebarCollapsedAtom,
  rightSidebarTabAtom,
  type RightSidebarTab,
} from "@/lib/sidebars-store";
import { useOpenDiffTab, useOpenFileTab } from "@/lib/tabs-store";

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
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

export function RightSidebar({ projectId, onOpenSearch }: RightSidebarProps) {
  const [collapsed, setCollapsed] = useAtom(rightSidebarCollapsedAtom);
  const [activeTab, setActiveTab] = useAtom(rightSidebarTabAtom);
  const openFile = useOpenFileTab();
  const openDiff = useOpenDiffTab();

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
    <div className="flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-background">
      <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-muted/30">
        <div className="no-scrollbar flex flex-1 items-stretch overflow-x-auto">
          {TAB_DEFS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {tab.label}
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
          onClick={onOpenSearch}
          className="flex shrink-0 items-center justify-center px-3 text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
          aria-label="Search files"
          title="Search files (⌘P)"
        >
          <Search className="size-3.5" />
        </button>
      </div>

      {/* Keep all three panels mounted so terminal PTY + tree expansion state
          survives tab switches. */}
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
        <div
          className={cn(
            "min-h-0 flex-1 flex-col",
            activeTab === "terminal" ? "flex" : "hidden",
          )}
        >
          <TerminalView
            projectId={projectId}
            tabId={`right-sidebar-terminal:${projectId}`}
            active={activeTab === "terminal"}
          />
        </div>
      </div>
    </div>
  );
}
