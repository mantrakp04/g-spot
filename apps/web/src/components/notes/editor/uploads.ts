import { EditorView } from "@codemirror/view";

import { env } from "@g-spot/env/web";

/**
 * Paste + drop file uploads. Uploads to the existing `/api/files/upload`
 * endpoint (content-addressed dedup, returns `{ fileId, url, mimeType }`),
 * then inserts at the caret. Images render inline via a markdown image,
 * everything else as a plain link so the embed-widget plugin still has
 * something to lay out.
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
  const res = await fetch(`${env.VITE_SERVER_URL}/api/files/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as UploadResponse;
}

function fileToMarkdown(upload: UploadResponse): string {
  const safeName = upload.filename.replace(/[\[\]]/g, "");
  if (upload.mimeType.startsWith("image/")) {
    // Vault-style embed — resolved at render time by the server attachments
    // route, so the note doesn't bake in a server URL.
    return `![[${safeName}]]`;
  }
  // Non-images still need a real URL since the embed widget only renders
  // images. Leave the server URL in for now; if you change hosts, these
  // links break (same trade-off as before).
  const url = `${env.VITE_SERVER_URL}${upload.url}`;
  return `[${safeName}](${url})`;
}

async function insertUploads(view: EditorView, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const batchId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const placeholders = files
    .map((f, index) => `![[uploading ${f.name} ${batchId}-${index}…]]`)
    .join("\n");
  const insertPos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: insertPos, insert: placeholders },
    selection: { anchor: insertPos + placeholders.length },
  });

  let replaced = "";
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      replaced += `[upload-failed: ${file.name} exceeds 25 MB]\n`;
      continue;
    }
    try {
      const upload = await uploadFile(file);
      replaced += `${fileToMarkdown(upload)}\n`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      replaced += `[upload-failed: ${file.name} (${msg})]\n`;
    }
  }
  // Trim trailing newline to match what we inserted as separator.
  replaced = replaced.replace(/\n$/, "");

  // Replace the placeholder block with the resolved markdown.
  const doc = view.state.doc.toString();
  const placeholderIdx = doc.indexOf(placeholders);
  if (placeholderIdx === -1) return; // user edited it away — give up gracefully.
  view.dispatch({
    changes: {
      from: placeholderIdx,
      to: placeholderIdx + placeholders.length,
      insert: replaced,
    },
    selection: { anchor: placeholderIdx + replaced.length },
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
