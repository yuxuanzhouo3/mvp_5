"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatedDocumentSchema = exports.GENERATED_FILE_FORMATS = void 0;
exports.getGeneratedDocumentSchema = getGeneratedDocumentSchema;
exports.buildMarkdownDocument = buildMarkdownDocument;
exports.buildPlainTextDocument = buildPlainTextDocument;
exports.loadPdfFontBytes = loadPdfFontBytes;
exports.generateDocumentFiles = generateDocumentFiles;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const fontkit_1 = __importDefault(require("@pdf-lib/fontkit"));
const docx_1 = require("docx");
const exceljs_1 = __importDefault(require("exceljs"));
const pdf_lib_1 = require("pdf-lib");
const zod_1 = require("zod");
const document_formats_1 = require("./document-formats");
exports.GENERATED_FILE_FORMATS = document_formats_1.DOCUMENT_FILE_FORMATS;
const generatedDocumentTableSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(80).optional(),
    columns: zod_1.z.array(zod_1.z.string().trim().min(1).max(40)).min(1).max(8),
    rows: zod_1.z.array(zod_1.z.array(zod_1.z.string().trim().max(200)).min(1).max(8)).max(30),
});
const generatedDocumentSectionSchema = zod_1.z.object({
    heading: zod_1.z.string().trim().min(1).max(80),
    paragraphs: zod_1.z.array(zod_1.z.string().trim().min(1).max(1500)).min(1).max(4),
    bullets: zod_1.z.array(zod_1.z.string().trim().min(1).max(200)).max(8).default([]),
    table: generatedDocumentTableSchema.optional(),
});
const generatedSpreadsheetSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(31),
    columns: zod_1.z.array(zod_1.z.string().trim().min(1).max(40)).min(1).max(8),
    rows: zod_1.z.array(zod_1.z.array(zod_1.z.string().trim().max(200)).min(1).max(8)).min(1).max(50),
});
function getGeneratedDocumentSchema(options) {
    const requireSpreadsheet = options?.requireSpreadsheet ?? false;
    return zod_1.z.object({
        title: zod_1.z.string().trim().min(1).max(120),
        summary: zod_1.z.string().trim().min(1).max(1200),
        sections: zod_1.z.array(generatedDocumentSectionSchema).min(1).max(8),
        spreadsheets: zod_1.z.array(generatedSpreadsheetSchema).min(requireSpreadsheet ? 1 : 0).max(3),
    });
}
exports.generatedDocumentSchema = getGeneratedDocumentSchema();
const PDF_FONT_PATH_CANDIDATES = [
    process.env.PDF_FONT_PATH,
    "C:/Windows/Fonts/msyh.ttf",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttf",
    "C:/Windows/Fonts/simkai.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    node_path_1.default.join(process.cwd(), "node_modules", "@fontsource", "noto-sans-sc", "files", "noto-sans-sc-chinese-simplified-400-normal.woff"),
].filter((value) => typeof value === "string" && value.trim().length > 0);
const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const DOCX_DEFAULT_FONT = {
    ascii: "Calibri",
    hAnsi: "Calibri",
    eastAsia: "Microsoft YaHei",
    cs: "Calibri",
};
const EXPORT_CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EXPORT_ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200D\uFEFF]/g;
const WORKSHEET_NAME_FORBIDDEN_CHAR_REGEX = /[:\\/?*\[\]]/g;
let cachedPdfFont;
function isSupportedPdfFontFile(fontPath) {
    return /\.(ttf|otf)$/i.test(fontPath);
}
function normalizeExportText(value) {
    return value
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(EXPORT_ZERO_WIDTH_CHAR_REGEX, "")
        .replace(EXPORT_CONTROL_CHAR_REGEX, "")
        .trim();
}
function normalizeExportParagraphText(value) {
    return normalizeExportText(value).replace(/\n{3,}/g, "\n\n");
}
function normalizeExportCellText(value) {
    return normalizeExportText(value).replace(/\n{2,}/g, "\n");
}
function sanitizeFileBaseName(rawTitle) {
    const sanitized = normalizeExportText(rawTitle)
        .replace(/[\/:*?"<>|{}\[\],]/g, "-")
        .replace(/[“”‘’]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
    return sanitized.length > 0 ? sanitized : "generated-document";
}
function normalizeWorksheetName(rawName, fallback) {
    const sanitized = normalizeExportText(rawName)
        .replace(WORKSHEET_NAME_FORBIDDEN_CHAR_REGEX, "-")
        .replace(/^'+|'+$/g, "")
        .replace(/\s+/g, " ")
        .replace(/-+/g, "-")
        .trim()
        .slice(0, 31);
    return sanitized.length > 0 ? sanitized : fallback;
}
function getUniqueWorksheetName(rawName, fallback, usedNames) {
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
function prependUtf8Bom(bytes) {
    const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const output = new Uint8Array(UTF8_BOM.length + normalizedBytes.length);
    output.set(UTF8_BOM, 0);
    output.set(normalizedBytes, UTF8_BOM.length);
    return output;
}
function normalizeDocumentForExport(document) {
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
                        rows: normalizeTableRows(section.table.columns, section.table.rows).map((row) => row.map((value) => normalizeExportCellText(value))),
                    },
                }
                : {}),
        })),
        spreadsheets: document.spreadsheets.map((sheet, index) => ({
            name: normalizeWorksheetName(sheet.name, `Sheet ${index + 1}`),
            columns: sheet.columns.map((column) => normalizeExportCellText(column)),
            rows: normalizeTableRows(sheet.columns, sheet.rows).map((row) => row.map((value) => normalizeExportCellText(value))),
        })),
    };
}
function normalizeTableRows(columns, rows) {
    return rows.map((row) => {
        const normalized = row.slice(0, columns.length);
        while (normalized.length < columns.length) {
            normalized.push("");
        }
        return normalized;
    });
}
function buildMarkdownTable(columns, rows) {
    const normalizedRows = normalizeTableRows(columns, rows);
    const header = `| ${columns.join(" | ")} |`;
    const divider = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = normalizedRows.map((row) => `| ${row.join(" | ")} |`);
    return [header, divider, ...body].join("\n");
}
function buildMarkdownDocument(document) {
    const normalizedDocument = normalizeDocumentForExport(document);
    const lines = [`# ${normalizedDocument.title}`, "", normalizedDocument.summary.trim(), ""];
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
function buildPlainTextDocument(document) {
    const normalizedDocument = normalizeDocumentForExport(document);
    const lines = [normalizedDocument.title, "", normalizedDocument.summary.trim(), ""];
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
async function loadPdfFontBytes() {
    if (cachedPdfFont !== undefined) {
        return cachedPdfFont;
    }
    for (const fontPath of PDF_FONT_PATH_CANDIDATES) {
        if (!(0, node_fs_1.existsSync)(fontPath)) {
            continue;
        }
        if (!isSupportedPdfFontFile(fontPath)) {
            continue;
        }
        cachedPdfFont = {
            bytes: new Uint8Array(await (0, promises_1.readFile)(fontPath)),
            path: fontPath,
        };
        return cachedPdfFont;
    }
    cachedPdfFont = null;
    return cachedPdfFont;
}
function wrapText(text, font, fontSize, maxWidth) {
    const normalizedText = normalizeExportParagraphText(text);
    if (!normalizedText) {
        return [""];
    }
    const lines = [];
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
function createPdfPage(pdf) {
    return pdf.addPage([595.28, 841.89]);
}
function drawWrappedParagraph(options) {
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
            color: (0, pdf_lib_1.rgb)(0.15, 0.15, 0.18),
        });
        y -= lineHeight;
    }
    return { page, y };
}
async function exportPdf(document) {
    const pdf = await pdf_lib_1.PDFDocument.create();
    pdf.registerFontkit(fontkit_1.default);
    const embeddedFont = await loadPdfFontBytes();
    if (!embeddedFont) {
        throw new Error("无法找到支持中文的PDF字体文件，请确保系统中安装了中文字体（如：simhei.ttf）");
    }
    let font;
    try {
        font = await pdf.embedFont(embeddedFont.bytes, { subset: true });
    }
    catch (error) {
        throw new Error(`PDF字体加载失败: ${embeddedFont.path}，错误: ${error}`);
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
            const drawTableRow = (cells, isHeader) => {
                const wrappedCells = cells.map(cell => wrapText(cell, font, fontSize, cellWidth - cellPadding * 2));
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
                        borderColor: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
                        borderWidth: 0.5,
                        color: isHeader ? (0, pdf_lib_1.rgb)(0.95, 0.95, 0.95) : undefined,
                    });
                    const lines = wrappedCells[i];
                    let textY = y - cellPadding - fontSize;
                    for (const line of lines) {
                        page.drawText(line, {
                            x: x + cellPadding,
                            y: textY,
                            size: fontSize,
                            font,
                            color: (0, pdf_lib_1.rgb)(0.15, 0.15, 0.18),
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
async function exportTxt(document) {
    return prependUtf8Bom(new TextEncoder().encode(buildPlainTextDocument(document)));
}
async function exportMd(document) {
    return prependUtf8Bom(new TextEncoder().encode(buildMarkdownDocument(document)));
}
async function exportDocx(document) {
    const children = [
        new docx_1.Paragraph({ text: document.title, heading: docx_1.HeadingLevel.TITLE }),
        new docx_1.Paragraph({ text: document.summary }),
    ];
    for (const section of document.sections) {
        children.push(new docx_1.Paragraph({ text: section.heading, heading: docx_1.HeadingLevel.HEADING_1 }));
        for (const paragraph of section.paragraphs) {
            children.push(new docx_1.Paragraph({ text: paragraph }));
        }
        for (const bullet of section.bullets) {
            children.push(new docx_1.Paragraph({
                text: bullet,
                bullet: { level: 0 },
            }));
        }
        if (section.table) {
            if (section.table.title) {
                children.push(new docx_1.Paragraph({ text: section.table.title, heading: docx_1.HeadingLevel.HEADING_2 }));
            }
            const rows = normalizeTableRows(section.table.columns, section.table.rows);
            const docxRows = [
                new docx_1.TableRow({
                    children: section.table.columns.map((column) => new docx_1.TableCell({
                        children: [
                            new docx_1.Paragraph({ children: [new docx_1.TextRun({ text: column, bold: true })] }),
                        ],
                    })),
                }),
                ...rows.map((row) => new docx_1.TableRow({
                    children: row.map((value) => new docx_1.TableCell({
                        children: [new docx_1.Paragraph({ text: value })],
                    })),
                })),
            ];
            children.push(new docx_1.Table({
                width: { size: 100, type: docx_1.WidthType.PERCENTAGE },
                rows: docxRows,
            }));
        }
    }
    const doc = new docx_1.Document({
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
    return new Uint8Array(await docx_1.Packer.toBuffer(doc));
}
async function exportXlsx(document) {
    const workbook = new exceljs_1.default.Workbook();
    const usedSheetNames = new Set();
    const configureWorksheet = (worksheet) => {
        worksheet.views = [{ state: "frozen", ySplit: 1 }];
        worksheet.eachRow((row, rowNumber) => {
            row.alignment = { vertical: "top", wrapText: true };
            if (rowNumber === 1) {
                row.font = { bold: true };
            }
        });
    };
    const overviewSheet = workbook.addWorksheet(getUniqueWorksheetName("Overview", "Overview", usedSheetNames));
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
        const table = section.table;
        const sheet = workbook.addWorksheet(getUniqueWorksheetName(table.title ?? section.heading, "SectionTable", usedSheetNames));
        sheet.columns = table.columns.map((column) => ({ header: column, key: column, width: 24 }));
        for (const row of normalizeTableRows(table.columns, table.rows)) {
            sheet.addRow(row);
        }
        configureWorksheet(sheet);
    }
    for (const sheetData of document.spreadsheets) {
        const sheet = workbook.addWorksheet(getUniqueWorksheetName(sheetData.name, "Sheet", usedSheetNames));
        sheet.columns = sheetData.columns.map((column) => ({ header: column, key: column, width: 24 }));
        for (const row of normalizeTableRows(sheetData.columns, sheetData.rows)) {
            sheet.addRow(row);
        }
        configureWorksheet(sheet);
    }
    return new Uint8Array(await workbook.xlsx.writeBuffer());
}
async function generateDocumentFiles(input, formats = exports.GENERATED_FILE_FORMATS) {
    const document = normalizeDocumentForExport(exports.generatedDocumentSchema.parse(input));
    const fileBaseName = sanitizeFileBaseName(document.title);
    const uniqueFormats = Array.from(new Set(formats));
    const exporters = {
        pdf: async () => ({
            format: "pdf",
            fileName: `${fileBaseName}.pdf`,
            mimeType: "application/pdf",
            bytes: await exportPdf(document),
        }),
        xlsx: async () => ({
            format: "xlsx",
            fileName: `${fileBaseName}.xlsx`,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes: await exportXlsx(document),
        }),
        docx: async () => ({
            format: "docx",
            fileName: `${fileBaseName}.docx`,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
