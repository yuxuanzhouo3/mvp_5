"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCUMENT_FILE_FORMATS = void 0;
exports.isDocumentFileFormat = isDocumentFileFormat;
exports.getDocumentFormatLabel = getDocumentFormatLabel;
exports.DOCUMENT_FILE_FORMATS = ["docx", "pdf", "xlsx", "txt", "md"];
function isDocumentFileFormat(value) {
    return (typeof value === "string" &&
        exports.DOCUMENT_FILE_FORMATS.includes(value));
}
function getDocumentFormatLabel(format, language) {
    const labels = {
        pdf: { zh: "PDF", en: "PDF" },
        xlsx: { zh: "Excel", en: "Excel" },
        docx: { zh: "Word", en: "Word" },
        txt: { zh: "TXT", en: "TXT" },
        md: { zh: "Markdown", en: "Markdown" },
    };
    return labels[format][language];
}
