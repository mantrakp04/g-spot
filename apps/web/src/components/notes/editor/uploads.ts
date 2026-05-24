import { EditorView } from "@codemirror/view";

import { serverPath } from "@/utils/server-url";

/**
 * Paste + drop file uploads. Uploads to the existing `/api/files/upload`
 * endpoint (content-addressed dedup, returns `{ fileId, url, mimeType }`),
 * then inserts at the caret using the file-id-keyed embed syntax
 * `![[file:<fileId>|<filename>]]`. The id is the canonical reference so
 * duplicate filenames (e.g. every macOS screenshot pastes as `image.png`)
 * never collide. The embed widget in `embeds.ts` resolves it back to a
 * URL at render time — no server hostname is baked into the note.
 *
 * Cap: 25 MB per file. We hand-fail rather than chunk — for bigger files
 * the user should use the file-attachments flow elsewhere.
 */

const MAX_BYTES = 25 * 1024 * 1024;

interface UploadResponse {
  fileId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(serverPath("/api/files/upload"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as UploadResponse;
}

function fileToMarkdown(upload: UploadResponse): string {
  // Strip the wiki-embed delimiters from the display name. `|` is the
  // separator between id and label, `[`/`]` close the embed, and `\n`
  // would split the embed across lines. Everything else is fine.
  const safeName = upload.filename.replace(/[\[\]|\n]/g, "").trim() || "file";
  return `![[file:${upload.fileId}|${safeName}]]`;
}

async function insertUploads(view: EditorView, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const batchId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // The placeholder deliberately contains a `[` so it doesn't match the
  // wikilink-embed regex in `embeds.ts` (which excludes `[` from the
  // filename character class). If the regex matched, the embed widget would
  // try to render a real <img> pointing at `…/attachments/uploading%20…` and
  // the user would see a broken image any time their caret left the
  // placeholder range — e.g. after Cmd+A then right arrow. Keeping the
  // placeholder out of the regex means it just renders as plain text
  // regardless of where the caret is.
  const items = files.map(
    (f, index) => `[uploading ${f.name} (${batchId}-${index})…]`,
  );
  // The "body" is the substring we'll later locate and replace. Newlines
  // around it are layout padding, not part of the placeholder identity.
  const body = items.join("\n");

  // Pad the placeholder so the resolved embed sits on its own line — the
  // block-level image widget needs that, and the trailing newline doubles as
  // a clean spot for the caret to land on (past the embed range so the
  // widget renders).
  const range = view.state.selection.main;
  const doc = view.state.doc;
  const charBefore =
    range.from > 0 ? doc.sliceString(range.from - 1, range.from) : "\n";
  const charAfter =
    range.to < doc.length ? doc.sliceString(range.to, range.to + 1) : "";
  const leading = charBefore === "\n" ? "" : "\n";
  const trailing = charAfter === "\n" ? "" : "\n";
  const insert = leading + body + trailing;

  // Park the caret on the line *after* the placeholder. This is where the
  // user will land once the image renders, so we put them there up front —
  // no jump when the upload resolves, and they can start typing immediately.
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
  });

  let resolved = "";
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      resolved += `[upload-failed: ${file.name} exceeds 25 MB]\n`;
      continue;
    }
    try {
      const upload = await uploadFile(file);
      resolved += `${fileToMarkdown(upload)}\n`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      resolved += `[upload-failed: ${file.name} (${msg})]\n`;
    }
  }
  // Trim trailing newline to match what we inserted as separator.
  resolved = resolved.replace(/\n$/, "");

  // Locate the placeholder body — the user may have inserted/deleted text
  // around it while the upload was in flight, so we can't trust the original
  // offset. The body contains a unique batch id, so `indexOf` is enough.
  const docStr = view.state.doc.toString();
  const bodyIdx = docStr.indexOf(body);
  if (bodyIdx === -1) return; // user edited it away — give up gracefully.
  const bodyEnd = bodyIdx + body.length;

  // Default: omit `selection` so CodeMirror auto-maps the caret through the
  // change. That preserves the user's position whether they stayed put or
  // moved elsewhere mid-upload.
  //
  // The one case auto-mapping handles awkwardly is when the caret is
  // *strictly inside* the placeholder body (the user clicked into it to
  // edit). After the replacement, that position would map into the resolved
  // embed range, which suppresses the image widget. Push the caret past the
  // resolved embed and its trailing newline in that case so the image
  // renders.
  const caret = view.state.selection.main.head;
  const caretStrictlyInBody = caret > bodyIdx && caret < bodyEnd;

  view.dispatch({
    changes: { from: bodyIdx, to: bodyEnd, insert: resolved },
    ...(caretStrictlyInBody
      ? { selection: { anchor: bodyIdx + resolved.length + 1 } }
      : {}),
  });
}

function collectFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  // `items` is preferred — it surfaces clipboard images that aren't in `files`.
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  if (files.length === 0 && dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) files.push(f);
  }
  return files;
}

export const uploadHandlers = EditorView.domEventHandlers({
  paste(event, view) {
    const files = collectFilesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return false;
    event.preventDefault();
    void insertUploads(view, files);
    return true;
  },
  drop(event, view) {
    const files = collectFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return false;
    event.preventDefault();
    // Move the caret to the drop location before inserting so the upload
    // lands where the user pointed, not where they last typed.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null) {
      view.dispatch({ selection: { anchor: pos } });
    }
    void insertUploads(view, files);
    return true;
  },
  dragover(event) {
    // Required so `drop` actually fires on the editor's content area.
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
    }
    return false;
  },
});
