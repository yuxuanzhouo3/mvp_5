import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { loadPdfFontBytes } from "@/lib/document-export";

type PdfJsModule = {
  getDocument: (src?: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
        cleanup?: () => void;
      }>;
      destroy?: () => Promise<void> | void;
    }>;
    destroy?: () => Promise<void> | void;
  };
};

type RawPdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
};

type PdfLineSegment = {
  kind: "gap" | "item";
  start: number;
  end: number;
  itemIndex: number | null;
  xStart: number;
  xEnd: number;
};

type PdfTextLine = {
  pageIndex: number;
  text: string;
  items: PdfTextItem[];
  segments: PdfLineSegment[];
};

type PdfMatchRegion = {
  start: number;
  end: number;
  startX: number;
  endX: number;
  items: PdfTextItem[];
};

type PdfOverlayOperation = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  textY: number;
};

let cachedPdfJsModulePromise: Promise<PdfJsModule> | null = null;

function replaceAllLiteral(input: string, sourceText: string, targetText: string) {
  if (!sourceText) {
    return {
      value: input,
      count: 0,
    };
  }

  let cursor = 0;
  let count = 0;
  let output = "";

  while (cursor < input.length) {
    const matchedIndex = input.indexOf(sourceText, cursor);
    if (matchedIndex < 0) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, matchedIndex);
    output += targetText;
    cursor = matchedIndex + sourceText.length;
    count += 1;
  }

  return {
    value: output,
    count,
  };
}

async function loadPdfJsModule() {
  if (!cachedPdfJsModulePromise) {
    cachedPdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJsModule>;
  }

  return cachedPdfJsModulePromise;
}

function normalizePdfTextItem(rawItem: RawPdfTextItem) {
  if (!rawItem || typeof rawItem.str !== "string" || !Array.isArray(rawItem.transform)) {
    return null;
  }

  const x = Number(rawItem.transform[4] ?? 0);
  const y = Number(rawItem.transform[5] ?? 0);
  const height = Math.max(1, Math.abs(Number(rawItem.height ?? 0)) || Math.abs(Number(rawItem.transform[3] ?? 0)) || 12);
  const width = Math.max(1, Math.abs(Number(rawItem.width ?? 0)) || rawItem.str.length * height * 0.5);

  return {
    str: rawItem.str,
    x,
    y,
    width,
    height,
    fontSize: height,
    hasEOL: rawItem.hasEOL === true,
  } satisfies PdfTextItem;
}

function shouldStartNewPdfLine(previous: PdfTextItem, current: PdfTextItem) {
  const yDifference = Math.abs(current.y - previous.y);
  const tolerance = Math.max(2, Math.max(previous.height, current.height) * 0.45);
  return yDifference > tolerance || current.x + 1 < previous.x;
}

function buildPdfTextLine(pageIndex: number, items: PdfTextItem[]) {
  const segments: PdfLineSegment[] = [];
  let text = "";
  let previous: PdfTextItem | null = null;

  items.forEach((item, itemIndex) => {
    if (previous) {
      const previousEndX = previous.x + previous.width;
      const gapWidth = item.x - previousEndX;
      const needsSpace =
        gapWidth > Math.max(previous.fontSize, item.fontSize) * 0.2 &&
        !previous.str.endsWith(" ") &&
        !item.str.startsWith(" ");

      if (needsSpace) {
        const gapStart = text.length;
        text += " ";
        segments.push({
          kind: "gap",
          start: gapStart,
          end: text.length,
          itemIndex: null,
          xStart: previousEndX,
          xEnd: item.x,
        });
      }
    }

    const start = text.length;
    text += item.str;
    segments.push({
      kind: "item",
      start,
      end: text.length,
      itemIndex,
      xStart: item.x,
      xEnd: item.x + item.width,
    });
    previous = item;
  });

  return {
    pageIndex,
    text,
    items,
    segments,
  } satisfies PdfTextLine;
}

