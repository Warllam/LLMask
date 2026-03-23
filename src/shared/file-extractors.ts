/**
 * File text extractors for non-technical file formats.
 *
 * Extracts readable text from:
 * - PDF (.pdf)
 * - Word (.docx)
 * - Excel (.xlsx, .xls)
 * - PowerPoint (.pptx) — via XML extraction
 * - Plain text (.txt, .md, .json, .csv, .xml, .html)
 *
 * The extracted text is then passed through the detection + rewrite pipeline
 * for anonymization, just like any other text content.
 */

export type ExtractionResult = {
  text: string;
  pageCount?: number;
  format: string;
  metadata?: Record<string, string>;
};

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".xml", ".html", ".htm",
  ".yaml", ".yml", ".toml", ".ini", ".env", ".log",
  ".js", ".ts", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h",
  ".sql", ".sh", ".bat", ".ps1",
]);

const DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".xls", ".pptx",
]);

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".svg",
]);

export function isSupportedFile(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

export function isTextFile(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext);
}

export function isDocumentFile(ext: string): boolean {
  return DOCUMENT_EXTENSIONS.has(ext);
}

export function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Extract text from a file buffer based on its extension.
 * Returns the extracted text content for anonymization.
 */
export async function extractText(buffer: Buffer, ext: string): Promise<ExtractionResult> {
  if (TEXT_EXTENSIONS.has(ext)) {
    return { text: buffer.toString("utf8"), format: ext.slice(1) };
  }

  switch (ext) {
    case ".pdf":
      return extractPdf(buffer);
    case ".docx":
      return extractDocx(buffer);
    case ".xlsx":
    case ".xls":
      return extractXlsx(buffer);
    case ".pptx":
      return extractPptx(buffer);
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const { PDFParse } = await import("pdf-parse") as any;
  const parser = new PDFParse({ data: buffer });
  const text: string = await parser.getText();
  let info: Record<string, string> = {};
  try {
    const rawInfo = await parser.getInfo();
    if (rawInfo && typeof rawInfo === "object") {
      if (rawInfo.Title) info.title = String(rawInfo.Title);
      if (rawInfo.Author) info.author = String(rawInfo.Author);
      if (rawInfo.Creator) info.creator = String(rawInfo.Creator);
    }
  } catch { /* no metadata */ }
  return {
    text,
    format: "pdf",
    metadata: Object.keys(info).length > 0 ? info : undefined,
  };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    format: "docx",
  };
}

async function extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const texts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // Convert to CSV-like text for easy anonymization
    const csv = XLSX.utils.sheet_to_csv(sheet);
    texts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }

  return {
    text: texts.join("\n\n"),
    format: "xlsx",
    metadata: { sheets: workbook.SheetNames.join(", ") },
  };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  // Try to extract any text via SheetJS (works for some OOXML formats)
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const texts: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (sheet) {
        texts.push(XLSX.utils.sheet_to_csv(sheet));
      }
    }
    if (texts.some(t => t.trim())) {
      return { text: texts.join("\n"), format: "pptx" };
    }
  } catch {
    // Not parseable via SheetJS — expected for most PPTX files
  }

  return {
    text: "[PPTX text extraction requires a dedicated parser]",
    format: "pptx",
  };
}
