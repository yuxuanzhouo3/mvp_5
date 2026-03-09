"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AIOperations from "./AIOperations";
import OperationsDashboard, {
  type ResultCategory,
  type ResultFolder,
} from "./OperationsDashboard";
import LanguageThemeToggle from "./LanguageThemeToggle";
import AuthSystem, { type AuthFormState, type AuthMode } from "./AuthSystem";
import PaymentSystem, { type BillingPeriod, type PlanKey } from "./PaymentSystem";
import { Badge } from "./ui/badge";
import { useLanguage } from "@/context/LanguageContext";
import {
  getDefaultModelIdForTab,
  getGenerationModelLabel,
  getGenerationModelOptions,
  getGenerationUnavailableMessage,
  isConnectedGenerationTab,
  type GenerationItem,
  type GenerationTab,
} from "@/lib/ai-generation";
import {
  DOCUMENT_FILE_FORMATS,
  type DocumentFileFormat,
} from "@/lib/document-formats";
import { getUIText } from "@/lib/ui-text";

type UserPlan = "free" | PlanKey;

interface DashboardUser {
  name: string;
  email: string;
  plan: UserPlan;
  planExp: string | null;
}

interface QuotaPreset {
  dailyLimit: number;
  imageLimit: number;
  videoLimit: number;
  addonImage: number;
  addonVideo: number;
}

const quotaByPlan: Record<UserPlan, QuotaPreset> = {
  free: {
    dailyLimit: 10,
    imageLimit: 20,
    videoLimit: 5,
    addonImage: 0,
    addonVideo: 0,
  },
  basic: {
    dailyLimit: 100,
    imageLimit: 200,
    videoLimit: 60,
    addonImage: 100,
    addonVideo: 30,
  },
  pro: {
    dailyLimit: 300,
    imageLimit: 600,
    videoLimit: 180,
    addonImage: 260,
    addonVideo: 90,
  },
  enterprise: {
    dailyLimit: 1200,
    imageLimit: 2000,
    videoLimit: 600,
    addonImage: 800,
    addonVideo: 240,
  },
};

function getResultCategoryByTab(tab: string): ResultCategory {
  if (tab.startsWith("detect_")) {
    return "detect";
  }

  if (tab.startsWith("edit_")) {
    return "edit";
  }

  return "generate";
}

function getResultFolderByTab(tab: string): ResultFolder {
  if (tab.endsWith("image")) {
    return "image";
  }

  if (tab.endsWith("audio")) {
    return "audio";
  }

  if (tab.endsWith("video")) {
    return "video";
  }

  return "text";
}