async function extractPdfTextLines(bytes: Uint8Array) {
  const pdfjs = await loadPdfJsModule();
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const lines: PdfTextLine[] = [];

  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const rawItems = Array.isArray(textContent.items) ? textContent.items : [];
      const currentLineItems: PdfTextItem[] = [];
      let previousItem: PdfTextItem | null = null;

      for (const rawItem of rawItems) {
        if (!(rawItem && typeof rawItem === "object" && "str" in rawItem)) {
          continue;
        }

        const item = normalizePdfTextItem(rawItem as RawPdfTextItem);
        if (!item || item.str.length === 0) {
          continue;
        }

        if (previousItem && shouldStartNewPdfLine(previousItem, item) && currentLineItems.length > 0) {
          lines.push(buildPdfTextLine(pageIndex, currentLineItems.splice(0)));
        }

        currentLineItems.push(item);
        previousItem = item;

        if (item.hasEOL && currentLineItems.length > 0) {
          lines.push(buildPdfTextLine(pageIndex, currentLineItems.splice(0)));
          previousItem = null;
        }
      }

      if (currentLineItems.length > 0) {
        lines.push(buildPdfTextLine(pageIndex, currentLineItems));
      }

      page.cleanup?.();
    }
  } finally {
    await document.destroy?.();
    await loadingTask.destroy?.();
  }

  return lines.filter((line) => line.text.trim().length > 0);
}

