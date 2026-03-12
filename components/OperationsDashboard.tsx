"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { GenerationItem } from "@/lib/ai-generation";
import { type UILanguage } from "@/lib/ui-text";

interface OperationsDashboardProps {
  generations: GenerationItem[];
  currentLanguage: UILanguage;
  targetResultView?: {
    category: ResultCategory;
    folder: ResultFolder;
    key: number;
  } | null;
  canDeletePersistedResults?: boolean;
  deletingGenerationIds?: string[];
  onDeleteGeneration?: (generation: GenerationItem) => void | Promise<void>;
}

export type ResultCategory = "generate" | "edit" | "detect";
export type ResultFolder = "all" | "text" | "image" | "audio" | "video";

const ACTION_BUTTON_CLASS_NAME =
  "inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-blue-600 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-300";

function getFileExtension(value: string) {
  const matched = value.trim().match(/\.([a-z0-9]{1,8})(?:$|[?#])/i);
  return matched?.[1]?.toLowerCase() ?? "";
}

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  generations,
  currentLanguage,
  targetResultView,
  canDeletePersistedResults = false,
  deletingGenerationIds = [],
  onDeleteGeneration,
}) => {
  const resultTitle = currentLanguage === "zh" ? "输出结果" : "Output Results";
  const [activeResultCategory, setActiveResultCategory] = useState<ResultCategory>("generate");
  const [activeResultFolder, setActiveResultFolder] = useState<ResultFolder>("all");

  const categoryLabel =
    currentLanguage === "zh"
      ? { generate: "AI生成", edit: "AI编辑", detect: "AI检测" }
      : { generate: "AI Generation", edit: "AI Editing", detect: "AI Detection" };

  const getCategoryByType = (type: string) => {
    if (type.startsWith("detect_")) {
      return "detect";
    }

    if (type.startsWith("edit_")) {
      return "edit";
    }

    return "generate";
  };

  const folderTypeMap: Record<ResultCategory, Record<Exclude<ResultFolder, "all">, string[]>> = {
    generate: {
      text: ["text"],
      image: ["image"],
      audio: ["audio"],
      video: ["video"],
    },
    edit: {
      text: ["edit_text"],
      image: ["edit_image"],
      audio: ["edit_audio"],
      video: ["edit_video"],
    },
    detect: {
      text: ["detect_text"],
      image: ["detect_image"],
      audio: ["detect_audio"],
      video: ["detect_video"],
    },
  };

  useEffect(() => {
    if (!targetResultView) {
      return;
    }

    setActiveResultCategory(targetResultView.category);
    setActiveResultFolder(targetResultView.folder);
  }, [targetResultView]);

  const filteredGenerations = useMemo(
    () =>
      generations.filter(
        (generation) => {
          if (getCategoryByType(generation.type) !== activeResultCategory) {
            return false;
          }

          if (activeResultFolder === "all") {
            return true;
          }

          return folderTypeMap[activeResultCategory][activeResultFolder].includes(generation.type);
        },
      ),
    [activeResultCategory, activeResultFolder, generations],
  );

  const emptyText =
    currentLanguage === "zh"
      ? activeResultCategory === "generate"
        ? "暂无 AI 生成记录"
        : activeResultCategory === "edit"
          ? "暂无 AI 编辑记录"
          : "暂无 AI 检测记录"
      : activeResultCategory === "generate"
        ? "No AI generation records"
        : activeResultCategory === "edit"
          ? "No AI editing records"
          : "No AI detection records";

  const typeLabelMap: Record<string, string> =
    currentLanguage === "zh"
      ? {
          text: "文档",
          image: "图片",
          audio: "音频",
          video: "视频",
          edit_text: "文档编辑",
          edit_image: "图片编辑",
          edit_audio: "音频编辑",
          edit_video: "视频编辑",
          detect_text: "文档检测",
          detect_image: "图片检测",
          detect_audio: "音频检测",
          detect_video: "视频检测",
        }
      : {
          text: "Docs",
          image: "Image",
          audio: "Audio",
          video: "Video",
          edit_text: "Docs Editing",
          edit_image: "Image Editing",
          edit_audio: "Audio Editing",
          edit_video: "Video Editing",
          detect_text: "Docs Detection",
          detect_image: "Image Detection",
          detect_audio: "Audio Detection",
          detect_video: "Video Detection",
        };
  const previewLabel = currentLanguage === "zh" ? "预览" : "Preview";
  const downloadLabel = currentLanguage === "zh" ? "下载" : "Download";
  const exportFilesLabel = currentLanguage === "zh" ? "导出文件" : "Export Files";
  const closePreviewLabel = currentLanguage === "zh" ? "关闭" : "Close";
  const previewAltText = currentLanguage === "zh" ? "图片预览" : "Image preview";
  const deleteLabel = currentLanguage === "zh" ? "删除" : "Delete";
  const deletingLabel = currentLanguage === "zh" ? "删除中..." : "Deleting...";
  const folderLabelMap: Record<ResultFolder, string> =
    currentLanguage === "zh"
      ? {
          all: "全部",
          text: "文档",
          image: "图片",
          audio: "音频",
          video: "视频",
        }
      : {
          all: "All",
          text: "Docs",
          image: "Images",
          audio: "Audio",
          video: "Videos",
        };
  const folderList: ResultFolder[] = ["all", "text", "image", "audio", "video"];
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);

  const handleResultCategorySwitch = (category: ResultCategory) => {
    setActiveResultCategory(category);
    setActiveResultFolder("all");
  };

  const getDocumentDownloadLabel = (value: string) => {
    const extension = getFileExtension(value);
    if (currentLanguage === "zh") {
      switch (extension) {
        case "docx":
          return "下载 Word 文档";
        case "pdf":
          return "下载 PDF 文档";
        case "xlsx":
          return "下载 Excel 表格";
        case "txt":
          return "下载 TXT 文本";
        case "md":
          return "下载 Markdown";
        default:
          return "下载文档";
      }
    }

    switch (extension) {
      case "docx":
        return "Download Word";
      case "pdf":
        return "Download PDF";
      case "xlsx":
        return "Download Excel";
      case "txt":
        return "Download TXT";
      case "md":
        return "Download Markdown";
      default:
        return "Download File";
    }
  };

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage]);

  return (
    <>
      <section className="rounded-xl sm:rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-5 h-full overflow-hidden flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
          {resultTitle}
        </h2>
        <div className="inline-flex items-center rounded-lg p-1 bg-gray-100 dark:bg-gray-800 w-full sm:w-fit">
          <button
            type="button"
            onClick={() => handleResultCategorySwitch("generate")}
            className={`h-8 sm:h-7 px-3 rounded-md text-xs font-semibold transition-colors flex-1 sm:flex-none ${
              activeResultCategory === "generate"
                ? "bg-blue-600 text-white"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {categoryLabel.generate}
          </button>
          <button
            type="button"
            onClick={() => handleResultCategorySwitch("edit")}
            className={`h-8 sm:h-7 px-3 rounded-md text-xs font-semibold transition-colors flex-1 sm:flex-none ${
              activeResultCategory === "edit"
                ? "bg-blue-600 text-white"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {categoryLabel.edit}
          </button>
          <button
            type="button"
            onClick={() => handleResultCategorySwitch("detect")}
            className={`h-8 sm:h-7 px-3 rounded-md text-xs font-semibold transition-colors flex-1 sm:flex-none ${
              activeResultCategory === "detect"
                ? "bg-blue-600 text-white"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {categoryLabel.detect}
          </button>
        </div>
      </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {folderList.map((folder) => (
            <button
              key={folder}
              type="button"
              onClick={() => setActiveResultFolder(folder)}
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                activeResultFolder === folder
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {folderLabelMap[folder]}
            </button>
          ))}
        </div>

        {filteredGenerations.length === 0 ? (
          <div className="flex-1 min-h-[180px] rounded-xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-50/60 dark:bg-[#111827]/30">
            <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {filteredGenerations.map((generation) => {
              const isDeleting = deletingGenerationIds.includes(generation.id);
              const canDelete =
                canDeletePersistedResults &&
                Boolean(onDeleteGeneration) &&
                !generation.id.startsWith("err_");

              return (
              <div
                key={generation.id}
                className={`rounded-xl border p-3 ${
                  generation.status === "error"
                    ? "border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/20"
                    : "border-gray-200 bg-white/70 dark:border-gray-700 dark:bg-[#111827]/40"
                }`}
              >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      generation.status === "error"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    }`}
                  >
                    {typeLabelMap[generation.type] || generation.type}
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {generation.modelLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {new Date(generation.createdAt).toLocaleString(
                      currentLanguage === "zh" ? "zh-CN" : "en-US",
                    )}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDeleteGeneration?.(generation)}
                      disabled={isDeleting}
                      className="inline-flex items-center rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] text-red-600 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300"
                    >
                      {isDeleting ? deletingLabel : deleteLabel}
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-700 dark:text-gray-200 leading-6 break-words">
                {generation.prompt}
              </p>

              {generation.summary && (
                <p
                  className={`mt-2 text-sm leading-6 ${
                    generation.status === "error"
                      ? "text-red-700 dark:text-red-300"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {generation.summary}
                </p>
              )}

              {generation.text && (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-xs leading-6 text-gray-700 dark:bg-gray-900/70 dark:text-gray-200">
                  {generation.text}
                </pre>
              )}

              {generation.errorMessage && (
                <p className="mt-2 text-sm leading-6 text-red-700 dark:text-red-300">
                  {generation.errorMessage}
                </p>
              )}

              {(generation.type === "text" || generation.type === "edit_text") &&
                generation.downloadLinks &&
                generation.downloadLinks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {generation.downloadLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      title={link.label}
                      className={ACTION_BUTTON_CLASS_NAME}
                    >
                      {exportFilesLabel} · {getDocumentDownloadLabel(link.label || link.url)}
                    </a>
                  ))}
                </div>
              )}

                {generation.imageUrls && generation.imageUrls.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {generation.imageUrls.map((url, index) => {
                      const downloadUrl = generation.downloadLinks?.[index]?.url ?? url;

                      return (
                        <div
                          key={`${generation.id}-${index}`}
                          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/50"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewImage({ url, alt: generation.prompt })}
                            className="block w-full"
                          >
                            <img
                              src={url}
                              alt={generation.prompt}
                              className="max-h-64 w-full object-cover"
                            />
                          </button>
                          <div className="flex gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
                            <button
                              type="button"
                              onClick={() => setPreviewImage({ url, alt: generation.prompt })}
                              className={ACTION_BUTTON_CLASS_NAME}
                            >
                              {previewLabel}
                            </button>
                            <a
                              href={downloadUrl}
                              className={ACTION_BUTTON_CLASS_NAME}
                            >
                              {downloadLabel}
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              {generation.audioUrls && generation.audioUrls.length > 0 && (
                <div className="mt-3 space-y-3">
                  {generation.audioUrls.map((url, index) => {
                    const downloadUrl = generation.downloadLinks?.[index]?.url ?? url;

                    return (
                      <div key={`${generation.id}-audio-${index}`} className="space-y-2">
                        <audio
                          controls
                          preload="none"
                          src={url}
                          className="w-full rounded-lg"
                        />
                        <a href={downloadUrl} className={ACTION_BUTTON_CLASS_NAME}>
                          {downloadLabel}
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}

              {generation.videoUrls && generation.videoUrls.length > 0 && (
                <div className="mt-3 space-y-3">
                  {generation.videoUrls.map((url, index) => {
                    const downloadUrl = generation.downloadLinks?.[index]?.url ?? url;

                    return (
                      <div key={`${generation.id}-video-${index}`} className="space-y-2">
                        <video
                          controls
                          playsInline
                          src={url}
                          className="max-h-72 w-full rounded-lg border border-gray-200 dark:border-gray-700"
                        />
                        <a href={downloadUrl} className={ACTION_BUTTON_CLASS_NAME}>
                          {downloadLabel}
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            );
            })}
          </div>
        )}
      </section>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 rounded-lg bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/75"
          >
            {closePreviewLabel}
          </button>
          <img
            src={previewImage.url}
            alt={previewImage.alt || previewAltText}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};

export default OperationsDashboard;
