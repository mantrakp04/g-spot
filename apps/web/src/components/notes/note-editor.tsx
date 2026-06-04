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
  scrollToText?: string | null;
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
  scrollToText,
  onChange,
  onWikilinkClick,
}: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialStateRef = useRef({
    noteId,
    initialDoc,
    knownTitles,
  });

  if (initialStateRef.current.noteId !== noteId) {
    initialStateRef.current = {
      noteId,
      initialDoc,
      knownTitles,
    };
  }

  // Stash the latest callbacks in refs so the EditorView can read fresh
  // versions without us having to recreate the editor on every prop change.
  const onChangeRef = useRef(onChange);
  const onWikilinkClickRef = useRef(onWikilinkClick);
  onChangeRef.current = onChange;
  onWikilinkClickRef.current = onWikilinkClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const initialState = initialStateRef.current;
    const state = createInitialState({
      doc: initialState.initialDoc,
      knownTitles: initialState.knownTitles,
      onChange: (v) => onChangeRef.current(v),
      onWikilinkClick: (title, alias) =>
        onWikilinkClickRef.current(title, alias),
    });
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;
    // Auto-focus on mount so opening any note drops the cursor straight into
    // the editor — no extra click required to start typing. Place the caret
    // at end of doc so existing content isn't selected/overwritten.
    view.focus();
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end } });
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate per noteId so each note has its own undo history + state.
    // initialDoc is intentionally seeded once per note; knownTitles updates below.
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

  useEffect(() => {
    const view = viewRef.current;
    const target = scrollToText?.trim();
    if (!view || !target) return;
    const index = view.state.doc.toString().toLowerCase().indexOf(target.toLowerCase());
    if (index === -1) return;
    view.dispatch({
      selection: { anchor: index, head: index + target.length },
      effects: EditorView.scrollIntoView(index, { y: "center" }),
    });
    view.focus();
  }, [scrollToText, noteId]);

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
