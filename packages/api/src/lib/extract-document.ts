/**
 * Server-side document text extraction. Runs once when a user message is
 * converted to pi-ai content and the result is persisted, so extraction
 * cost is paid on upload, not on every turn.
 *
 * Supported: PDF (pdfjs-dist), DOCX (mammoth), XLSX/XLS (xlsx → CSV),
 * PPTX (jszip + naive XML scan for <a:t> text runs + notesSlides).
 */
export type DocumentKind = "pdf" | "docx" | "xlsx" | "pptx";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function detectDocumentKind(
  mediaType: string | undefined,
  filename: string | undefined,
): DocumentKind | null {
  const mt = mediaType?.toLowerCase() ?? "";
  const name = filename?.toLowerCase() ?? "";

  if (mt === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mt === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (mt === PPTX_MIME || name.endsWith(".pptx")) return "pptx";
  if (XLSX_MIMES.has(mt) || name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return "xlsx";
  }
  return null;
}

export async function extractDocumentText(
  buffer: ArrayBuffer,
  kind: DocumentKind,
  filename: string,
): Promise<string> {
  switch (kind) {
    case "pdf":
      return extractPdf(buffer, filename);
    case "docx":
      return extractDocx(buffer, filename);
    case "xlsx":
      return extractExcel(buffer, filename);
    case "pptx":
      return extractPptx(buffer, filename);
  }
}

async function extractPdf(buffer: ArrayBuffer, filename: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  let out = `<pdf filename="${filename}">`;
  for (let i = 0; i < pages.length; i++) {
    out += `\n<page number="${i + 1}">\n${pages[i]?.trim() ?? ""}\n</page>`;
  }
  out += "\n</pdf>";
  return out;
}

async function extractDocx(buffer: ArrayBuffer, filename: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(buffer),
  });
  return `<docx filename="${filename}">\n${value.trim()}\n</docx>`;
}

async function extractExcel(buffer: ArrayBuffer, filename: string): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  let out = `<excel filename="${filename}">`;
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    out += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csv}\n</sheet>`;
  }
  out += "\n</excel>";
  return out;
}

async function extractPptx(buffer: ArrayBuffer, filename: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const extractRuns = (xml: string) => {
    const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
    if (!matches) return [];
    return matches
      .map((m) => m.match(/<a:t[^>]*>([^<]+)<\/a:t>/)?.[1] ?? "")
      .filter((s) => s.trim().length > 0);
  };

  const byNumber = (prefix: string, suffix: string) =>
    Object.keys(zip.files)
      .filter((n) => new RegExp(`^${prefix}\\d+${suffix}$`).test(n))
      .sort((a, b) => {
        const numA = Number.parseInt(
          a.match(new RegExp(`(\\d+)${suffix}$`))?.[1] ?? "0",
          10,
        );
        const numB = Number.parseInt(
          b.match(new RegExp(`(\\d+)${suffix}$`))?.[1] ?? "0",
          10,
        );
        return numA - numB;
      });

  let out = `<pptx filename="${filename}">`;
  const slideFiles = byNumber("ppt/slides/slide", "\\.xml");
  for (let i = 0; i < slideFiles.length; i++) {
    const entry = zip.file(slideFiles[i]!);
    if (!entry) continue;
    const runs = extractRuns(await entry.async("text"));
    if (runs.length === 0) continue;
    out += `\n<slide number="${i + 1}">\n${runs.join("\n")}\n</slide>`;
  }

  const notesFiles = byNumber("ppt/notesSlides/notesSlide", "\\.xml");
  if (notesFiles.length > 0) {
    out += "\n<notes>";
    for (const name of notesFiles) {
      const entry = zip.file(name);
      if (!entry) continue;
      const runs = extractRuns(await entry.async("text"));
      if (runs.length === 0) continue;
      const slideNum = name.match(/notesSlide(\d+)\.xml$/)?.[1];
      out += `\n[Slide ${slideNum} notes]: ${runs.join(" ")}`;
    }
    out += "\n</notes>";
  }

  out += "\n</pptx>";
  return out;
}
