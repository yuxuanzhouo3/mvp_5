"use client";

import React, { useState } from "react";
import { Badge } from "./ui/badge";
import { useLanguage } from "@/context/LanguageContext";

interface QuotaDisplayProps {
  user: any;
  plan?: "basic" | "pro" | "enterprise" | "free";
  className?: string;
}

export function QuotaDisplay({ user, plan = "free", className = "" }: QuotaDisplayProps) {
  const { currentLanguage } = useLanguage();
  const isZh = currentLanguage === "zh";
  const [showDetails, setShowDetails] = useState(false);

  if (!user) {
    return null;
  }

  // 模拟配额数据
  const quotaData = {
    free: {
      daily: { used: 5, limit: 10, remaining: 5 },
      monthlyImage: { used: 3, limit: 20, remaining: 17 },
      monthlyVideo: { used: 1, limit: 5, remaining: 4 },
    },
    basic: {
      daily: { used: 45, limit: 100, remaining: 55 },
      monthlyImage: { used: 80, limit: 200, remaining: 120 },
      monthlyVideo: { used: 25, limit: 60, remaining: 35 },
    },
    pro: {
      daily: { used: 150, limit: 300, remaining: 150 },
      monthlyImage: { used: 250, limit: 600, remaining: 350 },
      monthlyVideo: { used: 80, limit: 180, remaining: 100 },
    },
    enterprise: {
      daily: { used: 500, limit: 1000, remaining: 500 },
      monthlyImage: { used: 800, limit: 2000, remaining: 1200 },
      monthlyVideo: { used: 200, limit: 500, remaining: 300 },
    },
  };

  const currentQuota = quotaData[plan];
  const dailyPercent = (currentQuota.daily.remaining / currentQuota.daily.limit) * 100;
  const imagePercent = (currentQuota.monthlyImage.remaining / currentQuota.monthlyImage.limit) * 100;
  const videoPercent = (currentQuota.monthlyVideo.remaining / currentQuota.monthlyVideo.limit) * 100;

  const getColorClass = (percent: number) => {
    if (percent > 50) return "from-green-400 to-emerald-500";
    if (percent > 20) return "from-amber-400 to-orange-500";
    return "from-red-400 to-rose-500";
  };

  return (
    <div className={`relative ${className}`}>
      <Badge
        variant="outline"
        className="cursor-pointer bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:shadow-md transition-all"
        onClick={() => setShowDetails(!showDetails)}
      >
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
        </svg>
        {currentQuota.daily.remaining}/{currentQuota.daily.limit}
      </Badge>

      {showDetails && (
        <>
          {/* 遮罩层 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDetails(false)}
          />

          {/* 详情弹窗 */}
          <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-4">
              {/* 标题 */}
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                  {isZh ? "配额详情" : "Quota Details"}
                </h4>
                <Badge className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0">
                  {plan === "enterprise" ? (isZh ? "企业版" : "Enterprise") :
                   plan === "pro" ? (isZh ? "专业版" : "Pro") :
                   plan === "basic" ? (isZh ? "基础版" : "Basic") :
                   (isZh ? "免费版" : "Free")}
                </Badge>
              </div>

              {/* 每日外部模型配额 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    {isZh ? "每日外部模型" : "Daily External"}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {currentQuota.daily.remaining}/{currentQuota.daily.limit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${getColorClass(dailyPercent)} transition-all duration-300`}
                    style={{ width: `${dailyPercent}%` }}
                  />
                </div>
              </div>

              {/* 本月图片配额 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <svg className="w-4 h-4 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                    </svg>
                    {isZh ? "本月图片" : "Monthly Images"}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {currentQuota.monthlyImage.remaining}/{currentQuota.monthlyImage.limit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${getColorClass(imagePercent)} transition-all duration-300`}
                    style={{ width: `${imagePercent}%` }}
                  />
                </div>
              </div>

              {/* 本月视频/音频配额 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                    </svg>
                    {isZh ? "本月视频/音频" : "Monthly Video/Audio"}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {currentQuota.monthlyVideo.remaining}/{currentQuota.monthlyVideo.limit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${getColorClass(videoPercent)} transition-all duration-300`}
                    style={{ width: `${videoPercent}%` }}
                  />
                </div>
              </div>

              {/* 提示信息 */}
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {isZh
                    ? "每日配额在 0 点重置，月度配额在每月 1 日重置"
                    : "Daily quota resets at midnight, monthly quota resets on the 1st"}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