export async function extractTextFromPdfBuffer(bytes: Uint8Array) {
  const lines = await extractPdfTextLines(bytes);
  return lines.map((line) => line.text).join("\n").replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function resolvePdfLineAnchor(line: PdfTextLine, offset: number, preferEnd: boolean) {
  if (line.segments.length === 0 || line.items.length === 0) {
    return null;
  }

  if (offset <= 0) {
    return {
      x: line.items[0].x,
      item: line.items[0],
    };
  }

  if (offset >= line.text.length) {
    const lastItem = line.items[line.items.length - 1];
    return {
      x: lastItem.x + lastItem.width,
      item: lastItem,
    };
  }

  for (const segment of line.segments) {
    const isMatch = offset < segment.end || (preferEnd && offset === segment.end);
    if (!isMatch) {
      continue;
    }

    if (segment.kind !== "item" || segment.itemIndex === null) {
      return null;
    }

    const item = line.items[segment.itemIndex];
    const segmentLength = Math.max(1, segment.end - segment.start);
    const segmentOffset = preferEnd && offset === segment.end ? segmentLength : offset - segment.start;
    const ratio = Math.min(1, Math.max(0, segmentOffset / segmentLength));

    return {
      x: segment.xStart + (segment.xEnd - segment.xStart) * ratio,
      item,
    };
  }

  return null;
}

function collectPdfLineMatches(line: PdfTextLine, sourceText: string) {
  const matches: PdfMatchRegion[] = [];
  let cursor = 0;

  while (cursor < line.text.length) {
    const matchedIndex = line.text.indexOf(sourceText, cursor);
    if (matchedIndex < 0) {
      break;
    }

    const startAnchor = resolvePdfLineAnchor(line, matchedIndex, false);
    const endAnchor = resolvePdfLineAnchor(line, matchedIndex + sourceText.length, true);
    if (startAnchor && endAnchor && endAnchor.x > startAnchor.x) {
      const involvedItemIndexes = Array.from(
        new Set(
          line.segments
            .filter(
              (segment) =>
                segment.kind === "item" &&
                segment.itemIndex !== null &&
                segment.end > matchedIndex &&
                segment.start < matchedIndex + sourceText.length,
            )
            .map((segment) => segment.itemIndex as number),
        ),
      );

      matches.push({
        start: matchedIndex,
        end: matchedIndex + sourceText.length,
        startX: startAnchor.x,
        endX: endAnchor.x,
        items: involvedItemIndexes.map((index) => line.items[index]),
      });
    }

    cursor = matchedIndex + sourceText.length;
  }

  return matches;
}

function fitOverlayFontSize(font: PDFFont, text: string, preferredSize: number, maxWidth: number) {
  if (!text.trim()) {
    return preferredSize;
  }

  let nextSize = preferredSize;
  while (nextSize > 4 && font.widthOfTextAtSize(text, nextSize) > maxWidth) {
    nextSize -= 0.5;
  }

  return Math.max(4, nextSize);
}

async function loadOverlayFont(pdf: PDFDocument, text: string) {
  pdf.registerFontkit(fontkit);
  const loadedFont = await loadPdfFontBytes();

  if (loadedFont) {
    try {
      return await pdf.embedFont(loadedFont.bytes, { subset: true });
    } catch (error) {
      console.warn(
        `[pdf-editing] Failed to embed custom PDF font, falling back to Helvetica. font=${loadedFont.path}`,
        error,
      );
    }
  }

  if (/[^\u0000-\u00ff]/.test(text)) {
    throw new Error(
      "当前环境缺少可用于 PDF 编辑的中文字体，请配置 PDF_FONT_PATH 或安装可用字体后重试。",
    );
  }

  return pdf.embedFont(StandardFonts.Helvetica);
}

export async function replaceTextInPdfBuffer(
  bytes: Uint8Array,
  plan: {
    sourceText: string;
    targetText: string;
  },
): Promise<{ bytes: Uint8Array; replacementCount: number }> {
  if (/[\r\n]/.test(`${plan.sourceText}${plan.targetText}`)) {
    throw new Error("PDF 精准编辑暂不支持跨行替换，请改用单行短语替换。请保持“原文”和“新文”都在同一行内。");
  }

  const lines = await extractPdfTextLines(bytes);
  const pdf = await PDFDocument.load(Uint8Array.from(bytes), { updateMetadata: false });
  const font = await loadOverlayFont(pdf, `${plan.sourceText}${plan.targetText}`);
  const operations: PdfOverlayOperation[] = [];
  let replacementCount = 0;

  lines.forEach((line) => {
    const matches = collectPdfLineMatches(line, plan.sourceText);
    matches.forEach((match) => {
      if (match.items.length === 0) {
        return;
      }

      replacementCount += 1;
      const preferredFontSize =
        match.items.reduce((sum, item) => sum + item.fontSize, 0) / Math.max(1, match.items.length);
      const maxWidth = Math.max(2, match.endX - match.startX + 1);
      const fontSize = fitOverlayFontSize(font, plan.targetText, preferredFontSize, maxWidth);
      const minY = Math.min(...match.items.map((item) => item.y - item.height * 0.25));
      const maxY = Math.max(...match.items.map((item) => item.y + item.height * 0.9));
      const rectY = Math.max(0, minY - 0.5);
      const rectHeight = Math.max(fontSize * 1.25, maxY - minY + 1);

      operations.push({
        pageIndex: line.pageIndex,
        x: Math.max(0, match.startX - 0.5),
        y: rectY,
        width: Math.max(1, maxWidth + 1),
        height: rectHeight,
        text: plan.targetText,
        fontSize,
        textY: rectY + Math.max(0, (rectHeight - fontSize) / 2),
      });
    });
  });

  if (replacementCount === 0) {
    return {
      bytes: Uint8Array.from(bytes),
      replacementCount: 0,
    };
  }

  const pages = pdf.getPages();
  operations
    .sort((left, right) => (left.pageIndex - right.pageIndex) || (right.y - left.y) || (left.x - right.x))
    .forEach((operation) => {
      const page = pages[operation.pageIndex];
      page.drawRectangle({
        x: operation.x,
        y: operation.y,
        width: operation.width,
        height: operation.height,
        color: rgb(1, 1, 1),
      });
      page.drawText(operation.text, {
        x: operation.x,
        y: operation.textY,
        size: operation.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    });

  return {
    bytes: Uint8Array.from(await pdf.save()),
    replacementCount,
  };
}
