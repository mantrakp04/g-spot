import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import { serverPath } from "@/utils/server-url";

/**
 * Embed widgets for the note editor:
 *
 *   `![[file:<id>|<name>]]`   — file-id embed (canonical for paste/drop
 *                                uploads). Renders as an inline image when
 *                                the filename has an image extension; as a
 *                                clickable file pill otherwise.
 *   `![[<filename>]]`         — legacy filename embed (resolved server-side
 *                                via `/api/notes/attachments/:filename`,
 *                                most-recent-wins). Kept for backward compat.
 *   `![alt](url)`             — standard markdown image. URL is used verbatim.
 *
 * The file-id form is preferred because filenames collide constantly in
 * practice (every macOS clipboard image is named `image.png`).
 */

const FILE_BY_ID_BASE = serverPath("/api/files/");
const ATTACHMENT_BY_NAME_BASE = serverPath("/api/notes/attachments/");

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|heif|tiff?)$/i;

function isImageName(name: string): boolean {
  return IMAGE_EXT_RE.test(name);
}

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

/**
 * Generic file embed for non-image uploads — a clickable card with the
 * filename. Click opens the file in a new tab; the server streams it
 * with the right content-type and `inline` disposition.
 */
class FileEmbedWidget extends WidgetType {
  constructor(readonly href: string, readonly name: string) {
    super();
  }
  eq(other: FileEmbedWidget): boolean {
    return other.href === this.href && other.name === this.name;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-file-embed-widget";
    const link = document.createElement("a");
    link.href = this.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "cm-file-embed-link";
    const icon = document.createElement("span");
    icon.className = "cm-file-embed-icon";
    icon.textContent = "📎";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-file-embed-name";
    label.textContent = this.name;
    link.appendChild(icon);
    link.appendChild(label);
    wrap.appendChild(link);
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
const FILE_ID_PREFIX = "file:";

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
    const target = m[1].trim();
    const alias = m[2]?.trim();

    let widget: WidgetType;
    if (target.startsWith(FILE_ID_PREFIX)) {
      // `file:<id>` — id is unique, alias is the original filename.
      const fileId = target.slice(FILE_ID_PREFIX.length);
      const name = alias ?? fileId;
      const src = `${FILE_BY_ID_BASE}${encodeURIComponent(fileId)}`;
      widget = isImageName(name)
        ? new ImageWidget(src, name)
        : new FileEmbedWidget(src, name);
    } else {
      // Legacy `![[filename]]` — filename-based lookup, most-recent-wins.
      const src = `${ATTACHMENT_BY_NAME_BASE}${encodeURIComponent(target)}`;
      const alt = alias ?? target;
      widget = isImageName(target)
        ? new ImageWidget(src, alt)
        : new FileEmbedWidget(src, alt);
    }
    ranges.push(
      Decoration.replace({ widget, block: true }).range(from, to),
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