const AIGeneratorPlatform: React.FC = () => {
  const { currentLanguage, setCurrentLanguage, isDomesticVersion } =
    useLanguage();
  const text = getUIText(currentLanguage);

  const [activeTab, setActiveTab] = useState("text");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<GenerationItem[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [model, setModel] = useState("auto");
  const [selectedDocumentFormats, setSelectedDocumentFormats] = useState<DocumentFileFormat[]>(["docx"]);
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<AuthFormState>({
    name: "",
    email: "",
    password: "",
    verificationCode: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("pro");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showTierQuota, setShowTierQuota] = useState(false);
  const [targetResultView, setTargetResultView] = useState<{
    category: ResultCategory;
    folder: ResultFolder;
    key: number;
  } | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const tierQuotaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("morngpt_theme");
    const shouldUseDark = savedTheme === "dark";
    setIsDarkMode(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowAuthDialog(false);
      setShowSubscriptionDialog(false);
      setShowUserMenu(false);
      setShowTierQuota(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
      if (tierQuotaRef.current && !tierQuotaRef.current.contains(target)) {
        setShowTierQuota(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    localStorage.setItem("morngpt_theme", nextDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", nextDark);
  };

  const getPlanExpiry = (period: BillingPeriod) => {
    const date = new Date();
    date.setDate(date.getDate() + (period === "annual" ? 365 : 30));
    return date.toISOString();
  };

  useEffect(() => {
    const availableKeys = new Set(
      isConnectedGenerationTab(activeTab)
        ? Object.keys(getGenerationModelOptions(activeTab, currentLanguage))
        : ["auto"],
    );

    if (!availableKeys.has(model)) {
      setModel("auto");
    }
  }, [activeTab, currentLanguage, model]);

  const generationDisabledReason = useMemo(
    () =>
      isConnectedGenerationTab(activeTab)
        ? getGenerationUnavailableMessage(activeTab, currentLanguage)
        : null,
    [activeTab, currentLanguage],
  );

  const handleToggleDocumentFormat = (format: DocumentFileFormat) => {
    setSelectedDocumentFormats((previous) =>
      previous.includes(format)
        ? previous.filter((item) => item !== format)
        : [...previous, format],
    );
  };

  const handleSelectAllDocumentFormats = () => {
    setSelectedDocumentFormats([...DOCUMENT_FILE_FORMATS]);
  };

  const handleClearAllDocumentFormats = () => {
    setSelectedDocumentFormats([]);
  };

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    if (activeTab === "text" && selectedDocumentFormats.length === 0) {
      return;
    }

    setTargetResultView({
      category: getResultCategoryByTab(activeTab),
      folder: getResultFolderByTab(activeTab),
      key: Date.now(),
    });

    if (isConnectedGenerationTab(activeTab) && generationDisabledReason) {
      const modelId =
        model === "auto"
          ? getDefaultModelIdForTab(activeTab as GenerationTab)
          : model;

      setGenerations((previous) => [
        {
          id: `err_${Date.now()}`,
          type: activeTab as GenerationTab,
          prompt: trimmedPrompt,
          modelId,
          modelLabel: getGenerationModelLabel(modelId),
          provider: "system",
          status: "error",
          summary: currentLanguage === "zh" ? "生成失败" : "Generation failed",
          errorMessage: generationDisabledReason,
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ]);
      return;
    }

    setIsGenerating(true);

    if (!isConnectedGenerationTab(activeTab)) {
      const summary =
        activeTab.startsWith("edit_")
          ? currentLanguage === "zh"
            ? "编辑功能当前为 UI 演示，尚未接入后端模型。"
            : "Editing is currently UI-only and not connected to a backend model yet."
          : activeTab.startsWith("detect_")
            ? currentLanguage === "zh"
              ? "检测功能当前为 UI 演示，尚未接入后端模型。"
              : "Detection is currently UI-only and not connected to a backend model yet."
            : currentLanguage === "zh"
              ? "当前类型仍为 UI 演示，尚未接入后端模型。"
              : "This category is still UI-only and not connected to a backend model yet.";

      window.setTimeout(() => {
        setGenerations((previous) => [
          {
            id: `demo_${Date.now()}`,
            type: activeTab as GenerationTab,
            prompt: trimmedPrompt,
            modelId: "ui-demo",
            modelLabel: currentLanguage === "zh" ? "演示模式" : "UI Demo",
            provider: "demo",
            status: "success",
            summary,
            createdAt: new Date().toISOString(),
          },
          ...previous,
        ]);
        setIsGenerating(false);
        setPrompt("");
      }, 400);
      return;
    }

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: activeTab,
          prompt: trimmedPrompt,
          model,
          formats: activeTab === "text" ? selectedDocumentFormats : undefined,
        }),
      });

      const payload = (await response.json()) as GenerationItem | { message?: string };
      if (!response.ok) {
        throw new Error(
          "message" in payload && typeof payload.message === "string"
            ? payload.message
            : currentLanguage === "zh"
              ? `请求失败（HTTP ${response.status}）`
              : `Request failed (HTTP ${response.status})`,
        );
      }

      setGenerations((previous) => [payload as GenerationItem, ...previous]);
      setPrompt("");
    } catch (error) {
      const modelId =
        model === "auto"
          ? getDefaultModelIdForTab(activeTab as GenerationTab)
          : model;

      setGenerations((previous) => [
        {
          id: `err_${Date.now()}`,
          type: activeTab as GenerationTab,
          prompt: trimmedPrompt,
          modelId,
          modelLabel: getGenerationModelLabel(modelId),
          provider: "system",
          status: "error",
          summary: currentLanguage === "zh" ? "生成失败" : "Generation failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : currentLanguage === "zh"
                ? "请求失败，请稍后重试。"
                : "Request failed. Please try again later.",
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAuthSubmit = () => {
    if (authMode === "reset") {
      setAuthMode("login");
      return;
    }

    const fallbackName =
      authForm.email.split("@")[0] || (currentLanguage === "zh" ? "鐢ㄦ埛" : "User");
    const nextUser: DashboardUser = {
      name: authForm.name || fallbackName,
      email: authForm.email || "demo@mornstudio.ai",
      plan: selectedPlan,
      planExp: getPlanExpiry(billingPeriod),
    };
    setUser(nextUser);
    setShowAuthDialog(false);
  };

  const handleLogout = () => {
    setUser(null);
    setShowUserMenu(false);
    setAuthMode("login");
    setAuthForm({
      name: "",
      email: "",
      password: "",
      verificationCode: "",
    });
  };

  const handleSubscribe = () => {
    if (!user) {
      setAuthMode("login");
      setShowAuthDialog(true);
      return;
    }
    setUser({
      ...user,
      plan: selectedPlan,
      planExp: getPlanExpiry(billingPeriod),
    });
    setShowSubscriptionDialog(false);
  };

  const availableModels = useMemo<Record<string, { name: string }>>(() => {
    if (isConnectedGenerationTab(activeTab)) {
      return getGenerationModelOptions(activeTab, currentLanguage);
    }

    return {
      auto: {
        name: currentLanguage === "zh" ? "演示模式" : "Demo Mode",
      },
    };
  }, [activeTab, currentLanguage]);

  const contentTypes = useMemo(
    () => ({
      text: {
        label: currentLanguage === "zh" ? "文档" : "Docs",
        icon: "📝",
        placeholder: text.promptPlaceholderText,
        category: "generate" as const,
      },
      image: {
        label: currentLanguage === "zh" ? "图片" : "Image",
        icon: "🖼️",
        placeholder: text.promptPlaceholderImage,
        category: "generate" as const,
      },
      audio: {
        label: currentLanguage === "zh" ? "音频" : "Audio",
        icon: "🎵",
        placeholder:
          currentLanguage === "zh"
            ? "输入一句话生成音频，例如：舒缓钢琴、赛博鼓点、电影预告配乐"
            : "Describe the audio you want, for example: calm piano, cyberpunk beat, cinematic trailer music",
        category: "generate" as const,
      },
      video: {
        label: currentLanguage === "zh" ? "视频" : "Video",
        icon: "🎬",
        placeholder: text.promptPlaceholderVideo,
        category: "generate" as const,
      },
      edit_text: {
        label: currentLanguage === "zh" ? "文档" : "Docs",
        icon: "📝",
        placeholder:
          currentLanguage === "zh"
            ? "上传文档后输入编辑要求，例如：提炼为三段摘要并修正错别字"
            : "Upload a document and describe edits, for example: summarize into 3 paragraphs and fix grammar",
        category: "edit" as const,
      },
      edit_image: {
        label: currentLanguage === "zh" ? "图片" : "Image",
        icon: "🖼️",
        placeholder:
          currentLanguage === "zh"
            ? "上传图片后输入编辑要求，例如：去背景、替换人物服饰、增强清晰度"
            : "Upload an image and describe edits, for example: remove background, replace outfit, improve clarity",
        category: "edit" as const,
      },
      edit_audio: {
        label: currentLanguage === "zh" ? "音频" : "Audio",
        icon: "🎵",
        placeholder:
          currentLanguage === "zh"
            ? "上传音频后输入编辑要求，例如：降噪、提取人声、调整语速"
            : "Upload audio and describe edits, for example: denoise, isolate vocals, adjust speaking speed",
        category: "edit" as const,
      },
      edit_video: {
        label: currentLanguage === "zh" ? "视频" : "Video",
        icon: "🎬",
        placeholder:
          currentLanguage === "zh"
            ? "上传视频后输入编辑要求，例如：替换背景、自动加字幕、修改画面风格"
            : "Upload a video and describe edits, for example: replace background, add subtitles, restyle visuals",
        category: "edit" as const,
      },
      detect_text: {
        label: currentLanguage === "zh" ? "文档" : "Docs",
        icon: "📝",
        placeholder: text.promptPlaceholderDetection,
        category: "detect" as const,
      },
      detect_image: {
        label: currentLanguage === "zh" ? "图片" : "Image",
        icon: "🖼️",
        placeholder: text.promptPlaceholderDetection,
        category: "detect" as const,
      },
      detect_audio: {
        label: currentLanguage === "zh" ? "音频" : "Audio",
        icon: "🎵",
        placeholder: text.promptPlaceholderDetection,
        category: "detect" as const,
      },
      detect_video: {
        label: currentLanguage === "zh" ? "视频" : "Video",
        icon: "🎬",
        placeholder: text.promptPlaceholderDetection,
        category: "detect" as const,
      },
    }),
    [currentLanguage, text],
  );

  const tierLabel = (() => {
    if (!user) return text.guest;
    if (user.plan === "enterprise") return text.enterprisePlan;
    if (user.plan === "pro") return text.proPlan;
    if (user.plan === "basic") return text.basicPlan;
    return text.freePlan;
  })();

  const tierClassName = (() => {
    if (!user) return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100";
    if (user.plan === "enterprise") return "bg-purple-600 text-white";
    if (user.plan === "pro") return "bg-blue-600 text-white";
    if (user.plan === "basic") return "bg-amber-500 text-white";
    return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100";
  })();
  const currentPlan: UserPlan = user?.plan ?? "free";
  const quota = quotaByPlan[currentPlan];
  const dailyUsed = Math.round(quota.dailyLimit * 0.36);
  const imageUsed = Math.round(quota.imageLimit * 0.41);
  const videoUsed = Math.round(quota.videoLimit * 0.28);
  const dailyPercent = Math.min((dailyUsed / quota.dailyLimit) * 100, 100);
  const imagePercent = Math.min((imageUsed / quota.imageLimit) * 100, 100);
  const videoPercent = Math.min((videoUsed / quota.videoLimit) * 100, 100);
  const addonText = currentLanguage === "zh" ? "加油包" : "Add-on";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/50 dark:from-[#0f1115] dark:via-[#111827] dark:to-[#0f172a]">
      <div className="max-w-[1680px] mx-auto w-full px-3 sm:px-4 py-4 sm:py-6 min-h-screen flex flex-col gap-4 sm:gap-6">
        <header className="relative z-30 overflow-visible rounded-xl sm:rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-[#1f2937]/70 backdrop-blur shadow-sm px-3 sm:px-5 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-[1.45rem] leading-tight sm:text-[1.9rem] lg:text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent truncate">
                  {text.appName}
                </h1>
                <div
                  ref={tierQuotaRef}
                  className="relative shrink-0"
                  onMouseEnter={() => setShowTierQuota(true)}
                  onMouseLeave={() => setShowTierQuota(false)}
                >
                  <Badge
                    variant="outline"
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold border-0 cursor-pointer ${tierClassName}`}
                    onClick={() => setShowTierQuota((previous) => !previous)}
                  >
                    {tierLabel}
                  </Badge>
                  {showTierQuota && (
                    <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4.75rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-[#1f2937]/95 backdrop-blur p-3 shadow-2xl z-[70] space-y-2 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-64 sm:max-h-[calc(100vh-9rem)]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{tierLabel}</span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {dailyUsed}/{quota.dailyLimit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-green-400 to-blue-500" style={{ width: `${dailyPercent}%` }} />
                      </div>

                      <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                        <span>{text.monthlyImage}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {imageUsed}/{quota.imageLimit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-400 to-violet-500" style={{ width: `${imagePercent}%` }} />
                      </div>

                      <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                        <span>{text.monthlyVideo}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {videoUsed}/{quota.videoLimit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-orange-400 to-rose-500" style={{ width: `${videoPercent}%` }} />
                      </div>

                      <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 space-y-1 text-xs">
                        <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                          <span>{addonText} {currentLanguage === "zh" ? "鍥剧墖" : "Images"}</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{quota.addonImage}</span>
                        </div>
                        <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                          <span>{addonText} {currentLanguage === "zh" ? "瑙嗛/闊抽" : "Video/Audio"}</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{quota.addonVideo}</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-gray-500 dark:text-gray-400 pt-1">
                        {user
                          ? user.planExp
                            ? `${text.expiresAt}: ${new Date(user.planExp).toLocaleDateString()}`
                            : text.activeSubscription
                          : currentLanguage === "zh"
                            ? "璁垮妯″紡锛堟紨绀猴級"
                            : "Guest mode (demo)"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
              <LanguageThemeToggle
                currentLanguage={currentLanguage}
                setCurrentLanguage={setCurrentLanguage}
                isDarkMode={isDarkMode}
                toggleTheme={toggleTheme}
                languageSwitchToEn={text.languageSwitchToEn}
                languageSwitchToZh={text.languageSwitchToZh}
                switchToLight={text.switchToLight}
                switchToDark={text.switchToDark}
              />

              <button
                type="button"
                onClick={() => setShowSubscriptionDialog(true)}
                className="flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 h-8 w-8 sm:h-8 sm:w-auto rounded-md px-0 sm:px-2 transition-colors"
                title={text.upgradeTip}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 sm:mr-1"
                  aria-hidden="true"
                >
                  <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
                  <path d="M5 21h14" />
                </svg>
                <span className="hidden sm:inline text-xs font-medium">
                  {text.subscribeButton}
                </span>
              </button>

              {user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((previous) => !previous)}
                    className="h-8 bg-white dark:bg-[#40414f] text-gray-900 dark:text-[#ececf1] border border-gray-300 dark:border-[#565869] hover:bg-gray-50 dark:hover:bg-[#565869] rounded-md px-2 text-xs flex items-center gap-1 min-w-[84px] sm:min-w-[110px]"
                  >
                    <span className="truncate">{user.name}</span>
                    <span className="text-[10px]">▾</span>
                  </button>
                  {showUserMenu && (
                    <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-[#40414f] border border-gray-200 dark:border-[#565869] rounded-md shadow-lg py-1 z-30">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAuthDialog(true);
                          setShowUserMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-900 dark:text-[#ececf1] hover:bg-gray-100 dark:hover:bg-[#565869]"
                      >
                        {text.account}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 text-xs text-gray-900 dark:text-[#ececf1] hover:bg-gray-100 dark:hover:bg-[#565869]"
                      >
                        {text.logout}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/auth/login"
                  className="h-8 text-[11px] sm:text-xs font-medium bg-white dark:bg-[#40414f] text-gray-900 dark:text-[#ececf1] border border-gray-300 dark:border-[#565869] hover:bg-gray-50 dark:hover:bg-[#565869] rounded-md px-2.5 sm:px-3 flex items-center"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mr-1 h-3.5 w-3.5 hidden sm:inline"
                    aria-hidden="true"
                  >
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  {text.loginButton}
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 lg:items-start gap-4 sm:gap-6 flex-1 min-h-0">
          <div className="lg:col-span-2 min-h-0 lg:h-[85vh] lg:max-h-[85vh]">
            <AIOperations
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              prompt={prompt}
              setPrompt={setPrompt}
              isGenerating={isGenerating}
              model={model}
              onModelChange={setModel}
              availableModels={availableModels}
              contentTypes={contentTypes}
              currentLanguage={currentLanguage}
              operationsTitle={text.operationsTitle}
              generateText={text.generate}
              generatingText={text.generating}
              selectedDocumentFormats={selectedDocumentFormats}
              onToggleDocumentFormat={handleToggleDocumentFormat}
              onSelectAllDocumentFormats={handleSelectAllDocumentFormats}
              onClearAllDocumentFormats={handleClearAllDocumentFormats}
              onGenerate={handleGenerate}
              generationDisabledReason={generationDisabledReason}
            />
          </div>

          <div className="lg:col-span-1 min-h-0 lg:h-[85vh] lg:max-h-[85vh]">
            <OperationsDashboard
              generations={generations}
              currentLanguage={currentLanguage}
              targetResultView={targetResultView}
            />
          </div>
        </main>
      </div>

      {showAuthDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowAuthDialog(false)}
        >
          <div
            className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowAuthDialog(false)}
              className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 text-sm border border-gray-200 dark:border-gray-700"
              aria-label={text.modalClose}
            >
              脳
            </button>
            <AuthSystem
              currentLanguage={currentLanguage}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authForm={authForm}
              setAuthForm={setAuthForm}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              isDomesticVersion={isDomesticVersion}
              user={user ? { name: user.name, email: user.email } : null}
              onSubmit={handleAuthSubmit}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}

      {showSubscriptionDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowSubscriptionDialog(false)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowSubscriptionDialog(false)}
              className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 text-sm border border-gray-200 dark:border-gray-700"
              aria-label={text.modalClose}
            >
              脳
            </button>
            <PaymentSystem
              currentLanguage={currentLanguage}
              isDomesticVersion={isDomesticVersion}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              billingPeriod={billingPeriod}
              setBillingPeriod={setBillingPeriod}
              onSubscribe={handleSubscribe}
              isLoggedIn={Boolean(user)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AIGeneratorPlatform;







