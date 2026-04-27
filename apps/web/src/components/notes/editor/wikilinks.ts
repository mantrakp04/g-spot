import type { EditorState, Range } from "@codemirror/state";
import { Facet, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

/**
 * Plain-regex `[[Target|Display]]` decoration. Renders as a clickable link
 * that calls into the host React app via the `wikilinkHandler` facet. Marks
 * the link as unresolved when the target title is not in the known-titles
 * set so users can see dangling refs visually (Obsidian's red links).
 */

export type WikilinkClick = (title: string, alias: string | null) => void;

export const wikilinkHandlerFacet = Facet.define<WikilinkClick, WikilinkClick | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

export const knownNoteTitlesFacet = Facet.define<Set<string>, Set<string>>({
  combine: (values) => values[values.length - 1] ?? new Set(),
});

const WIKILINK_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

class WikilinkWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly alias: string | null,
    readonly resolved: boolean,
  ) {
    super();
  }
  eq(other: WikilinkWidget): boolean {
    return (
      other.title === this.title &&
      other.alias === this.alias &&
      other.resolved === this.resolved
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.resolved ? "cm-wikilink" : "cm-wikilink-unresolved";
    span.textContent = this.alias ?? this.title;
    span.dataset.wikilinkTitle = this.title;
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const handler = view.state.facet(wikilinkHandlerFacet);
      handler?.(this.title, this.alias);
    });
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function isPositionInActiveLine(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    const targetLine = state.doc.lineAt(from).number;
    if (targetLine >= fromLine && targetLine <= toLine) return true;
    // also active if cursor is inside the range itself
    if (range.from >= from && range.to <= to) return true;
  }
  return false;
}

function buildDecorations(state: EditorState): DecorationSet {
  const known = state.facet(knownNoteTitlesFacet);
  const ranges: Array<Range<Decoration>> = [];
  const text = state.doc.toString();
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    const start = match.index;
    if (start > 0 && text[start - 1] === "!") continue;
    const end = start + match[0].length;
    const title = match[1].trim();
    const alias = match[2]?.trim() ?? null;
    const resolved = known.has(title);
    if (isPositionInActiveLine(state, start, end)) {
      // Active: leave raw text but add a class so it's still styled.
      ranges.push(
        Decoration.mark({
          class: resolved ? "cm-wikilink" : "cm-wikilink-unresolved",
          attributes: { "data-wikilink-title": title },
        }).range(start, end),
      );
      continue;
    }
    ranges.push(
      Decoration.replace({ widget: new WikilinkWidget(title, alias, resolved) }).range(
        start,
        end,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

export const wikilinksField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
