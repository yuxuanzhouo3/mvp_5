"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DOCUMENT_FILE_FORMATS,
  getDocumentFormatLabel,
  type DocumentFileFormat,
} from "@/lib/document-formats";

interface ModelInfo {
  name: string;
}

interface ContentTypeInfo {
  label: string;
  icon: string;
  placeholder: string;
  category: "generate" | "edit" | "detect";
}

interface GuestQuotaView {
  limit: number;
  used: number;
  remaining: number;
}

interface AIOperationsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  isGenerating: boolean;
  model: string;
  onModelChange: (model: string) => void;
  availableModels: Record<string, ModelInfo>;
  contentTypes: Record<string, ContentTypeInfo>;
  currentLanguage: "zh" | "en";
  operationsTitle: string;
  generateText: string;
  generatingText: string;
  selectedDocumentFormats: DocumentFileFormat[];
  onToggleDocumentFormat: (format: DocumentFileFormat) => void;
  onGenerate: () => void;
  selectedFile: File | null;
  onSelectedFileChange: (file: File | null) => void;
  generationDisabledReason?: string | null;
  featureUnavailableReason?: string | null;
  isGuest?: boolean;
  guestQuota?: GuestQuotaView | null;
}

const AIOperations: React.FC<AIOperationsProps> = ({
  activeTab,
  setActiveTab,
  prompt,
  setPrompt,
  isGenerating,
  model,
  onModelChange,
  availableModels,
  contentTypes,
  currentLanguage,
  operationsTitle,
  generateText,
  generatingText,
  selectedDocumentFormats,
  onToggleDocumentFormat,
  onGenerate,
  selectedFile,
  onSelectedFileChange,
  generationDisabledReason,
  featureUnavailableReason,
  isGuest = false,
  guestQuota = null,
}) => {
  const currentType = contentTypes[activeTab];
  const [activeCategory, setActiveCategory] = useState<
    "generate" | "edit" | "detect"
  >(
    currentType?.category ?? "generate",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (currentType?.category && currentType.category !== activeCategory) {
      setActiveCategory(currentType.category);
    }
  }, [activeCategory, currentType?.category]);

  const visibleContentTypes = useMemo(
    () =>
      Object.entries(contentTypes).filter(
        ([, type]) => type.category === activeCategory,
      ),
    [activeCategory, contentTypes],
  );

  const handleCategorySwitch = (category: "generate" | "edit" | "detect") => {
    setActiveCategory(category);
    onSelectedFileChange(null);
    setPrompt("");
    if (currentType?.category === category) {
      return;
    }

    const firstKey = Object.entries(contentTypes).find(
      ([, type]) => type.category === category,
    )?.[0];
    if (firstKey) {
      setActiveTab(firstKey);
    }
  };

  const isDetectMode = activeCategory === "detect";
  const isEditMode = activeCategory === "edit";
  const isGuestUnsupportedUsage =
    isGuest && (activeCategory !== "generate" || activeTab !== "text");
  const requiresFileUpload = isDetectMode || isEditMode;
  const isDocumentGeneration = activeCategory === "generate" && activeTab === "text";
  useEffect(() => {
    if (!requiresFileUpload) {
      return;
    }

    onSelectedFileChange(null);
    setPrompt("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [activeTab, onSelectedFileChange, requiresFileUpload, setPrompt]);

  const acceptByTab: Record<string, string> = {
    edit_text: ".txt,.md,.docx,.xlsx",
    edit_image: "image/*",
    edit_audio: "audio/*",
    edit_video: "video/*",
    detect_text: ".txt,.md,.doc,.docx,.pdf",
    detect_image: "image/*",
    detect_audio: "audio/*",
    detect_video: "video/*",
  };
  const currentAccept = acceptByTab[activeTab] || "*/*";
  const detectButtonText = currentLanguage === "zh" ? "上传并检测" : "Upload & Detect";
  const detectingText = currentLanguage === "zh" ? "检测中..." : "Detecting...";
  const editButtonText = currentLanguage === "zh" ? "上传并编辑" : "Upload & Edit";
  const editingText = currentLanguage === "zh" ? "编辑中..." : "Editing...";
  const canGenerate = featureUnavailableReason
    ? false
    : isGuestUnsupportedUsage
    ? false
    : isDetectMode
      ? Boolean(selectedFile)
      : isEditMode
        ? Boolean(selectedFile) && prompt.trim().length > 0
        : prompt.trim().length > 0 &&
          (!isDocumentGeneration ||
            selectedDocumentFormats.length === 1) &&
          !generationDisabledReason;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    onSelectedFileChange(file);
    if (isDetectMode) {
      setPrompt(
        currentLanguage === "zh"
          ? `检测文件：${file.name}`
          : `Detect file: ${file.name}`,
      );
      return;
    }

    if (isEditMode && prompt.trim().length === 0) {
      setPrompt(
        currentLanguage === "zh"
          ? `编辑文件：${file.name}\n编辑要求：`
          : `Edit file: ${file.name}\nInstructions:`,
      );
    }
  };

  const uploadTitle = isDetectMode
    ? currentLanguage === "zh"
      ? `上传${currentType?.label || "文件"}进行检测`
      : `Upload ${currentType?.label || "file"} for detection`
    : currentLanguage === "zh"
      ? `上传${currentType?.label || "文件"}进行编辑`
      : `Upload ${currentType?.label || "file"} for editing`;

  const uploadCardClassName = isDetectMode
    ? "w-full h-44 sm:h-52 lg:h-auto lg:min-h-[240px] lg:flex-1"
    : "w-full";

  const uploadPanel = (
    <div
      className={`${uploadCardClassName} rounded-xl border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/10 p-4 sm:p-6 flex flex-col items-center justify-center text-center gap-3`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={currentAccept}
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="text-3xl">📤</div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {uploadTitle}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {currentLanguage === "zh"
            ? "支持拖拽上传或点击选择文件"
            : "Drag and drop or click to choose a file"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="h-10 sm:h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
      >
        {currentLanguage === "zh" ? "选择文件" : "Choose File"}
      </button>
      {selectedFile && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200">
          <span className="max-w-[180px] sm:max-w-[260px] truncate">{selectedFile.name}</span>
          <button
            type="button"
            className="text-red-500 hover:text-red-600"
            onClick={() => {
              onSelectedFileChange(null);
              if (isDetectMode) {
                setPrompt("");
              }
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
              }
            }}
          >
            {currentLanguage === "zh" ? "移除" : "Remove"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section className="rounded-xl sm:rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-6 h-full min-h-0 overflow-hidden flex flex-col">
      <div className="min-h-0 flex-1 flex flex-col gap-4 sm:gap-5 overflow-y-auto pr-1">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {operationsTitle}
        </h2>
        <select
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="h-10 sm:h-9 w-full sm:w-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 text-sm px-3 text-gray-700 dark:text-gray-200"
        >
          {Object.entries(availableModels).map(([key, model]) => (
            <option key={key} value={key}>
              {model.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center rounded-xl p-1 bg-gray-100 dark:bg-gray-800 w-full sm:w-fit">
        <button
          type="button"
          onClick={() => handleCategorySwitch("generate")}
          className={`h-10 sm:h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
            activeCategory === "generate"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          {currentLanguage === "zh" ? "AI生成" : "AI Generation"}
        </button>
        <button
          type="button"
          onClick={() => handleCategorySwitch("edit")}
          title={
            isGuest
              ? currentLanguage === "zh"
                ? "游客可浏览，登录后可使用 AI 编辑"
                : "Guests can browse, sign in to use AI Editing"
              : undefined
          }
          className={`h-10 sm:h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
            activeCategory === "edit"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          {currentLanguage === "zh" ? "AI编辑" : "AI Editing"}
        </button>
        <button
          type="button"
          onClick={() => handleCategorySwitch("detect")}
          title={
            isGuest
              ? currentLanguage === "zh"
                ? "游客可浏览，登录后可使用 AI 检测"
                : "Guests can browse, sign in to use AI Detection"
              : undefined
          }
          className={`h-10 sm:h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
            activeCategory === "detect"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          {currentLanguage === "zh" ? "AI检测" : "AI Detection"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        {visibleContentTypes.map(([key, type]) => {
          return (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-3 sm:px-4 py-2.5 sm:py-2 rounded-xl text-sm font-medium transition-colors w-full sm:w-auto ${
              activeTab === key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {type.icon} {type.label}
          </button>
          );
        })}
      </div>

      {isDocumentGeneration && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/30 p-3 sm:p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {currentLanguage === "zh"
                ? "每次仅生成 1 份文档结果，请选择输出格式"
                : "Each request returns exactly 1 document. Choose the output format."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {DOCUMENT_FILE_FORMATS.map((format) => {
              const selected = selectedDocumentFormats.includes(format);
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => onToggleDocumentFormat(format)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    selected
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-500"
                  }`}
                >
                  {getDocumentFormatLabel(format, currentLanguage)}
                </button>
              );
            })}
          </div>

          {isGuest && guestQuota && (
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {currentLanguage === "zh"
                ? `游客本月文档额度：${guestQuota.remaining}/${guestQuota.limit}`
                : `Guest monthly docs quota: ${guestQuota.remaining}/${guestQuota.limit}`}
            </p>
          )}

          {selectedDocumentFormats.length === 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {currentLanguage === "zh"
                ? "请至少选择一种文档格式。"
                : "Please select at least one document format."}
            </p>
          )}

          {selectedDocumentFormats.length !== 1 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {currentLanguage === "zh"
                ? "每次必须且仅能选择一种文档格式。"
                : "Exactly one document format is required for each request."}
            </p>
          )}
        </div>
      )}

      {isDetectMode ? (
        uploadPanel
      ) : isEditMode ? (
        <div className="w-full lg:flex-1 lg:min-h-[240px] flex flex-col gap-3">
          {uploadPanel}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={currentType?.placeholder}
            className="w-full h-36 sm:h-40 lg:flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 p-4 text-sm text-gray-900 dark:text-gray-100 resize-none transition-colors focus:outline-none focus:ring-0 focus:border-blue-400 dark:focus:border-blue-500"
          />
        </div>
      ) : (
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={currentType?.placeholder}
          className="w-full h-44 sm:h-52 lg:h-auto lg:min-h-[240px] lg:flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 p-4 text-sm text-gray-900 dark:text-gray-100 resize-none transition-colors focus:outline-none focus:ring-0 focus:border-blue-400 dark:focus:border-blue-500"
        />
      )}

      {featureUnavailableReason && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {featureUnavailableReason}
        </p>
      )}
      {isGuestUnsupportedUsage && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {currentLanguage === "zh"
            ? "当前仅可浏览，游客仅支持文档生成。请登录后使用该功能。"
            : "Browse only. Guest mode supports doc generation only. Please sign in to use this feature."}
        </p>
      )}

      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating || !canGenerate}
        className="mt-4 sm:mt-5 w-full shrink-0 h-12 sm:h-11 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold transition-colors"
      >
        {isGenerating
          ? isDetectMode
            ? detectingText
            : isEditMode
              ? editingText
              : generatingText
          : isDetectMode
            ? detectButtonText
            : isEditMode
              ? editButtonText
              : generateText}
      </button>
    </section>
  );
};

export default AIOperations;



