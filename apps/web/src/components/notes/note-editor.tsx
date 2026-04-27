import { useEffect, useRef } from "react";

import { EditorView } from "@codemirror/view";

import {
  createInitialState,
  knownNoteTitlesFacet,
  knownTitlesCompartment,
  wikilinkHandlerCompartment,
  wikilinkHandlerFacet,
  type WikilinkClick,
} from "@/components/notes/editor";

interface NoteEditorProps {
  noteId: string;
  initialDoc: string;
  knownTitles: Set<string>;
  onChange: (value: string) => void;
  onWikilinkClick: WikilinkClick;
}

/**
 * Mounts a single CodeMirror 6 instance per note. Switching notes (changing
 * `noteId`) creates a fresh state — a deliberate choice so undo history,
 * scroll, and decoration caches don't bleed between files.
 *
 * The known-titles set and the wikilink click handler live in compartments
 * so the host can update them without rebuilding the editor.
 */
export function NoteEditor({
  noteId,
  initialDoc,
  knownTitles,
  onChange,
  onWikilinkClick,
}: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Stash the latest callbacks in refs so the EditorView can read fresh
  // versions without us having to recreate the editor on every prop change.
  const onChangeRef = useRef(onChange);
  const onWikilinkClickRef = useRef(onWikilinkClick);
  onChangeRef.current = onChange;
  onWikilinkClickRef.current = onWikilinkClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = createInitialState({
      doc: initialDoc,
      knownTitles,
      onChange: (v) => onChangeRef.current(v),
      onWikilinkClick: (title, alias) =>
        onWikilinkClickRef.current(title, alias),
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
    // Recreate per noteId so each note has its own undo history + state.
    // initialDoc/knownTitles/handler updates handled separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Live-update the known titles set without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: knownTitlesCompartment.reconfigure(
        knownNoteTitlesFacet.of(knownTitles),
      ),
    });
  }, [knownTitles]);

  // Update the wikilink handler on prop change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wikilinkHandlerCompartment.reconfigure(
        wikilinkHandlerFacet.of((title, alias) =>
          onWikilinkClickRef.current(title, alias),
        ),
      ),
    });
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
