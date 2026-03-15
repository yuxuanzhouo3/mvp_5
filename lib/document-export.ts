import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  Document as DocxDocument,
  FileChild,
  HeadingLevel,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import {
  DOCUMENT_FILE_FORMATS,
  type DocumentFileFormat,
} from "@/lib/document-formats";

export const GENERATED_FILE_FORMATS = DOCUMENT_FILE_FORMATS;

export type GeneratedFileFormat = DocumentFileFormat;

const generatedDocumentTableSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  columns: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  rows: z.array(z.array(z.string().trim().transform(s => s.slice(0, 200))).min(1).max(8)).max(30),
});

const generatedDocumentSectionSchema = z.object({
  heading: z.string().trim().min(1).transform(s => s.slice(0, 80)),
  paragraphs: z.array(z.string().trim().min(1).transform(s => s.slice(0, 1500))).min(1).max(4),
  bullets: z.array(z.string().trim().min(1).transform(s => s.slice(0, 200))).max(8).default([]),
  table: generatedDocumentTableSchema.optional(),
});

const generatedSpreadsheetSchema = z.object({
  name: z.string().trim().min(1).max(31),
  columns: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  rows: z.array(z.array(z.string().trim().transform(s => s.slice(0, 200))).min(1).max(8)).min(1).max(50),
});

export function getGeneratedDocumentSchema(options?: { requireSpreadsheet?: boolean }) {
  const requireSpreadsheet = options?.requireSpreadsheet ?? false;

  return z.object({
    title: z.string().trim().min(1).transform(s => s.slice(0, 120)),
    summary: z.string().trim().min(1).transform(s => s.slice(0, 1200)),
    sections: z.array(generatedDocumentSectionSchema).min(1).max(8),
    spreadsheets: z.array(generatedSpreadsheetSchema).min(requireSpreadsheet ? 1 : 0).max(3),
  });
}

export const generatedDocumentSchema = getGeneratedDocumentSchema();

export type GeneratedDocument = z.infer<typeof generatedDocumentSchema>;

