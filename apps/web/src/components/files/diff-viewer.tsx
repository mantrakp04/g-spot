import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { Spinner } from "@g-spot/ui/components/spinner";
import { DiffEditor } from "@monaco-editor/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import type * as monaco from "monaco-editor";

import { useTheme } from "@/components/theme-provider";
import { gitKeys } from "@/lib/query-keys";
import { type DiffMode, useUpdateDiffMode } from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

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

export function DiffViewer({ tabId, projectId, path, mode, active }: DiffViewerProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = useMonacoTheme(resolvedTheme, active);
  const setMode = useUpdateDiffMode();
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
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
