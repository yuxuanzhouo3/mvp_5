"use client";

import React, { useMemo, useState } from "react";
import { getUIText, type UILanguage } from "@/lib/ui-text";

export interface GenerationItem {
  id: string;
  type: string;
  prompt: string;
}

interface OperationsDashboardProps {
  generations: GenerationItem[];
  currentLanguage: UILanguage;
}

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  generations,
  currentLanguage,
}) => {
  const text = getUIText(currentLanguage);
  const resultTitle = currentLanguage === "zh" ? "产出结果" : "Output Results";
  const [activeResultCategory, setActiveResultCategory] = useState<"generate" | "detect">("generate");
  const categoryLabel =
    currentLanguage === "zh"
      ? { generate: "AI生成", detect: "AI检测" }
      : { generate: "AI Generation", detect: "AI Detection" };

  const getCategoryByType = (type: string) =>
    type.startsWith("detect_") ? "detect" : "generate";

  const filteredGenerations = useMemo(
    () =>
      generations.filter(
        (generation) => getCategoryByType(generation.type) === activeResultCategory,
      ),
    [activeResultCategory, generations],
  );

  const emptyText =
    currentLanguage === "zh"
      ? activeResultCategory === "generate"
        ? "暂无AI生成记录"
        : "暂无AI检测记录"
      : activeResultCategory === "generate"
        ? "No AI generation records"
        : "No AI detection records";

  const typeLabelMap: Record<string, string> =
    currentLanguage === "zh"
      ? {
          text: "文档",
          image: "图片",
          audio: "音频",
          video: "视频",
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
          detect_text: "Docs Detection",
          detect_image: "Image Detection",
          detect_audio: "Audio Detection",
          detect_video: "Video Detection",
        };

  return (
    <section className="rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {resultTitle}
        </h2>
        <div className="inline-flex items-center rounded-lg p-1 bg-gray-100 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setActiveResultCategory("generate")}
            className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors ${
              activeResultCategory === "generate"
                ? "bg-blue-600 text-white"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {categoryLabel.generate}
          </button>
          <button
            type="button"
            onClick={() => setActiveResultCategory("detect")}
            className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors ${
              activeResultCategory === "detect"
                ? "bg-blue-600 text-white"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {categoryLabel.detect}
          </button>
        </div>
      </div>
      {filteredGenerations.length === 0 ? (
        <div className="flex-1 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-50/60 dark:bg-[#111827]/30">
          <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredGenerations.map((generation) => (
            <div
              key={generation.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-[#111827]/40 p-3"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {typeLabelMap[generation.type] || generation.type}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{generation.id}</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 leading-6 break-words">
                {generation.prompt}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default OperationsDashboard;
