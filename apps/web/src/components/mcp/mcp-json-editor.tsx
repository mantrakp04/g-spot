import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { noteEditorHighlightStyle } from "@/components/notes/editor/highlight-style";
import { noteEditorTheme } from "@/components/notes/editor/theme";

interface McpJsonEditorProps {
  /** Initial document contents. The editor reuses one CodeMirror instance and
   * only resets when this changes between mounts; see `key` prop on the parent
   * to force a fresh state if you need it (e.g. switching between scopes). */
  initialDoc: string;
  onChange: (value: string) => void;
}

export function McpJsonEditor({ initialDoc, onChange }: McpJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        drawSelection(),
        bracketMatching(),
        lineNumbers(),
        EditorView.lineWrapping,
        json(),
        syntaxHighlighting(noteEditorHighlightStyle),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        noteEditorTheme,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We deliberately ignore changes to `initialDoc` after mount — the editor
    // is the source of truth once it's open. To reset, remount with a new
    // React `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-auto" />;
}
