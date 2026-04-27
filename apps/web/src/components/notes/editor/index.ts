import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";

import { noteAutocompletion } from "./autocomplete";
import { embedsField } from "./embeds";
import { noteEditorHighlightStyle } from "./highlight-style";
import { editingLineField, livePreviewField } from "./live-preview";
import { mathField } from "./math";
import { mermaidField } from "./mermaid";
import { tagsField } from "./tags";
import { noteEditorTheme } from "./theme";
import { uploadHandlers } from "./uploads";
import {
  knownNoteTitlesFacet,
  wikilinkHandlerFacet,
  wikilinksField,
  type WikilinkClick,
} from "./wikilinks";

export {
  knownNoteTitlesFacet,
  wikilinkHandlerFacet,
} from "./wikilinks";
export type { WikilinkClick } from "./wikilinks";

export interface CreateNoteEditorOptions {
  doc: string;
  knownTitles: Set<string>;
  onChange: (value: string) => void;
  onWikilinkClick: WikilinkClick;
}

export const knownTitlesCompartment = new Compartment();
export const wikilinkHandlerCompartment = new Compartment();

export function createInitialState(options: CreateNoteEditorOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    extensions: [
      history(),
      drawSelection(),
      bracketMatching(),
      EditorView.lineWrapping,
      markdown({ codeLanguages: languages }),
      syntaxHighlighting(noteEditorHighlightStyle),
      editingLineField,
      livePreviewField,
      wikilinksField,
      tagsField,
      mathField,
      mermaidField,
      embedsField,
      uploadHandlers,
      noteAutocompletion,
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      knownTitlesCompartment.of(knownNoteTitlesFacet.of(options.knownTitles)),
      wikilinkHandlerCompartment.of(wikilinkHandlerFacet.of(options.onWikilinkClick)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          options.onChange(update.state.doc.toString());
        }
      }),
      noteEditorTheme,
    ],
  });
}
