"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

interface ModelInfo {
  name: string;
}

interface ContentTypeInfo {
  label: string;
  icon: string;
  placeholder: string;
  category: "generate" | "detect";
}

interface AIOperationsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  isGenerating: boolean;
  settings: {
    temperature: number;
    maxTokens: number;
    model: string;
  };
  setSettings: (settings: {
    temperature: number;
    maxTokens: number;
    model: string;
  }) => void;
  availableModels: Record<string, ModelInfo>;
  contentTypes: Record<string, ContentTypeInfo>;
  currentLanguage: "zh" | "en";
  operationsTitle: string;
  temperatureLabel: string;
  maxTokensLabel: string;
  generateText: string;
  generatingText: string;
  onGenerate: () => void;
}

const AIOperations: React.FC<AIOperationsProps> = ({
  activeTab,
  setActiveTab,
  prompt,
  setPrompt,
  isGenerating,
  settings,
  setSettings,
  availableModels,
  contentTypes,
  currentLanguage,
  operationsTitle,
  temperatureLabel,
  maxTokensLabel,
  generateText,
  generatingText,
  onGenerate,
}) => {
  const currentType = contentTypes[activeTab];
  const [activeCategory, setActiveCategory] = useState<"generate" | "detect">(
    currentType?.category ?? "generate",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  const handleCategorySwitch = (category: "generate" | "detect") => {
    setActiveCategory(category);
    setSelectedFile(null);
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

  useEffect(() => {
    if (!isDetectMode) {
      return;
    }
    setSelectedFile(null);
    setPrompt("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [activeTab, isDetectMode, setPrompt]);
  const acceptByTab: Record<string, string> = {
    detect_text: ".txt,.md,.doc,.docx,.pdf",
    detect_image: "image/*",
    detect_audio: "audio/*",
    detect_video: "video/*",
  };
  const currentAccept = acceptByTab[activeTab] || "*/*";
  const detectButtonText =
    currentLanguage === "zh" ? "上传并检测" : "Upload & Detect";
  const detectingText =
    currentLanguage === "zh" ? "检测中..." : "Detecting...";

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setSelectedFile(file);
    setPrompt(
      currentLanguage === "zh"
        ? `检测文件：${file.name}`
        : `Detect file: ${file.name}`,
    );
  };

  return (
    <section className="rounded-xl sm:rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-6 h-full flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {operationsTitle}
        </h2>
        <select
          value={settings.model}
          onChange={(event) =>
            setSettings({ ...settings, model: event.target.value })
          }
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
          onClick={() => handleCategorySwitch("detect")}
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
        {visibleContentTypes.map(([key, type]) => (
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
        ))}
      </div>

      {isDetectMode ? (
        <div className="w-full h-44 sm:h-52 lg:h-auto lg:min-h-[240px] lg:flex-1 rounded-xl border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/10 p-4 sm:p-6 flex flex-col items-center justify-center text-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={currentAccept}
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="text-3xl">📁</div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {currentLanguage === "zh"
                ? `上传${currentType?.label || "文件"}进行检测`
                : `Upload ${currentType?.label || "file"} for detection`}
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
                  setSelectedFile(null);
                  setPrompt("");
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
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={currentType?.placeholder}
            className="w-full h-44 sm:h-52 lg:h-auto lg:min-h-[240px] lg:flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 p-4 text-sm text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600 dark:text-gray-300">
              {temperatureLabel}: {settings.temperature.toFixed(1)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    temperature: Number(event.target.value),
                  })
                }
                className="w-full mt-1 accent-blue-600"
              />
            </label>

            <label className="text-xs text-gray-600 dark:text-gray-300">
              {maxTokensLabel}: {settings.maxTokens}
              <input
                type="range"
                min={200}
                max={2000}
                step={100}
                value={settings.maxTokens}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxTokens: Number(event.target.value),
                  })
                }
                className="w-full mt-1 accent-blue-600"
              />
            </label>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating || (isDetectMode ? !selectedFile : prompt.trim().length === 0)}
        className="w-full h-12 sm:h-11 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold transition-colors"
      >
        {isGenerating
          ? isDetectMode
            ? detectingText
            : generatingText
          : isDetectMode
            ? detectButtonText
            : generateText}
      </button>
    </section>
  );
};

export default AIOperations;
