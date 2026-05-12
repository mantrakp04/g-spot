import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { Spinner } from "@g-spot/ui/components/spinner";
import { DiffEditor } from "@monaco-editor/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import type * as monaco from "monaco-editor";

import { useTheme } from "@/components/theme-provider";
import { gitKeys } from "@/lib/query-keys";
import { type DiffMode, useUpdateDiffMode } from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

import { DiffHunkActions } from "./diff-hunk-actions";
import {
  buildHunkPatch,
  buildSelectionPatch,
  flagsForAction,
} from "./diff-patch";
import { languageFromPath } from "./language-from-path";
import { buildEditorOptions } from "./monaco-options";
import { MonacoSettingsMenu } from "./monaco-settings-menu";
import { monacoSettingsAtom } from "./monaco-settings-store";
import { useMonacoTheme } from "./monaco-theme";
import "./monaco-bootstrap";

type DiffViewerProps = {
  tabId: string;
  projectId: string;
  path: string;
  mode: DiffMode;
  active: boolean;
};

const MODE_LABEL: Record<DiffMode, string> = {
  uncommitted: "Uncommitted (HEAD → working)",
  staged: "Staged (HEAD → index)",
  unstaged: "Unstaged (index → working)",
};

type WidgetEntry = {
  widget: monaco.editor.IContentWidget;
  root: Root;
  node: HTMLDivElement;
  hunk: monaco.editor.ILineChange;
};