export type GeneratedExportedFile = {
  format: GeneratedFileFormat;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

const PDF_FONT_OVERRIDE_PATH = process.env.PDF_FONT_PATH;
const PDF_FONT_LATIN_PATH_CANDIDATES = Array.from(
  new Set(
    [
      PDF_FONT_OVERRIDE_PATH,
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/segoeui.ttf",
      "C:/Windows/Fonts/calibri.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "C:/Windows/Fonts/msyh.ttf",
      "C:/Windows/Fonts/simhei.ttf",
      "C:/Windows/Fonts/simsun.ttf",
      "C:/Windows/Fonts/simkai.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
      path.join(
        process.cwd(),
        "node_modules",
        "@fontsource",
        "noto-sans-sc",
        "files",
        "noto-sans-sc-chinese-simplified-400-normal.woff",
      ),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  ),
);
const PDF_FONT_CJK_PATH_CANDIDATES = Array.from(
  new Set(
    [
      PDF_FONT_OVERRIDE_PATH,
      "C:/Windows/Fonts/msyh.ttf",
      "C:/Windows/Fonts/simhei.ttf",
      "C:/Windows/Fonts/simsun.ttf",
      "C:/Windows/Fonts/simkai.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/segoeui.ttf",
      "C:/Windows/Fonts/calibri.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      path.join(
        process.cwd(),
        "node_modules",
        "@fontsource",
        "noto-sans-sc",
        "files",
        "noto-sans-sc-chinese-simplified-400-normal.woff",
      ),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  ),
);

type LoadedPdfFont = {
  bytes: Uint8Array;
  path: string;
};

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const DOCX_DEFAULT_FONT = {
  ascii: "Calibri",
  hAnsi: "Calibri",
  eastAsia: "Microsoft YaHei",
  cs: "Calibri",
} as const;
const EXPORT_CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EXPORT_ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200D\uFEFF]/g;
const EXPORT_PDF_HYPHEN_CHAR_REGEX = /[\u00AD\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const EXPORT_PDF_APOSTROPHE_CHAR_REGEX = /[\u2018-\u201B]/g;
const EXPORT_PDF_QUOTE_CHAR_REGEX = /[\u201C-\u201F]/g;
const EXPORT_PDF_SPACE_CHAR_REGEX = /[\u2000-\u200A\u202F\u205F\u3000]/g;
const EXPORT_PDF_ELLIPSIS_CHAR_REGEX = /\u2026/g;
const WORKSHEET_NAME_FORBIDDEN_CHAR_REGEX = /[:\\/?*\[\]]/g;

const cachedPdfFontMap = new Map<string, LoadedPdfFont | null>();

function isSupportedPdfFontFile(fontPath: string) {
  return /\.(ttf|otf)$/i.test(fontPath);
}

function normalizeExportText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(EXPORT_PDF_SPACE_CHAR_REGEX, " ")
    .replace(EXPORT_ZERO_WIDTH_CHAR_REGEX, "")
    .replace(EXPORT_CONTROL_CHAR_REGEX, "")
    .trim();
}

function normalizePdfText(value: string) {
  return normalizeExportText(value);
}

function normalizeExportParagraphText(value: string) {
  return normalizeExportText(value).replace(/\n{3,}/g, "\n\n");
}

function normalizeExportCellText(value: string) {
  return normalizeExportText(value).replace(/\n{2,}/g, "\n");
}

function normalizePdfParagraphText(value: string) {
  return normalizePdfText(value).replace(/\n{3,}/g, "\n\n");
}

function sanitizeFileBaseName(rawTitle: string) {
  const sanitized = normalizeExportText(rawTitle)
    .replace(/[\/:*?"<>|{}\[\],]/g, "-")
    .replace(/[“”‘’]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : "generated-document";
}

function normalizeWorksheetName(rawName: string, fallback: string) {
  const sanitized = normalizeExportText(rawName)
    .replace(WORKSHEET_NAME_FORBIDDEN_CHAR_REGEX, "-")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 31);

  return sanitized.length > 0 ? sanitized : fallback;
}

function getUniqueWorksheetName(rawName: string, fallback: string, usedNames: Set<string>) {
  const baseName = normalizeWorksheetName(rawName, fallback);
  let candidate = baseName;
  let suffixIndex = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = `-${suffixIndex}`;
    candidate = `${baseName.slice(0, Math.max(31 - suffix.length, 1))}${suffix}`;
    suffixIndex += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function prependUtf8Bom(bytes: Uint8Array) {
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const output = new Uint8Array(UTF8_BOM.length + normalizedBytes.length);
  output.set(UTF8_BOM, 0);
  output.set(normalizedBytes, UTF8_BOM.length);
  return output;
}

function normalizeDocumentForExport(document: GeneratedDocument): GeneratedDocument {
  return {
    title: normalizeExportText(document.title),
    summary: normalizeExportParagraphText(document.summary),
    sections: document.sections.map((section) => ({
      heading: normalizeExportText(section.heading),
      paragraphs: section.paragraphs.map((paragraph) => normalizeExportParagraphText(paragraph)),
      bullets: section.bullets.map((bullet) => normalizeExportText(bullet)),
      ...(section.table
        ? {
            table: {
              ...(section.table.title
                ? {
                    title: normalizeExportText(section.table.title),
                  }
                : {}),
              columns: section.table.columns.map((column) => normalizeExportCellText(column)),
              rows: normalizeTableRows(section.table.columns, section.table.rows).map((row) =>
                row.map((value) => normalizeExportCellText(value)),
              ),
            },
          }
        : {}),
    })),
    spreadsheets: document.spreadsheets.map((sheet, index) => ({
      name: normalizeWorksheetName(sheet.name, `Sheet ${index + 1}`),
      columns: sheet.columns.map((column) => normalizeExportCellText(column)),
      rows: normalizeTableRows(sheet.columns, sheet.rows).map((row) =>
        row.map((value) => normalizeExportCellText(value)),
      ),
    })),
  };
}
function normalizeTableRows(columns: string[], rows: string[][]) {
  return rows.map((row) => {
    const normalized = row.slice(0, columns.length);
    while (normalized.length < columns.length) {
      normalized.push("");
    }
    return normalized;
  });
}

function buildMarkdownTable(columns: string[], rows: string[][]) {
  const normalizedRows = normalizeTableRows(columns, rows);
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = normalizedRows.map((row) => `| ${row.join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function buildMarkdownDocument(document: GeneratedDocument) {
  const normalizedDocument = normalizeDocumentForExport(document);
  const lines: string[] = [`# ${normalizedDocument.title}`, "", normalizedDocument.summary.trim(), ""];

  for (const section of normalizedDocument.sections) {
    lines.push(`## ${section.heading}`);
    lines.push("");

    for (const paragraph of section.paragraphs) {
      lines.push(paragraph.trim());
      lines.push("");
    }

    for (const bullet of section.bullets) {
      lines.push(`- ${bullet.trim()}`);
    }

    if (section.bullets.length > 0) {
      lines.push("");
    }

    if (section.table) {
      if (section.table.title) {
        lines.push(`### ${section.table.title}`);
        lines.push("");
      }
      lines.push(buildMarkdownTable(section.table.columns, section.table.rows));
      lines.push("");
    }
  }

  if (normalizedDocument.spreadsheets.length > 0) {
    lines.push("## Spreadsheet Data");
    lines.push("");
    for (const sheet of normalizedDocument.spreadsheets) {
      lines.push(`### ${sheet.name}`);
      lines.push("");
      lines.push(buildMarkdownTable(sheet.columns, sheet.rows));
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function buildPlainTextDocument(document: GeneratedDocument) {
  const normalizedDocument = normalizeDocumentForExport(document);
  const lines: string[] = [normalizedDocument.title, "", normalizedDocument.summary.trim(), ""];

  for (const section of normalizedDocument.sections) {
    lines.push(section.heading);
    lines.push("-".repeat(Math.max(section.heading.length, 6)));
    for (const paragraph of section.paragraphs) {
      lines.push(paragraph.trim());
      lines.push("");
    }
    for (const bullet of section.bullets) {
      lines.push(`- ${bullet.trim()}`);
    }
    if (section.bullets.length > 0) {
      lines.push("");
    }
    if (section.table) {
      if (section.table.title) {
        lines.push(section.table.title);
      }
      lines.push(section.table.columns.join(" | "));
      for (const row of normalizeTableRows(section.table.columns, section.table.rows)) {
        lines.push(row.join(" | "));
      }
      lines.push("");
    }
  }

  if (normalizedDocument.spreadsheets.length > 0) {
    lines.push("Spreadsheet Data");
    lines.push("--------------");
    for (const sheet of normalizedDocument.spreadsheets) {
      lines.push(sheet.name);
      lines.push(sheet.columns.join(" | "));
      for (const row of normalizeTableRows(sheet.columns, sheet.rows)) {
        lines.push(row.join(" | "));
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

function containsCjkText(value: string) {
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(value);
}

function resolvePdfFontPathCandidates(text: string) {
  return containsCjkText(text)
    ? PDF_FONT_CJK_PATH_CANDIDATES
    : PDF_FONT_LATIN_PATH_CANDIDATES;
}

export async function loadPdfFontBytes(text = "") {
  const cacheKey = containsCjkText(text) ? "cjk" : "latin";
  if (cachedPdfFontMap.has(cacheKey)) {
    return cachedPdfFontMap.get(cacheKey) ?? null;
  }

  for (const fontPath of resolvePdfFontPathCandidates(text)) {
    if (!existsSync(fontPath)) {
      continue;
    }

    if (!isSupportedPdfFontFile(fontPath)) {
      continue;
    }

    const loadedFont = {
      bytes: new Uint8Array(await readFile(fontPath)),
      path: fontPath,
    };
    cachedPdfFontMap.set(cacheKey, loadedFont);
    return loadedFont;
  }

  cachedPdfFontMap.set(cacheKey, null);
  return null;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const normalizedText = normalizePdfParagraphText(text);
  if (!normalizedText) {
    return [""];
  }

  const lines: string[] = [];

  for (const block of normalizedText.split("\n")) {
    const words = block.replace(/\s+/g, " ").trim().split(" ");
    if (words.length === 1 && words[0] === "") {
      lines.push("");
      continue;
    }

    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine.length > 0 ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }

      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        currentLine = word;
        continue;
      }

      let segment = "";
      for (const char of word) {
        const nextSegment = `${segment}${char}`;
        if (font.widthOfTextAtSize(nextSegment, fontSize) <= maxWidth) {
          segment = nextSegment;
          continue;
        }
        if (segment.length > 0) {
          lines.push(segment);
        }
        segment = char;
      }
      currentLine = segment;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [""];
}
function createPdfPage(pdf: PDFDocument) {
  return pdf.addPage([595.28, 841.89]);
}

function drawWrappedParagraph(options: {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  text: string;
  font: PDFFont;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  marginX: number;
}) {
  let { page, y } = options;
  const { pdf, text, font, fontSize, lineHeight, maxWidth, marginX } = options;

  for (const line of wrapText(text, font, fontSize, maxWidth)) {
    if (y < 56) {
      page = createPdfPage(pdf);
      y = page.getHeight() - 56;
    }
    page.drawText(line, {
      x: marginX,
      y,
      size: fontSize,
      font,
      color: rgb(0.15, 0.15, 0.18),
    });
    y -= lineHeight;
  }

  return { page, y };
}

async function exportPdf(document: GeneratedDocument) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const pdfFontProbeText = buildPlainTextDocument(document);
  const embeddedFont = await loadPdfFontBytes(pdfFontProbeText);

  let font: PDFFont;
  if (!embeddedFont) {
    if (containsCjkText(pdfFontProbeText)) {
      throw new Error("Unable to find a PDF font that supports the current document content. Please configure PDF_FONT_PATH or install a compatible font.");
    }

    font = await pdf.embedFont(StandardFonts.Helvetica);
  } else {
    try {
      font = await pdf.embedFont(embeddedFont.bytes, { subset: true });
    } catch (error) {
      throw new Error("PDF font load failed: " + embeddedFont.path + ". Error: " + String(error));
    }
  }
  const marginX = 50;
  const maxWidth = 495;
  let page = createPdfPage(pdf);
  let y = page.getHeight() - 56;

  ({ page, y } = drawWrappedParagraph({
    pdf,
    page,
    y,
    text: document.title,
    font,
    fontSize: 20,
    lineHeight: 26,
    maxWidth,
    marginX,
  }));
  y -= 6;

  ({ page, y } = drawWrappedParagraph({
    pdf,
    page,
    y,
    text: document.summary,
    font,
    fontSize: 11,
    lineHeight: 17,
    maxWidth,
    marginX,
  }));
  y -= 8;

  for (const section of document.sections) {
    ({ page, y } = drawWrappedParagraph({
      pdf,
      page,
      y,
      text: section.heading,
      font,
      fontSize: 15,
      lineHeight: 21,
      maxWidth,
      marginX,
    }));
    y -= 2;

    for (const paragraph of section.paragraphs) {
      ({ page, y } = drawWrappedParagraph({
        pdf,
        page,
        y,
        text: paragraph,
        font,
        fontSize: 11,
        lineHeight: 17,
        maxWidth,
        marginX,
      }));
      y -= 4;
    }

    for (const bullet of section.bullets) {
      ({ page, y } = drawWrappedParagraph({
        pdf,
        page,
        y,
        text: `- ${bullet}`,
        font,
        fontSize: 11,
        lineHeight: 16,
        maxWidth,
        marginX,
      }));
    }

    if (section.table) {
      const table = section.table;
      const colCount = table.columns.length;
      const cellWidth = maxWidth / colCount;
      const cellPadding = 6;
      const fontSize = 9;
      const lineHeight = 13;

      if (table.title) {
        ({ page, y } = drawWrappedParagraph({
          pdf,
          page,
          y,
          text: table.title,
          font,
          fontSize: 12,
          lineHeight: 18,
          maxWidth,
          marginX,
        }));
        y -= 4;
      }

      const drawTableRow = (cells: string[], isHeader: boolean) => {
        const wrappedCells = cells.map(cell =>
          wrapText(cell, font, fontSize, cellWidth - cellPadding * 2)
        );
        const rowHeight = Math.max(...wrappedCells.map(lines => lines.length)) * lineHeight + cellPadding * 2;

        if (y - rowHeight < 56) {
          page = createPdfPage(pdf);
          y = page.getHeight() - 56;
        }

        for (let i = 0; i < colCount; i++) {
          const x = marginX + i * cellWidth;

          page.drawRectangle({
            x,
            y: y - rowHeight,
            width: cellWidth,
            height: rowHeight,
            borderColor: rgb(0.5, 0.5, 0.5),
            borderWidth: 0.5,
            color: isHeader ? rgb(0.95, 0.95, 0.95) : undefined,
          });

          const lines = wrappedCells[i];
          let textY = y - cellPadding - fontSize;
          for (const line of lines) {
            page.drawText(line, {
              x: x + cellPadding,
              y: textY,
              size: fontSize,
              font,
              color: rgb(0.15, 0.15, 0.18),
            });
            textY -= lineHeight;
          }
        }

        y -= rowHeight;
      };

      drawTableRow(table.columns, true);

      for (const row of normalizeTableRows(table.columns, table.rows)) {
        drawTableRow(row, false);
      }

      y -= 4;
    }

    y -= 8;
  }

  return new Uint8Array(await pdf.save());
}

async function exportTxt(document: GeneratedDocument) {
  return prependUtf8Bom(new TextEncoder().encode(buildPlainTextDocument(document)));
}

async function exportMd(document: GeneratedDocument) {
  return prependUtf8Bom(new TextEncoder().encode(buildMarkdownDocument(document)));
}

async function exportDocx(document: GeneratedDocument) {
  const children: FileChild[] = [
    new Paragraph({ text: document.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: document.summary }),
  ];

  for (const section of document.sections) {
    children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));

    for (const paragraph of section.paragraphs) {
      children.push(new Paragraph({ text: paragraph }));
    }

    for (const bullet of section.bullets) {
      children.push(
        new Paragraph({
          text: bullet,
          bullet: { level: 0 },
        }),
      );
    }

    if (section.table) {
      if (section.table.title) {
        children.push(
          new Paragraph({ text: section.table.title, heading: HeadingLevel.HEADING_2 }),
        );
      }

      const rows = normalizeTableRows(section.table.columns, section.table.rows);

      const docxRows = [
        new TableRow({
          children: section.table.columns.map(
            (column) =>
              new TableCell({
                children: [
                  new Paragraph({ children: [new TextRun({ text: column, bold: true })] }),
                ],
              }),
          ),
        }),
        ...rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (value) =>
                    new TableCell({
                      children: [new Paragraph({ text: value })],
                    }),
              ),
            }),
        ),
      ];

      children.push(
        new DocxTable({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: docxRows,
        }),
      );
    }
  }

  const doc = new DocxDocument({
    styles: {
      default: {
        document: {
          run: {
            font: DOCX_DEFAULT_FONT,
            language: {
              value: "en-US",
              eastAsia: "zh-CN",
            },
          },
        },
      },
    },
    sections: [
      {
        children,
      },
    ],
  });

  return new Uint8Array(await Packer.toBuffer(doc));
}

async function exportXlsx(document: GeneratedDocument) {
  const workbook = new ExcelJS.Workbook();
  const usedSheetNames = new Set<string>();

  const configureWorksheet = (worksheet: ExcelJS.Worksheet) => {
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber === 1) {
        row.font = { bold: true };
      }
    });
  };

  const overviewSheet = workbook.addWorksheet(
    getUniqueWorksheetName("Overview", "Overview", usedSheetNames),
  );
  overviewSheet.columns = [
    { header: "Section", key: "section", width: 24 },
    { header: "Content", key: "content", width: 60 },
  ];
  overviewSheet.addRow({ section: "Title", content: document.title });
  overviewSheet.addRow({ section: "Summary", content: document.summary });
  for (const section of document.sections) {
    overviewSheet.addRow({ section: section.heading, content: section.paragraphs.join("\n\n") });
    for (const bullet of section.bullets) {
      overviewSheet.addRow({ section: "Bullet", content: bullet });
    }
  }

  configureWorksheet(overviewSheet);

  for (const section of document.sections.filter((item) => item.table)) {
    const table = section.table!;
    const sheet = workbook.addWorksheet(
      getUniqueWorksheetName(table.title ?? section.heading, "SectionTable", usedSheetNames),
    );
    sheet.columns = table.columns.map((column) => ({ header: column, key: column, width: 24 }));
    for (const row of normalizeTableRows(table.columns, table.rows)) {
      sheet.addRow(row);
    }
    configureWorksheet(sheet);
  }

  for (const sheetData of document.spreadsheets) {
    const sheet = workbook.addWorksheet(
      getUniqueWorksheetName(sheetData.name, "Sheet", usedSheetNames),
    );
    sheet.columns = sheetData.columns.map((column) => ({ header: column, key: column, width: 24 }));
    for (const row of normalizeTableRows(sheetData.columns, sheetData.rows)) {
      sheet.addRow(row);
    }
    configureWorksheet(sheet);
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function generateDocumentFiles(
  input: GeneratedDocument,
  formats: readonly GeneratedFileFormat[] = GENERATED_FILE_FORMATS,
): Promise<GeneratedExportedFile[]> {
  const document = normalizeDocumentForExport(generatedDocumentSchema.parse(input));
  const fileBaseName = sanitizeFileBaseName(document.title);

  const uniqueFormats = Array.from(new Set(formats));
  const exporters: Record<GeneratedFileFormat, () => Promise<GeneratedExportedFile>> = {
    pdf: async () => ({
      format: "pdf",
      fileName: `${fileBaseName}.pdf`,
      mimeType: "application/pdf",
      bytes: await exportPdf(document),
    }),
    xlsx: async () => ({
      format: "xlsx",
      fileName: `${fileBaseName}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: await exportXlsx(document),
    }),
    docx: async () => ({
      format: "docx",
      fileName: `${fileBaseName}.docx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await exportDocx(document),
    }),
    txt: async () => ({
      format: "txt",
      fileName: `${fileBaseName}.txt`,
      mimeType: "text/plain; charset=utf-8",
      bytes: await exportTxt(document),
    }),
    md: async () => ({
      format: "md",
      fileName: `${fileBaseName}.md`,
      mimeType: "text/markdown; charset=utf-8",
      bytes: await exportMd(document),
    }),
  };

  return Promise.all(uniqueFormats.map((format) => exporters[format]()));
}
