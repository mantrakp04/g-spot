import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import { env } from "@g-spot/env/web";

/**
 * `![[image.png]]` and standard `![alt](url)` image embed widgets.
 *
 * Vault-style `![[name]]` embeds resolve via the server's
 * `/api/notes/attachments/:filename` endpoint, which looks up the most
 * recent upload with that filename. Standard `![alt](url)` embeds use the
 * URL verbatim.
 */

const ATTACHMENT_BASE = `${env.VITE_SERVER_URL}/api/notes/attachments/`;

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-image-widget";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-hr-widget";
    return el;
  }
}

function isCursorInside(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from >= from && range.to <= to) return true;
    if (range.from <= from && range.to >= to) return true;
  }
  return false;
}

const WIKI_EMBED = /!\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;
const STD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HR_LINE = /^\s*(?:---|\*\*\*|___)\s*$/;

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  const text = state.doc.toString();
  const occupied: Array<[number, number]> = [];
  const overlaps = (from: number, to: number) =>
    occupied.some(([a, b]) => from < b && to > a);

  let m: RegExpExecArray | null;
  WIKI_EMBED.lastIndex = 0;
  while ((m = WIKI_EMBED.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    occupied.push([from, to]);
    if (isCursorInside(state, from, to)) continue;
    const filename = m[1].trim();
    const src = `${ATTACHMENT_BASE}${encodeURIComponent(filename)}`;
    const alt = (m[2] ?? m[1]).trim();
    ranges.push(
      Decoration.replace({ widget: new ImageWidget(src, alt), block: true }).range(
        from,
        to,
      ),
    );
  }

  STD_IMAGE.lastIndex = 0;
  while ((m = STD_IMAGE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (overlaps(from, to)) continue;
    if (isCursorInside(state, from, to)) continue;
    ranges.push(
      Decoration.replace({
        widget: new ImageWidget(m[2], m[1] || ""),
        block: true,
      }).range(from, to),
    );
  }

  // Horizontal rule lines.
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (!HR_LINE.test(line.text)) continue;
    if (isCursorInside(state, line.from, line.to)) continue;
    ranges.push(
      Decoration.replace({ widget: new HRWidget(), block: true }).range(
        line.from,
        line.to,
      ),
    );
  }

  return Decoration.set(ranges, true);
}

export const embedsField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