export function DiffViewer({ tabId, projectId, path, mode, active }: DiffViewerProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = useMonacoTheme(resolvedTheme, active);
  const setMode = useUpdateDiffMode();
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const widgetsRef = useRef<Map<string, WidgetEntry>>(new Map());
  const queryClient = useQueryClient();
  const settings = useAtomValue(monacoSettingsAtom);
  const diffEditorOptions = useMemo(
    () =>
      ({
        ...buildEditorOptions(settings),
        renderSideBySide: true,
        readOnly: true,
        originalEditable: false,
        ignoreTrimWhitespace: false,
      }) satisfies monaco.editor.IStandaloneDiffEditorConstructionOptions,
    [settings],
  );

  const handleMount = useCallback((editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;
  }, []);

  const diffQuery = useQuery({
    queryKey: gitKeys.fileDiff(projectId, path, mode),
    queryFn: () => trpcClient.git.fileDiff.query({ projectId, path, mode }),
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  });

  // -------------------------------------------------------------------------
  // Per-hunk action lens — content widgets on the modified editor.
  // Re-attaches on hunk changes (via onDidUpdateDiff) and on selection changes.
  // -------------------------------------------------------------------------
  const refRef = useRef({ projectId, path, mode });
  refRef.current = { projectId, path, mode };

  const cleanupWidgets = useCallback(() => {
    const editor = editorRef.current;
    const modifiedEditor = editor?.getModifiedEditor();
    for (const [, entry] of widgetsRef.current) {
      modifiedEditor?.removeContentWidget(entry.widget);
      // Defer unmount to next microtask to dodge React's "unmount during
      // render" warning when invalidation triggers re-attach.
      const root = entry.root;
      queueMicrotask(() => root.unmount());
    }
    widgetsRef.current.clear();
  }, []);

  const runAction = useCallback(
    async (
      hunk: monaco.editor.ILineChange,
      action: "stage" | "unstage" | "revert",
    ) => {
      const editor = editorRef.current;
      if (!editor) return;
      const original = editor.getOriginalEditor().getModel();
      const modified = editor.getModifiedEditor().getModel();
      if (!original || !modified) return;

      const originalLines = original.getLinesContent();
      const modifiedLines = modified.getLinesContent();

      const sel = editor.getModifiedEditor().getSelection();
      const hasSelection = !!sel && !sel.isEmpty();
      const overlapsHunk =
        hasSelection &&
        sel!.startLineNumber <= hunk.modifiedEndLineNumber &&
        sel!.endLineNumber >= hunk.modifiedStartLineNumber;

      const patch =
        hasSelection && overlapsHunk
          ? buildSelectionPatch({
              path: refRef.current.path,
              hunk,
              originalLines,
              modifiedLines,
              side: "modified",
              selectionStartLine: sel!.startLineNumber,
              selectionEndLine: sel!.endLineNumber,
            })
          : buildHunkPatch({
              path: refRef.current.path,
              hunk,
              originalLines,
              modifiedLines,
            });

      if (!patch) {
        toast.error("Selection contains no changed lines");
        return;
      }

      const flags = flagsForAction(refRef.current.mode, action);
      try {
        await trpcClient.git.applyPatch.mutate({
          projectId: refRef.current.projectId,
          patch,
          ...flags,
        });
        void queryClient.invalidateQueries({
          queryKey: ["git", "changes", refRef.current.projectId],
        });
        void queryClient.invalidateQueries({
          queryKey: gitKeys.fileDiff(
            refRef.current.projectId,
            refRef.current.path,
            refRef.current.mode,
          ),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "git apply failed";
        toast.error(msg);
      }
    },
    [queryClient],
  );

  const rebuildWidgets = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!projectId) {
      cleanupWidgets();
      return;
    }
    const modifiedEditor = editor.getModifiedEditor();
    const changes = editor.getLineChanges();
    if (!changes) {
      cleanupWidgets();
      return;
    }

    const sel = modifiedEditor.getSelection();
    const hasSelectionGlobal = !!sel && !sel.isEmpty();

    const wantedKeys = new Set<string>();
    const modeForRender = refRef.current.mode;

    for (const hunk of changes) {
      const key = `${hunk.originalStartLineNumber}:${hunk.originalEndLineNumber}-${hunk.modifiedStartLineNumber}:${hunk.modifiedEndLineNumber}`;
      wantedKeys.add(key);

      // Anchor on the first modified line; fall back to the line before for
      // pure deletions where modifiedEndLineNumber === 0.
      const anchorLine =
        hunk.modifiedEndLineNumber > 0
          ? hunk.modifiedStartLineNumber
          : Math.max(1, hunk.modifiedStartLineNumber);

      const overlaps =
        hasSelectionGlobal &&
        sel!.startLineNumber <= Math.max(hunk.modifiedEndLineNumber, anchorLine) &&
        sel!.endLineNumber >= hunk.modifiedStartLineNumber;

      let entry = widgetsRef.current.get(key);
      if (!entry) {
        const node = document.createElement("div");
        node.style.zIndex = "5";
        const root = createRoot(node);
        const widget: monaco.editor.IContentWidget = {
          getId: () => `g-spot.diff-hunk-actions.${key}`,
          getDomNode: () => node,
          getPosition: () => ({
            position: { lineNumber: anchorLine, column: 1 },
            preference: [
              // ContentWidgetPositionPreference.ABOVE = 1, BELOW = 2
              1, 2,
            ],
          }),
        };
        modifiedEditor.addContentWidget(widget);
        entry = { widget, root, node, hunk };
        widgetsRef.current.set(key, entry);
      } else {
        entry.hunk = hunk;
      }

      const capturedHunk = entry.hunk;
      entry.root.render(
        <DiffHunkActions
          mode={modeForRender}
          hasSelection={overlaps}
          onAction={(a) => runAction(capturedHunk, a)}
        />,
      );
    }

    // Drop widgets for hunks that no longer exist.
    for (const [key, entry] of widgetsRef.current) {
      if (!wantedKeys.has(key)) {
        modifiedEditor.removeContentWidget(entry.widget);
        const root = entry.root;
        queueMicrotask(() => root.unmount());
        widgetsRef.current.delete(key);
      }
    }
  }, [cleanupWidgets, projectId, runAction]);

  // Wire up Monaco listeners after mount, and rebuild whenever the diff data
  // changes (new file/mode swaps the underlying models).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const disposables: monaco.IDisposable[] = [];

    disposables.push(editor.onDidUpdateDiff(() => rebuildWidgets()));

    let selRaf = 0;
    disposables.push(
      editor.getModifiedEditor().onDidChangeCursorSelection(() => {
        if (selRaf) cancelAnimationFrame(selRaf);
        selRaf = requestAnimationFrame(() => rebuildWidgets());
      }),
    );

    // Initial pass — diff may already be computed.
    rebuildWidgets();

    return () => {
      if (selRaf) cancelAnimationFrame(selRaf);
      for (const d of disposables) d.dispose();
    };
  }, [rebuildWidgets, diffQuery.data]);

  useEffect(() => {
    return () => cleanupWidgets();
  }, [cleanupWidgets]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/20 pl-3 pr-1 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{path}</span>
        <div className="flex items-center gap-1">
          <Select
            value={mode}
            onValueChange={(value) => setMode(tabId, value as DiffMode)}
          >
            <SelectTrigger className="h-6 w-[260px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as DiffMode[]).map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MonacoSettingsMenu />
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <DiffEditor
          original={diffQuery.data?.left ?? ""}
          modified={diffQuery.data?.right ?? ""}
          language={languageFromPath(path)}
          theme={monacoTheme}
          onMount={handleMount}
          options={diffEditorOptions}
          loading={<Spinner />}
        />
      </div>
    </div>
  );
}

export default DiffViewer;
