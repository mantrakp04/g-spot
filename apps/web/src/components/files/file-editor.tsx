import { Spinner } from "@g-spot/ui/components/spinner";
import { Editor } from "@monaco-editor/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as monaco from "monaco-editor";
import { toast } from "sonner";

import { useTheme } from "@/components/theme-provider";
import { fsKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

import { languageFromPath } from "./language-from-path";
import "./monaco-bootstrap";
import { buildEditorOptions } from "./monaco-options";
import { MonacoSettingsMenu } from "./monaco-settings-menu";
import { monacoSettingsAtom } from "./monaco-settings-store";
import { useMonacoTheme } from "./monaco-theme";

type FileEditorProps = {
  projectId: string;
  path: string;
  active: boolean;
};

const AUTOSAVE_DEBOUNCE_MS = 600;

type SaveStatus = "saved" | "dirty" | "saving";

/**
 * Monaco file editor with autosave. The buffer is uncontrolled — Monaco owns
 * its own state, we only hand it `defaultValue` once and listen via onChange.
 * Passing `value` on every keystroke causes Monaco to re-apply the buffer and
 * makes typing visibly laggy.
 *
 * The component is keyed by tab id upstream, so switching files remounts and
 * re-seeds defaultValue from the fresh server payload.
 */
export function FileEditor({ projectId, path, active }: FileEditorProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = useMonacoTheme(resolvedTheme, active);
  const settings = useAtomValue(monacoSettingsAtom);
  const editorOptions = useMemo(
    () =>
      ({
        ...buildEditorOptions(settings),
        // The file editor carries no diagnostics or decorations, so its
        // overview ruler is an always-empty canvas that still repaints on
        // scroll. Drop it. (The diff editor keeps its ruler — it shows change
        // markers there.)
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
      }) satisfies monaco.editor.IStandaloneEditorConstructionOptions,
    [settings],
  );
  const fileQuery = useQuery({
    queryKey: fsKeys.read(projectId, path),
    queryFn: () => trpcClient.fs.read.query({ projectId, path }),
    staleTime: 5_000,
  });

  const writeMutation = useMutation({
    mutationFn: (content: string) =>
      trpcClient.fs.write.mutate({ projectId, path, content }),
  });

  const valueRef = useRef<string>("");
  const lastSavedRef = useRef<string>("");
  const debounceRef = useRef<number | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeDisposableRef = useRef<monaco.IDisposable | null>(null);
  const statusRef = useRef<SaveStatus>("saved");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [mountedEditor, setMountedEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const disposeEditorListeners = useCallback(() => {
    changeDisposableRef.current?.dispose();
    changeDisposableRef.current = null;
  }, []);

  // Seed both refs once when the file first loads. After that the buffer is
  // owned by Monaco and we never write back into it.
  useEffect(() => {
    if (fileQuery.data && lastSavedRef.current === "" && valueRef.current === "") {
      valueRef.current = fileQuery.data.content;
      lastSavedRef.current = fileQuery.data.content;
    }
  }, [fileQuery.data]);

  useEffect(() => {
    return () => {
      cancelPendingSave();
      disposeEditorListeners();
    };
  }, [cancelPendingSave, disposeEditorListeners]);

  const setSaveStatus = useCallback((next: SaveStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  const scheduleSave = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (statusRef.current !== "saving") {
      setSaveStatus("dirty");
    }
    if (debounceRef.current !== null) {
      cancelPendingSave();
    }
    debounceRef.current = window.setTimeout(() => {
      const mountedEditor = editorRef.current;
      if (!mountedEditor) return;
      const snapshot = mountedEditor.getValue();
      valueRef.current = snapshot;
      if (snapshot === lastSavedRef.current) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      writeMutation.mutate(snapshot, {
        onSuccess: () => {
          lastSavedRef.current = snapshot;
          const latest = editorRef.current?.getValue() ?? snapshot;
          valueRef.current = latest;
          setSaveStatus(latest === snapshot ? "saved" : "dirty");
        },
        onError: (err) => {
          setSaveStatus("dirty");
          toast.error(
            `Failed to save ${path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [cancelPendingSave, path, setSaveStatus, writeMutation]);

  const handleMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
      setMountedEditor(editor);
    },
    [],
  );

  useEffect(() => {
    if (!mountedEditor) return;
    changeDisposableRef.current?.dispose();
    changeDisposableRef.current =
      mountedEditor.onDidChangeModelContent(scheduleSave);
  }, [mountedEditor, scheduleSave]);

  useEffect(() => {
    if (!active || !mountedEditor) return;
    const frame = window.requestAnimationFrame(() => mountedEditor.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active, mountedEditor]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [path]);

  if (fileQuery.isLoading || !fileQuery.data) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (fileQuery.error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Could not open <span className="font-mono">{path}</span>:{" "}
          {fileQuery.error instanceof Error
            ? fileQuery.error.message
            : String(fileQuery.error)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-6 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/20 pl-3 pr-1 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{path}</span>
        <div className="flex items-center gap-2">
          <span>
            {status === "saving"
              ? "Saving…"
              : status === "dirty"
                ? "Unsaved"
                : "Saved"}
          </span>
          <MonacoSettingsMenu />
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <Editor
          defaultValue={fileQuery.data.content}
          defaultLanguage={languageFromPath(path)}
          theme={monacoTheme}
          onMount={handleMount}
          options={editorOptions}
          loading={<Spinner />}
        />
      </div>
    </div>
  );
}

export default FileEditor;
