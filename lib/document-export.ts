import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  rows: z.array(z.array(z.string().trim().max(200)).min(1).max(8)).max(30),
});

const generatedDocumentSectionSchema = z.object({
  heading: z.string().trim().min(1).max(80),
  paragraphs: z.array(z.string().trim().min(1).max(1500)).min(1).max(4),
  bullets: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  table: generatedDocumentTableSchema.optional(),
});

const generatedSpreadsheetSchema = z.object({
  name: z.string().trim().min(1).max(31),
  columns: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  rows: z.array(z.array(z.string().trim().max(200)).min(1).max(8)).min(1).max(50),
});

export function getGeneratedDocumentSchema(options?: { requireSpreadsheet?: boolean }) {
  const requireSpreadsheet = options?.requireSpreadsheet ?? false;

  return z.object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(1200),
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

const PDF_FONT_PATH_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/msyh.ttf",
  "C:/Windows/Fonts/simkai.ttf",
  "C:/Windows/Fonts/simsun.ttf",
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/simsun.ttc",
].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

type LoadedPdfFont = {
  bytes: Uint8Array;
  path: string;
};

let cachedPdfFont: LoadedPdfFont | null | undefined;

function isSupportedPdfFontFile(fontPath: string) {
  return /\.(ttf|otf)$/i.test(fontPath);
}

function sanitizeFileBaseName(rawTitle: string) {
  const sanitized = rawTitle
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : "generated-document";
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
  const lines: string[] = [`# ${document.title}`, "", document.summary.trim(), ""];

  for (const section of document.sections) {
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

  if (document.spreadsheets.length > 0) {
    lines.push("## Spreadsheet Data");
    lines.push("");
    for (const sheet of document.spreadsheets) {
      lines.push(`### ${sheet.name}`);
      lines.push("");
      lines.push(buildMarkdownTable(sheet.columns, sheet.rows));
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function buildPlainTextDocument(document: GeneratedDocument) {
  const lines: string[] = [document.title, "", document.summary.trim(), ""];

  for (const section of document.sections) {
    lines.push(section.heading);
    lines.push("-".repeat(Math.max(section.heading.length, 6)));
    for (const paragraph of section.paragraphs) {
      lines.push(paragraph.trim());
      lines.push("");
    }
    for (const bullet of section.bullets) {
      lines.push(`• ${bullet.trim()}`);
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

  if (document.spreadsheets.length > 0) {
    lines.push("Spreadsheet Data");
    lines.push("--------------");
    for (const sheet of document.spreadsheets) {
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

async function loadPdfFontBytes() {
  if (cachedPdfFont !== undefined) {
    return cachedPdfFont;
  }

  for (const fontPath of PDF_FONT_PATH_CANDIDATES) {
    if (!existsSync(fontPath)) {
      continue;
    }

    if (!isSupportedPdfFontFile(fontPath)) {
      continue;
    }

    cachedPdfFont = {
      bytes: new Uint8Array(await readFile(fontPath)),
      path: fontPath,
    };
    return cachedPdfFont;
  }

  cachedPdfFont = null;
  return cachedPdfFont;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 1 && words[0] === "") {
    return [""];
  }

  const lines: string[] = [];
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

  const embeddedFont = await loadPdfFontBytes();
  let font: PDFFont;

  if (embeddedFont) {
    try {
      font = await pdf.embedFont(embeddedFont.bytes, { subset: true });
    } catch (error) {
      console.warn(
        `[document-export] PDF 字体嵌入失败，回退到 Helvetica。font=${embeddedFont.path}`,
        error,
      );
      font = await pdf.embedFont(StandardFonts.Helvetica);
    }
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
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
        text: `• ${bullet}`,
        font,
        fontSize: 11,
        lineHeight: 16,
        maxWidth,
        marginX,
      }));
    }

    if (section.table) {
      if (section.table.title) {
        ({ page, y } = drawWrappedParagraph({
          pdf,
          page,
          y,
          text: section.table.title,
          font,
          fontSize: 12,
          lineHeight: 18,
          maxWidth,
          marginX,
        }));
      }

      ({ page, y } = drawWrappedParagraph({
        pdf,
        page,
        y,
        text: section.table.columns.join(" | "),
        font,
        fontSize: 10,
        lineHeight: 15,
        maxWidth,
        marginX,
      }));
      for (const row of normalizeTableRows(section.table.columns, section.table.rows)) {
        ({ page, y } = drawWrappedParagraph({
          pdf,
          page,
          y,
          text: row.join(" | "),
          font,
          fontSize: 10,
          lineHeight: 15,
          maxWidth,
          marginX,
        }));
      }
    }

    y -= 8;
  }

  return new Uint8Array(await pdf.save());
}

async function exportTxt(document: GeneratedDocument) {
  return new TextEncoder().encode(buildPlainTextDocument(document));
}

async function exportMd(document: GeneratedDocument) {
  return new TextEncoder().encode(buildMarkdownDocument(document));
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

  const overviewSheet = workbook.addWorksheet("Overview");
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

  for (const section of document.sections.filter((item) => item.table)) {
    const table = section.table!;
    const sheet = workbook.addWorksheet(
      sanitizeFileBaseName(table.title ?? section.heading).slice(0, 31) || "SectionTable",
    );
    sheet.columns = table.columns.map((column) => ({ header: column, key: column, width: 24 }));
    for (const row of normalizeTableRows(table.columns, table.rows)) {
      sheet.addRow(row);
    }
  }

  for (const sheetData of document.spreadsheets) {
    const sheet = workbook.addWorksheet(sheetData.name.slice(0, 31));
    sheet.columns = sheetData.columns.map((column) => ({ header: column, key: column, width: 24 }));
    for (const row of normalizeTableRows(sheetData.columns, sheetData.rows)) {
      sheet.addRow(row);
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function generateDocumentFiles(
  input: GeneratedDocument,
  formats: readonly GeneratedFileFormat[] = GENERATED_FILE_FORMATS,
): Promise<GeneratedExportedFile[]> {
  const document = generatedDocumentSchema.parse(input);
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
