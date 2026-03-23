export const DOCUMENT_FILE_FORMATS = ["docx", "pdf", "xlsx", "txt", "md"] as const;

export type DocumentFileFormat = (typeof DOCUMENT_FILE_FORMATS)[number];

export function isDocumentFileFormat(value: unknown): value is DocumentFileFormat {
  return (
    typeof value === "string" &&
    (DOCUMENT_FILE_FORMATS as readonly string[]).includes(value)
  );
}

export function getDocumentFormatLabel(
  format: DocumentFileFormat,
  language: "zh" | "en",
) {
  const labels: Record<DocumentFileFormat, { zh: string; en: string }> = {
    pdf: { zh: "PDF", en: "PDF" },
    xlsx: { zh: "Excel", en: "Excel" },
    docx: { zh: "Word", en: "Word" },
    txt: { zh: "TXT", en: "TXT" },
    md: { zh: "Markdown", en: "Markdown" },
  };

  return labels[format][language];
}
