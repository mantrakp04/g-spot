import { Spinner } from "@g-spot/ui/components/spinner";
import { cn } from "@g-spot/ui/lib/utils";
import { FileText, GitCompare, Sparkles, TerminalSquare } from "lucide-react";
import { lazy, Suspense } from "react";

import { ChatView } from "@/components/chat/chat-view";
import { TerminalView } from "@/components/terminal/terminal-view";
import { useActiveTabId, useTabs } from "@/lib/tabs-store";

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

export function TabsContent() {
  const tabs = useTabs();
  const activeTabId = useActiveTabId();

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

  // Keep-alive: every tab stays mounted, but only the active one participates
  // in layout (display:none on the rest). This preserves React state, xterm
  // session, scroll position, draft input, and Monaco state across switches.
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-active={active}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col",
              active ? "flex" : "hidden",
            )}
            aria-hidden={!active}
          >
            {tab.kind === "chat" && (
              <ChatView
                projectId={tab.projectId}
                chatId={tab.chatId}
                focusMessageId={tab.focusMessageId}
                searchText={tab.searchText}
              />
            )}
            {tab.kind === "terminal" && (
              <TerminalView projectId={tab.projectId} tabId={tab.id} active={active} />
            )}
            {tab.kind === "file" && (
              <Suspense fallback={<MonacoFallback />}>
                <FileEditor
                  projectId={tab.projectId}
                  path={tab.path}
                  active={active}
                />
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
      })}
    </div>
  );
}
