"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AIOperations from "./AIOperations";
import OperationsDashboard, {
  type ResultCategory,
  type ResultFolder,
} from "./OperationsDashboard";
import LanguageThemeToggle from "./LanguageThemeToggle";
import AuthSystem from "./AuthSystem";
import PaymentSystem, {
  type BillingPeriod,
  type PaymentMethod,
  type PurchaseSelection,
} from "./PaymentSystem";
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
import { getCloudbaseApp, getCloudbaseAuth } from "@/lib/cloudbase/client";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { trackAnalyticsClient } from "@/lib/analytics/client";
import {
  buildQuotaSummary,
  mapPlanCodeToUserPlan,
  parseDateTimeMs,
  pickPlanDefinition,
  resolveEffectivePlan,
  type QuotaSummary,
  type QuotaType,
  type UserPlan,
} from "@/lib/user-status";

interface DashboardUser {
  id: string;
  source: "cn" | "global";
  name: string;
  email: string;
  rawPlan: UserPlan;
  plan: UserPlan;
  planExp: string | null;
  isPlanActive: boolean;
  planDisplayName: string;
  quotaSummary: QuotaSummary;
}

type CloudbaseLoginUser = {
  uid?: string;
  id?: string;
  email?: string;
  name?: string;
  username?: string;
};

type CloudbaseQueryResult<T> = {
  data?: T[] | null;
  error?: { message?: string } | null;
};

type AppUserRow = {
  id?: string | null;
  email?: string | null;
  display_name?: string | null;
  current_plan_code?: string | null;
  plan_expires_at?: string | null;
};

type SubscriptionPlanRow = {
  plan_code?: string | null;
  display_name_cn?: string | null;
  display_name_en?: string | null;
  monthly_document_limit?: number | null;
  monthly_image_limit?: number | null;
  monthly_video_limit?: number | null;
  monthly_audio_limit?: number | null;
};

type UserQuotaAccountRow = {
  id?: string | null;
  cycle_end_date?: string | null;
};

type UserQuotaBalanceRow = {
  quota_type?: string | null;
  base_limit?: number | null;
  addon_limit?: number | null;
  admin_adjustment?: number | null;
  used_amount?: number | null;
  remaining_amount?: number | null;
};

type DomesticProfileApiUser = {
  id?: string | null;
  source?: "cn";
  email?: string | null;
  display_name?: string | null;
  raw_plan?: string | null;
  effective_plan?: string | null;
  plan_expires_at?: string | null;
  is_plan_active?: boolean;
  plan_display_name_cn?: string | null;
  plan_display_name_en?: string | null;
  quota_summary?: QuotaSummary | null;
};

type GlobalProfileApiUser = {
  id?: string | null;
  source?: "global";
  email?: string | null;
  display_name?: string | null;
  raw_plan?: string | null;
  effective_plan?: string | null;
  plan_expires_at?: string | null;
  is_plan_active?: boolean;
  plan_display_name_cn?: string | null;
  plan_display_name_en?: string | null;
  quota_summary?: QuotaSummary | null;
};

type GuestQuotaState = {
  monthKey: string;
  limit: number;
  used: number;
  remaining: number;
};

type GenerationsApiPayload = {
  success?: boolean;
  generations?: GenerationItem[] | null;
  error?: string | null;
};

function toSafeNonNegativeNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, Math.trunc(numeric));
}

function readGuestLimitFromEnv() {
  return toSafeNonNegativeNumber(process.env.NEXT_PUBLIC_GUEST_MONTHLY_LIMIT, 0);
}

function parseGuestQuotaPayload(payload: unknown): GuestQuotaState | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (typeof data.monthKey !== "string" || !data.monthKey.trim()) {
    return null;
  }

  const limit = toSafeNonNegativeNumber(data.limit, readGuestLimitFromEnv());
  const used = toSafeNonNegativeNumber(data.used, 0);
  const remaining = toSafeNonNegativeNumber(
    data.remaining,
    Math.max(0, limit - used),
  );

  return {
    monthKey: data.monthKey.trim(),
    limit,
    used,
    remaining,
  };
}

function mergeGenerationHistory(
  incoming: GenerationItem[],
  existing: GenerationItem[],
) {
  const merged: GenerationItem[] = [];
  const seenIds = new Set<string>();

  for (const item of incoming) {
    const id = String(item.id || "").trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    merged.push(item);
  }

  for (const item of existing) {
    const id = String(item.id || "").trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    merged.push(item);
  }

  return merged.sort((left, right) => {
    const leftMs = Date.parse(String(left.createdAt || ""));
    const rightMs = Date.parse(String(right.createdAt || ""));
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

function normalizeDisplayNameCandidate(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyAccountIdentifier(value: string) {
  if (!value) {
    return false;
  }

  if (value.includes("@")) {
    return true;
  }

  if (/^\d{6,}$/.test(value)) {
    return true;
  }

  if (/^(user|uid|account|账号)[_-]?\d+$/i.test(value)) {
    return true;
  }

  return false;
}

function pickPreferredDisplayName(candidates: unknown[], fallback: string) {
  const normalized = candidates
    .map((candidate) => normalizeDisplayNameCandidate(candidate))
    .filter(Boolean);

  const preferred = normalized.find(
    (candidate) => !isLikelyAccountIdentifier(candidate),
  );

  return preferred || normalized[0] || fallback;
}

function resolveQuotaTypeByTab(tab: GenerationTab): QuotaType {
  if (tab.endsWith("image")) {
    return "image";
  }
  if (tab.endsWith("video")) {
    return "video";
  }
  if (tab.endsWith("audio")) {
    return "audio";
  }
  return "document";
}

function consumeQuotaSummaryLocally(
  quotaSummary: QuotaSummary,
  quotaType: QuotaType,
): QuotaSummary {
  const currentQuota = quotaSummary?.[quotaType];
  if (!currentQuota) {
    return quotaSummary;
  }

  const nextUsedAmount = Math.max(0, currentQuota.usedAmount + 1);
  const nextRemainingAmount = Math.max(0, currentQuota.remainingAmount - 1);
  const baseCapacity = Math.max(
    0,
    currentQuota.baseLimit + currentQuota.adminAdjustment,
  );
  const overflowUsed = Math.max(0, nextUsedAmount - baseCapacity);
  const nextAddonRemaining = Math.min(
    nextRemainingAmount,
    Math.max(0, currentQuota.addonLimit - overflowUsed),
  );

  return {
    ...quotaSummary,
    [quotaType]: {
      ...currentQuota,
      usedAmount: nextUsedAmount,
      remainingAmount: nextRemainingAmount,
      addonRemaining: nextAddonRemaining,
    },
  };
}

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

function getUnsupportedTabMessage(tab: string, language: "zh" | "en") {
  if (tab.startsWith("detect_")) {
    return language === "zh"
      ? "AI 检测功能正在开发中，暂不可用。"
      : "AI Detection is under development and currently unavailable.";
  }

  return language === "zh"
    ? "当前功能暂不可用。"
    : "This feature is currently unavailable.";
}

function calculatePreviewSize(width: number, height: number, maxDimension: number) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const longestSide = Math.max(safeWidth, safeHeight);
  if (longestSide <= maxDimension) {
    return {
      width: safeWidth,
      height: safeHeight,
    };
  }

  const scale = maxDimension / longestSide;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("图像导出失败，请稍后重试。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function resizeImageFile(file: File, maxDimension = 512) {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<File>((resolve, reject) => {
      const image = new Image();

      const cleanup = () => {
        image.src = "";
        URL.revokeObjectURL(objectUrl);
      };

      image.onerror = () => {
        cleanup();
        reject(new Error("图片压缩失败，请更换文件后重试。"));
      };

      image.onload = async () => {
        try {
          const { width, height } = calculatePreviewSize(
            image.naturalWidth,
            image.naturalHeight,
            maxDimension,
          );
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext("2d");
          if (!context) {
            cleanup();
            reject(new Error("浏览器不支持图片压缩。"));
            return;
          }

          context.drawImage(image, 0, 0, width, height);
          const blob = await canvasToPngBlob(canvas);
          cleanup();

          const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
          resolve(
            new File([blob], `${baseName}.png`, {
              type: "image/png",
            }),
          );
        } catch (error) {
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error("图片压缩失败，请稍后重试。"),
          );
        }
      };

      image.src = objectUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function extractVideoFrameFiles(
  file: File,
  options?: { frameCount?: number; maxDimension?: number },
) {
  const frameCount = Math.max(1, options?.frameCount ?? 3);
  const maxDimension = Math.max(128, options?.maxDimension ?? 512);
  const objectUrl = URL.createObjectURL(file);

  const waitForEvent = <T extends keyof HTMLVideoElementEventMap>(
    video: HTMLVideoElement,
    eventName: T,
    errorMessage: string,
  ) =>
    new Promise<void>((resolve, reject) => {
      const handleSuccess = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(errorMessage));
      };
      const cleanup = () => {
        video.removeEventListener(eventName, handleSuccess);
        video.removeEventListener("error", handleError);
      };

      video.addEventListener(eventName, handleSuccess, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });

  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = objectUrl;

    await waitForEvent(video, "loadedmetadata", "视频解析失败，请更换文件后重试。");

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("无法读取视频画面尺寸，请更换文件后重试。");
    }

    const { width, height } = calculatePreviewSize(
      video.videoWidth,
      video.videoHeight,
      maxDimension,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器不支持视频抽帧。");
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
    const ratioSeeds = frameCount === 1 ? [0.5] : [0.15, 0.5, 0.85];
    const timestamps = Array.from(
      new Set(
        ratioSeeds
          .slice(0, frameCount)
          .map((ratio) => {
            if (duration <= 0.2) {
              return 0;
            }
            return Math.min(Math.max(duration * ratio, 0), Math.max(0, duration - 0.05));
          })
          .map((value) => Number(value.toFixed(3))),
      ),
    );

    const frames: File[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const timestamp = timestamps[index];
      if (duration > 0.2) {
        const seekPromise = waitForEvent(
          video,
          "seeked",
          "视频抽帧失败，请更换文件后重试。",
        );
        video.currentTime = timestamp;
        await seekPromise;
      }

      context.drawImage(video, 0, 0, width, height);
      const blob = await canvasToPngBlob(canvas);
      frames.push(
        new File([blob], `${baseName}-frame-${index + 1}.png`, {
          type: "image/png",
        }),
      );
    }

    video.src = "";
    URL.revokeObjectURL(objectUrl);
    return frames;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

const AIGeneratorPlatform: React.FC<{ appDisplayName: string }> = ({ appDisplayName }) => {
  const router = useRouter();
  const { currentLanguage, setCurrentLanguage, isDomesticVersion } =
    useLanguage();
  const text = getUIText(currentLanguage);

  const [activeTab, setActiveTab] = useState("text");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<GenerationItem[]>([]);
  const [deletingGenerationIds, setDeletingGenerationIds] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [model, setModel] = useState("auto");
  const [selectedDocumentFormats, setSelectedDocumentFormats] = useState<DocumentFileFormat[]>(["docx"]);
  const [selectedOperationFile, setSelectedOperationFile] = useState<File | null>(null);
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [guestQuota, setGuestQuota] = useState<GuestQuotaState | null>(null);
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
  const trackedSessionMarkerRef = useRef<string>("");
  const domesticHydrateRetryRef = useRef(0);

  useEffect(() => {
    const savedTheme = localStorage.getItem("morngpt_theme");
    const shouldUseDark = savedTheme === "dark";
    setIsDarkMode(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateDomesticUser = async () => {
      if (!isDomesticVersion) {
        return;
      }

      try {
        const auth = getCloudbaseAuth();
        let loginState: {
          user?: CloudbaseLoginUser;
          data?: { user?: CloudbaseLoginUser };
        } | null = null;
        try {
          loginState = (await auth.getLoginState()) as {
            user?: CloudbaseLoginUser;
            data?: { user?: CloudbaseLoginUser };
          } | null;
        } catch (error) {
          console.warn("[AIGeneratorPlatform] getLoginState failed:", error);
        }

        const loginUser = loginState?.user || loginState?.data?.user || null;

        let profile: CloudbaseLoginUser | null = null;
        try {
          profile = (await auth.getUserInfo()) as CloudbaseLoginUser;
        } catch (error) {
          console.warn("[AIGeneratorPlatform] getUserInfo failed:", error);
        }

        const authEmail = (profile?.email || loginUser?.email || "")
          .trim()
          .toLowerCase();
        const fallbackName = authEmail
          ? authEmail.split("@")[0]
          : currentLanguage === "zh"
            ? "用户"
            : "User";

        let accessToken = "";
        try {
          const tokenResult = await auth.getAccessToken();
          accessToken = tokenResult?.accessToken?.trim() || "";
        } catch (error) {
          console.warn("[AIGeneratorPlatform] getAccessToken failed:", error);
        }

        if (accessToken) {
          try {
            const profileResponse = await fetch("/api/domestic/user/profile", {
              method: "GET",
              headers: {
                "x-cloudbase-access-token": accessToken,
              },
              cache: "no-store",
            });

            if (profileResponse.ok) {
              const payload = (await profileResponse.json()) as {
                success?: boolean;
                user?: DomesticProfileApiUser | null;
              };
              const profileUser = payload?.success ? payload.user : null;
              const profileUserId = String(profileUser?.id || "").trim();

              if (profileUserId) {
                const rawPlan = mapPlanCodeToUserPlan(profileUser?.raw_plan);
                const effectivePlan = mapPlanCodeToUserPlan(
                  profileUser?.effective_plan || profileUser?.raw_plan,
                );
                const planExp =
                  typeof profileUser?.plan_expires_at === "string" &&
                  profileUser.plan_expires_at.trim()
                    ? profileUser.plan_expires_at.trim()
                    : null;
                const resolvedPlanState = resolveEffectivePlan(effectivePlan, planExp);
                const isPlanActive =
                  typeof profileUser?.is_plan_active === "boolean"
                    ? profileUser.is_plan_active
                    : resolvedPlanState.isPlanActive;
                const stablePlan = isPlanActive ? effectivePlan : "free";
                const fallbackPlan = pickPlanDefinition([], stablePlan);

                const profileEmail = String(profileUser?.email || "")
                  .trim()
                  .toLowerCase();
                const displayName = pickPreferredDisplayName(
                  [
                    profileUser?.display_name,
                    profile?.name,
                    loginUser?.name,
                    profile?.username,
                    loginUser?.username,
                  ],
                  profileEmail
                    ? profileEmail.split("@")[0]
                    : fallbackName,
                );
                const quotaSummary =
                  profileUser?.quota_summary &&
                  typeof profileUser.quota_summary === "object"
                    ? (profileUser.quota_summary as QuotaSummary)
                    : buildQuotaSummary(fallbackPlan, []);
                const planDisplayName =
                  currentLanguage === "zh"
                    ? String(
                        profileUser?.plan_display_name_cn ||
                          fallbackPlan.displayNameCn,
                      )
                    : String(
                        profileUser?.plan_display_name_en ||
                          fallbackPlan.displayNameEn,
                      );

                domesticHydrateRetryRef.current = 0;
                if (!cancelled) {
                  setUser({
                    id: profileUserId,
                    source: "cn",
                    name: displayName,
                    email: profileEmail || "demo@mornstudio.ai",
                    rawPlan,
                    plan: stablePlan,
                    planExp,
                    isPlanActive,
                    planDisplayName,
                    quotaSummary,
                  });
                }
                return;
              }
            }
          } catch (error) {
            console.warn(
              "[AIGeneratorPlatform] hydrate domestic user via api failed:",
              error,
            );
          }
        }

        const userId = (
          profile?.uid ||
          profile?.id ||
          loginUser?.uid ||
          loginUser?.id ||
          ""
        ).trim();
        if (!userId) {
          if (!cancelled && domesticHydrateRetryRef.current < 2) {
            domesticHydrateRetryRef.current += 1;
            window.setTimeout(() => {
              if (!cancelled) {
                void hydrateDomesticUser();
              }
            }, 350);
            return;
          }
          domesticHydrateRetryRef.current = 0;
          if (!cancelled) {
            setUser(null);
          }
          return;
        }
        domesticHydrateRetryRef.current = 0;

        const mysql = getCloudbaseApp().mysql();
        const [appUserResult, planRowsResult] = (await Promise.all([
          mysql
            .from("app_users")
            .select("id,email,display_name,current_plan_code,plan_expires_at")
            .eq("id", userId)
            .eq("source", "cn")
            .limit(1),
          mysql
            .from("subscription_plans")
            .select(
              "plan_code,display_name_cn,display_name_en,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit",
            )
            .limit(20),
        ])) as [
          CloudbaseQueryResult<AppUserRow>,
          CloudbaseQueryResult<SubscriptionPlanRow>,
        ];

        if (appUserResult?.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch app_users failed:",
            appUserResult.error,
          );
        }
        if (planRowsResult?.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch subscription_plans failed:",
            planRowsResult.error,
          );
        }

        let appUserRow = (appUserResult?.data?.[0] || null) as AppUserRow | null;
        if (!appUserRow && authEmail) {
          const appUserByEmailResult = (await mysql
            .from("app_users")
            .select("id,email,display_name,current_plan_code,plan_expires_at")
            .eq("source", "cn")
            .eq("email_normalized", authEmail)
            .limit(1)) as CloudbaseQueryResult<AppUserRow>;
          if (appUserByEmailResult?.error) {
            console.warn(
              "[AIGeneratorPlatform] fallback fetch app_users by email failed:",
              appUserByEmailResult.error,
            );
          }
          appUserRow = (appUserByEmailResult?.data?.[0] || null) as AppUserRow | null;
        }

        const resolvedUserId = String(appUserRow?.id || userId).trim() || userId;
        const rawPlan = mapPlanCodeToUserPlan(appUserRow?.current_plan_code);
        const planExp = appUserRow?.plan_expires_at || null;
        const { effectivePlan, isPlanActive } = resolveEffectivePlan(
          rawPlan,
          planExp,
        );
        const planRows = (planRowsResult?.data || []) as SubscriptionPlanRow[];
        const planDefinition = pickPlanDefinition(planRows, effectivePlan);

        const quotaAccountResult = (await mysql
          .from("user_quota_accounts")
          .select("id,cycle_end_date")
          .eq("user_id", resolvedUserId)
          .eq("source", "cn")
          .eq("status", "active")
          .limit(20)) as CloudbaseQueryResult<UserQuotaAccountRow>;

        if (quotaAccountResult?.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch user_quota_accounts failed:",
            quotaAccountResult.error,
          );
        }

        const latestQuotaAccount = (quotaAccountResult?.data || [])
          .map((item) => ({
            id: String(item.id || "").trim(),
            cycleEndDate: item.cycle_end_date || "",
          }))
          .filter((item) => item.id)
          .sort(
            (left, right) =>
              (parseDateTimeMs(right.cycleEndDate) || 0) -
              (parseDateTimeMs(left.cycleEndDate) || 0),
          )[0];

        let quotaBalanceRows: UserQuotaBalanceRow[] = [];
        if (latestQuotaAccount?.id) {
          const quotaBalanceResult = (await mysql
            .from("user_quota_balances")
            .select(
              "quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount",
            )
            .eq("quota_account_id", latestQuotaAccount.id)
            .limit(20)) as CloudbaseQueryResult<UserQuotaBalanceRow>;

          if (quotaBalanceResult?.error) {
            console.warn(
              "[AIGeneratorPlatform] fetch user_quota_balances failed:",
              quotaBalanceResult.error,
            );
          }
          quotaBalanceRows = (quotaBalanceResult?.data ||
            []) as UserQuotaBalanceRow[];
        }

        const quotaSummary = buildQuotaSummary(planDefinition, quotaBalanceRows);
        const dbEmail = String(appUserRow?.email || "").trim().toLowerCase();
        const email = dbEmail || authEmail || "demo@mornstudio.ai";
        const displayName = pickPreferredDisplayName(
          [
            appUserRow?.display_name,
            profile?.name,
            loginUser?.name,
            profile?.username,
            loginUser?.username,
          ],
          fallbackName,
        );
        const planDisplayName =
          currentLanguage === "zh"
            ? planDefinition.displayNameCn
            : planDefinition.displayNameEn;

        if (process.env.NODE_ENV !== "production") {
          console.info("[AIGeneratorPlatform][domestic] hydrate user status", {
            userId: resolvedUserId,
            rawPlan,
            planExp,
            effectivePlan,
            isPlanActive,
            quotaAccountId: latestQuotaAccount?.id || null,
            quotaRows: quotaBalanceRows.length,
          });
        }

        if (!cancelled) {
          setUser({
            id: resolvedUserId,
            source: "cn",
            name: displayName,
            email,
            rawPlan,
            plan: effectivePlan,
            planExp,
            isPlanActive,
            planDisplayName,
            quotaSummary,
          });
        }
      } catch (error) {
        console.warn("[AIGeneratorPlatform] hydrate domestic user failed:", error);
      }
    };

    const hydrateGlobalUser = async () => {
      if (isDomesticVersion) {
        return;
      }

      try {
        const supabase = createSupabaseClient();
        if (!supabase) {
          if (!cancelled) {
            setUser(null);
          }
          return;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        let authUser = session?.user || null;
        if (!authUser) {
          const {
            data: { user: fetchedUser },
            error: getUserError,
          } = await supabase.auth.getUser();
          if (getUserError) {
            throw getUserError;
          }
          authUser = fetchedUser || null;
        }
        if (!authUser) {
          if (!cancelled) {
            setUser(null);
          }
          return;
        }

        const metadata = (authUser.user_metadata || {}) as Record<string, unknown>;
        const metadataFullName =
          typeof metadata.full_name === "string" ? metadata.full_name : null;
        const metadataDisplayName =
          typeof metadata.display_name === "string"
            ? metadata.display_name
            : null;
        const metadataName =
          typeof metadata.name === "string" ? metadata.name : null;

        try {
          const profileResponse = await fetch("/api/user/profile", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          });

          if (profileResponse.ok) {
            const payload = (await profileResponse.json()) as {
              success?: boolean;
              user?: GlobalProfileApiUser | null;
            };
            const profileUser = payload?.success ? payload.user : null;
            const profileUserId = String(profileUser?.id || "").trim();

            if (profileUserId) {
              const rawPlan = mapPlanCodeToUserPlan(profileUser?.raw_plan);
              const effectivePlan = mapPlanCodeToUserPlan(
                profileUser?.effective_plan || profileUser?.raw_plan,
              );
              const planExp =
                typeof profileUser?.plan_expires_at === "string" &&
                profileUser.plan_expires_at.trim()
                  ? profileUser.plan_expires_at.trim()
                  : null;
              const resolvedPlanState = resolveEffectivePlan(effectivePlan, planExp);
              const isPlanActive =
                typeof profileUser?.is_plan_active === "boolean"
                  ? profileUser.is_plan_active
                  : resolvedPlanState.isPlanActive;
              const stablePlan = isPlanActive ? effectivePlan : "free";
              const fallbackPlan = pickPlanDefinition([], stablePlan);
              const profileEmail = String(profileUser?.email || "")
                .trim()
                .toLowerCase();
              const fallbackName = profileEmail
                ? profileEmail.split("@")[0]
                : currentLanguage === "zh"
                  ? "用户"
                  : "User";
              const displayName = pickPreferredDisplayName(
                [
                  profileUser?.display_name,
                  metadataFullName,
                  metadataDisplayName,
                  metadataName,
                ],
                fallbackName,
              );
              const quotaSummary =
                profileUser?.quota_summary &&
                typeof profileUser.quota_summary === "object"
                  ? (profileUser.quota_summary as QuotaSummary)
                    : buildQuotaSummary(fallbackPlan, []);
              const planDisplayName =
                currentLanguage === "zh"
                  ? String(
                      profileUser?.plan_display_name_cn || fallbackPlan.displayNameCn,
                    )
                  : String(
                      profileUser?.plan_display_name_en || fallbackPlan.displayNameEn,
                    );

              if (!cancelled) {
                setUser({
                  id: profileUserId,
                  source: "global",
                  name: displayName,
                  email: profileEmail || "user@global",
                  rawPlan,
                  plan: stablePlan,
                  planExp,
                  isPlanActive,
                  planDisplayName,
                  quotaSummary,
                });
              }
              return;
            }
          }
        } catch (error) {
          console.warn(
            "[AIGeneratorPlatform] hydrate global user via api failed:",
            error,
          );
        }

        const metadataPlanCode =
          (typeof metadata.current_plan_code === "string"
            ? metadata.current_plan_code
            : null) ||
          (typeof metadata.plan_code === "string" ? metadata.plan_code : null) ||
          (typeof metadata.subscription_plan === "string" ? metadata.subscription_plan : null);
        const metadataPlanExp =
          (typeof metadata.plan_expires_at === "string"
            ? metadata.plan_expires_at
            : null) ||
          (typeof metadata.subscription_expires_at === "string"
            ? metadata.subscription_expires_at
            : null);

        const [appUserResult, planRowsResult] = await Promise.all([
          supabase
            .from("app_users")
            .select("id,email,display_name,current_plan_code,plan_expires_at")
            .eq("id", authUser.id)
            .eq("source", "global")
            .limit(1),
          supabase
            .from("subscription_plans")
            .select(
              "plan_code,display_name_cn,display_name_en,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit",
            )
            .limit(20),
        ]);

        if (appUserResult.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch global app_users failed:",
            appUserResult.error,
          );
        }
        if (planRowsResult.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch global subscription_plans failed:",
            planRowsResult.error,
          );
        }

        const appUserRow = (appUserResult.data?.[0] || null) as AppUserRow | null;
        const planRows = (planRowsResult.data || []) as SubscriptionPlanRow[];
        const rawPlan = mapPlanCodeToUserPlan(
          appUserRow?.current_plan_code || metadataPlanCode,
        );
        const planExpCandidate =
          String(appUserRow?.plan_expires_at || "").trim() || metadataPlanExp;
        const { effectivePlan, isPlanActive } = resolveEffectivePlan(rawPlan, planExpCandidate);
        const planDefinition = pickPlanDefinition(planRows, effectivePlan);

        const quotaAccountResult = await supabase
          .from("user_quota_accounts")
          .select("id,cycle_end_date")
          .eq("user_id", authUser.id)
          .eq("source", "global")
          .eq("status", "active")
          .limit(20);
        if (quotaAccountResult.error) {
          console.warn(
            "[AIGeneratorPlatform] fetch global user_quota_accounts failed:",
            quotaAccountResult.error,
          );
        }

        const latestQuotaAccount = (quotaAccountResult.data || [])
          .map((item) => ({
            id: String(item.id || "").trim(),
            cycleEndDate: String(item.cycle_end_date || "").trim(),
          }))
          .filter((item) => item.id)
          .sort(
            (left, right) =>
              (parseDateTimeMs(right.cycleEndDate) || 0) -
              (parseDateTimeMs(left.cycleEndDate) || 0),
          )[0];

        let quotaBalanceRows: UserQuotaBalanceRow[] = [];
        if (latestQuotaAccount?.id) {
          const quotaBalanceResult = await supabase
            .from("user_quota_balances")
            .select(
              "quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount",
            )
            .eq("quota_account_id", latestQuotaAccount.id)
            .limit(20);
          if (quotaBalanceResult.error) {
            console.warn(
              "[AIGeneratorPlatform] fetch global user_quota_balances failed:",
              quotaBalanceResult.error,
            );
          }
          quotaBalanceRows = (quotaBalanceResult.data || []) as UserQuotaBalanceRow[];
        }

        const quotaSummary = buildQuotaSummary(planDefinition, quotaBalanceRows);
        const email = String(authUser.email || "").trim().toLowerCase();
        const fallbackName = email
          ? email.split("@")[0]
          : currentLanguage === "zh"
            ? "用户"
            : "User";
        const displayName = pickPreferredDisplayName(
          [
            appUserRow?.display_name,
            metadataFullName,
            metadataDisplayName,
            metadataName,
          ],
          fallbackName,
        );

        if (!cancelled) {
          setUser({
            id: authUser.id,
            source: "global",
            name: displayName,
            email:
              String(appUserRow?.email || "").trim().toLowerCase() ||
              email ||
              "user@global",
            rawPlan,
            plan: effectivePlan,
            planExp: planExpCandidate,
            isPlanActive,
            planDisplayName:
              currentLanguage === "zh"
                ? planDefinition.displayNameCn
                : planDefinition.displayNameEn,
            quotaSummary,
          });
        }
      } catch (error) {
        console.warn("[AIGeneratorPlatform] hydrate global user failed:", error);
        if (!cancelled) {
          setUser(null);
        }
      }
    };

    const hydrateCurrentUser = async () => {
      if (isDomesticVersion) {
        await hydrateDomesticUser();
        return;
      }
      await hydrateGlobalUser();
    };

    void hydrateCurrentUser();

    const paymentConfirmedAt = sessionStorage.getItem(
      "mornstudio_payment_confirmed_at",
    );
    if (paymentConfirmedAt) {
      sessionStorage.removeItem("mornstudio_payment_confirmed_at");
      window.setTimeout(() => {
        void hydrateCurrentUser();
      }, 800);
    }

    const handleFocus = () => {
      void hydrateCurrentUser();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void hydrateCurrentUser();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("quota:refresh", handleFocus);

    let removeAuthSubscription: (() => void) | null = null;
    if (!isDomesticVersion) {
      const supabase = createSupabaseClient();
      if (supabase) {
        const { data } = supabase.auth.onAuthStateChange(() => {
          void hydrateCurrentUser();
        });
        removeAuthSubscription = () => {
          data.subscription.unsubscribe();
        };
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("quota:refresh", handleFocus);
      if (removeAuthSubscription) {
        removeAuthSubscription();
      }
    };
  }, [currentLanguage, isDomesticVersion]);

  const refreshGuestQuota = useCallback(async () => {
    if (user) {
      return;
    }

    try {
      const response = await fetch("/api/user/guest-quota", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as unknown;
      const parsedQuota = parseGuestQuotaPayload(payload);
      if (parsedQuota) {
        setGuestQuota(parsedQuota);
      }
    } catch (error) {
      console.warn("[AIGeneratorPlatform] fetch guest quota failed:", error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setGuestQuota(null);
      return;
    }

    let cancelled = false;
    const loadGuestQuota = async () => {
      await refreshGuestQuota();
      if (cancelled) {
        return;
      }
    };

    void loadGuestQuota();

    const handleFocus = () => {
      void loadGuestQuota();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadGuestQuota();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("quota:refresh", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("quota:refresh", handleFocus);
    };
  }, [refreshGuestQuota, user]);

  useEffect(() => {
    if (!user?.id) {
      trackedSessionMarkerRef.current = "";
      return;
    }

    const dayKey = new Date().toISOString().slice(0, 10);
    const marker = `${user.source}:${user.id}:${dayKey}`;
    if (trackedSessionMarkerRef.current === marker) {
      return;
    }
    trackedSessionMarkerRef.current = marker;

    void trackAnalyticsClient({
      source: user.source,
      userId: user.id,
      eventType: "session_start",
      eventName: "workbench_active",
      eventData: {
        entry: "ai_workbench",
      },
      sessionScope: "workbench",
    });
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const loadPersistedGenerations = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setGenerations([]);
        }
        return;
      }

      try {
        let response: Response;

        if (isDomesticVersion) {
          const tokenResult = await getCloudbaseAuth().getAccessToken();
          const accessToken = tokenResult?.accessToken?.trim() || "";
          if (!accessToken) {
            throw new Error(
              currentLanguage === "zh"
                ? "登录状态已失效，请重新登录。"
                : "Session expired. Please sign in again.",
            );
          }

          response = await fetch("/api/domestic/user/generations", {
            method: "GET",
            headers: {
              "x-cloudbase-access-token": accessToken,
            },
            cache: "no-store",
          });
        } else {
          response = await fetch("/api/user/generations", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          });
        }

        const payload = (await response.json()) as GenerationsApiPayload;
        if (!response.ok || !payload.success) {
          throw new Error(
            (typeof payload.error === "string" && payload.error.trim()) ||
              (currentLanguage === "zh"
                ? "加载生成历史失败"
                : "Failed to load generation history."),
          );
        }

        const nextGenerations = Array.isArray(payload.generations)
          ? payload.generations
          : [];
        if (!cancelled) {
          setGenerations((previous) =>
            mergeGenerationHistory(nextGenerations, previous),
          );
        }
      } catch (error) {
        console.warn(
          "[AIGeneratorPlatform] load persisted generations failed:",
          error,
        );
        if (!cancelled) {
          setGenerations((previous) => (user?.id ? previous : []));
        }
      }
    };

    void loadPersistedGenerations();

    return () => {
      cancelled = true;
    };
  }, [currentLanguage, isDomesticVersion, user?.id]);

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
  const featureUnavailableReason = useMemo(
    () =>
      isConnectedGenerationTab(activeTab)
        ? generationDisabledReason
        : getUnsupportedTabMessage(activeTab, currentLanguage),
    [activeTab, currentLanguage, generationDisabledReason],
  );

  useEffect(() => {
    if (user) {
      return;
    }
  }, [activeTab, user]);

  useEffect(() => {
    setSelectedDocumentFormats((previous) => {
      if (previous.length === 1) {
        return previous;
      }

      const fallbackFormat =
        previous.find((item) => DOCUMENT_FILE_FORMATS.includes(item)) || "docx";
      return [fallbackFormat];
    });
  }, [user]);

  const handleToggleDocumentFormat = (format: DocumentFileFormat) => {
    setSelectedDocumentFormats([format]);
  };

  const handleDeleteGeneration = useCallback(
    async (generation: GenerationItem) => {
      if (!user) {
        return;
      }

      const generationId = String(generation.id || "").trim();
      if (!generationId || generationId.startsWith("err_")) {
        return;
      }

      const confirmed = window.confirm(
        currentLanguage === "zh"
          ? "确认删除这条输出结果吗？删除后会同步移除数据库中的产物记录，且无法恢复。"
          : "Delete this output result? This removes the stored artifact records from the database and cannot be undone.",
      );
      if (!confirmed) {
        return;
      }

      setDeletingGenerationIds((previous) =>
        previous.includes(generationId) ? previous : [...previous, generationId],
      );

      try {
        let response: Response;

        if (isDomesticVersion) {
          const tokenResult = await getCloudbaseAuth().getAccessToken();
          const accessToken = tokenResult?.accessToken?.trim() || "";
          if (!accessToken) {
            throw new Error(
              currentLanguage === "zh"
                ? "登录状态已失效，请重新登录。"
                : "Session expired. Please sign in again.",
            );
          }

          response = await fetch(
            `/api/domestic/user/generations/${encodeURIComponent(generationId)}`,
            {
              method: "DELETE",
              headers: {
                "x-cloudbase-access-token": accessToken,
              },
            },
          );
        } else {
          response = await fetch(`/api/user/generations/${encodeURIComponent(generationId)}`, {
            method: "DELETE",
            cache: "no-store",
            credentials: "include",
          });
        }

        const payload = (await response.json()) as {
          success?: boolean;
          error?: string | null;
        };
        if (!response.ok || !payload.success) {
          throw new Error(
            (typeof payload.error === "string" && payload.error.trim()) ||
              (currentLanguage === "zh"
                ? "删除输出结果失败。"
                : "Failed to delete output result."),
          );
        }

        setGenerations((previous) =>
          previous.filter((item) => String(item.id || "").trim() !== generationId),
        );
      } catch (error) {
        window.alert(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : currentLanguage === "zh"
              ? "删除输出结果失败。"
              : "Failed to delete output result.",
        );
      } finally {
        setDeletingGenerationIds((previous) => previous.filter((id) => id !== generationId));
      }
    },
    [currentLanguage, isDomesticVersion, user],
  );

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    const isEditRequest = activeTab.startsWith("edit_");
    const isDetectRequest = activeTab.startsWith("detect_");
    const requiresUpload = isEditRequest || isDetectRequest;
    if (requiresUpload && !selectedOperationFile) {
      return;
    }

    const isGuest = !user;
    if (isGuest && activeTab !== "text") {
      return;
    }

    if (activeTab === "text" && selectedDocumentFormats.length !== 1) {
      setSelectedDocumentFormats([selectedDocumentFormats[0] || "docx"]);
      return;
    }

    setTargetResultView({
      category: getResultCategoryByTab(activeTab),
      folder: getResultFolderByTab(activeTab),
      key: Date.now(),
    });

    if (featureUnavailableReason) {
      const modelId = isConnectedGenerationTab(activeTab)
        ? model === "auto"
          ? getDefaultModelIdForTab(activeTab as GenerationTab)
          : model
        : "pending";

      setGenerations((previous) => [
        {
          id: `err_${Date.now()}`,
          type: activeTab as GenerationTab,
          prompt: trimmedPrompt,
          modelId,
          modelLabel:
            modelId === "pending"
              ? currentLanguage === "zh"
                ? "暂未开放"
                : "Coming Soon"
              : getGenerationModelLabel(modelId, activeTab as GenerationTab),
          provider: "system",
          status: "error",
          summary: currentLanguage === "zh" ? "生成失败" : "Generation failed",
          errorMessage: featureUnavailableReason,
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ]);
      return;
    }

    setIsGenerating(true);

    try {
      const headers: Record<string, string> = {};

      if (user && isDomesticVersion) {
        try {
          const tokenResult = await getCloudbaseAuth().getAccessToken();
          const accessToken = tokenResult?.accessToken?.trim() || "";
          if (!accessToken) {
            throw new Error("EMPTY_TOKEN");
          }
          headers["x-cloudbase-access-token"] = accessToken;
        } catch (error) {
          console.warn("[AIGeneratorPlatform] getAccessToken failed:", error);
          throw new Error(
            currentLanguage === "zh"
              ? "登录状态已失效，请重新登录后再试。"
              : "Session expired. Please sign in again.",
          );
        }
      }

      if (user && !isDomesticVersion) {
        const supabase = createSupabaseClient();
        if (!supabase) {
          throw new Error(
            currentLanguage === "zh"
              ? "Supabase 配置缺失，请联系管理员。"
              : "Missing Supabase configuration.",
          );
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error(
            currentLanguage === "zh"
              ? "登录状态已失效，请重新登录后再试。"
              : "Session expired. Please sign in again.",
          );
        }
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      let response: Response;
      if (requiresUpload) {
        const formData = new FormData();
        formData.set("type", activeTab);
        formData.set("prompt", trimmedPrompt);
        formData.set("model", model);
        let uploadFile = selectedOperationFile!;
        if (activeTab === "detect_image") {
          uploadFile = await resizeImageFile(selectedOperationFile!, 512);
        }

        formData.set("file", uploadFile);

        if (activeTab === "edit_video") {
          const frames = await extractVideoFrameFiles(selectedOperationFile!, {
            frameCount: 3,
            maxDimension: isDomesticVersion ? 1024 : 768,
          });
          if (frames.length === 0) {
            throw new Error("视频关键帧提取失败，请更换文件后重试。");
          }

          frames.forEach((frame) => {
            formData.append("frames", frame);
          });
          formData.set("keyframe", frames[Math.min(1, frames.length - 1)] ?? frames[0]);
        }

        if (activeTab === "detect_video") {
          const frames = await extractVideoFrameFiles(selectedOperationFile!, {
            frameCount: 3,
            maxDimension: 512,
          });
          frames.forEach((frame) => {
            formData.append("frames", frame);
          });
        }

        response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: formData,
        });
      } else {
        headers["Content-Type"] = "application/json";
        response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: activeTab,
            prompt: trimmedPrompt,
            model,
            formats: activeTab === "text" ? selectedDocumentFormats : undefined,
          }),
        });
      }

      const payload = (await response.json()) as
        | (GenerationItem & { guestQuota?: unknown })
        | { message?: string; guestQuota?: unknown };
      const payloadGuestQuota = parseGuestQuotaPayload(
        (payload as { guestQuota?: unknown }).guestQuota,
      );
      if (payloadGuestQuota) {
        setGuestQuota(payloadGuestQuota);
      }

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
      if (user) {
        const consumedQuotaType = resolveQuotaTypeByTab(activeTab as GenerationTab);
        setUser((previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            quotaSummary: consumeQuotaSummaryLocally(
              previous.quotaSummary,
              consumedQuotaType,
            ),
          };
        });

        window.dispatchEvent(new CustomEvent("quota:refresh"));
      }
      setSelectedOperationFile(null);
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
          modelLabel: getGenerationModelLabel(modelId, activeTab as GenerationTab),
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

  const navigateToAuthPage = useCallback(
    (target: "login" | "signup" | "reset") => {
      const nextPath =
        typeof window === "undefined"
          ? "/"
          : `${window.location.pathname}${window.location.search}`;
      const encodedNext = encodeURIComponent(nextPath || "/");
      const path =
        target === "login"
          ? `/auth/login?next=${encodedNext}`
          : target === "signup"
            ? `/auth/sign-up?next=${encodedNext}`
            : `/auth/forgot-password?next=${encodedNext}`;

      setShowUserMenu(false);
      setShowAuthDialog(false);
      router.push(path);
    },
    [router],
  );

  const handleOpenLogin = useCallback(() => {
    navigateToAuthPage("login");
  }, [navigateToAuthPage]);

  const handleOpenSignup = useCallback(() => {
    navigateToAuthPage("signup");
  }, [navigateToAuthPage]);

  const handleOpenResetPassword = useCallback(() => {
    navigateToAuthPage("reset");
  }, [navigateToAuthPage]);

  const handleOpenAccountCenter = useCallback(() => {
    if (!user) {
      navigateToAuthPage("login");
      return;
    }
    setShowUserMenu(false);
    setShowAuthDialog(true);
  }, [navigateToAuthPage, user]);

  const handleLogout = () => {
    if (isDomesticVersion) {
      void getCloudbaseAuth()
        .signOut()
        .catch((error: unknown) => {
          console.warn("[AIGeneratorPlatform] cloudbase signOut failed:", error);
        });
    } else {
      const supabase = createSupabaseClient();
      if (supabase) {
        void supabase.auth.signOut().catch((error: unknown) => {
          console.warn("[AIGeneratorPlatform] supabase signOut failed:", error);
        });
      }
    }
    setUser(null);
    setGuestQuota(null);
    setShowUserMenu(false);
  };

  const handleSubscribe = async (
    paymentMethod: PaymentMethod,
    selection: PurchaseSelection,
  ) => {
    if (!user) {
      setShowAuthDialog(true);
      return;
    }

    if (
      selection.productType === "subscription" &&
      selection.planCode === "free"
    ) {
      return;
    }

    const requestBody =
      selection.productType === "subscription"
        ? {
            planName: selection.planCode,
            billingPeriod: selection.billingPeriod,
          }
        : {
            productType: "ADDON",
            addonPackageId: selection.addonCode,
          };

    if (isDomesticVersion) {
      if (paymentMethod !== "alipay" && paymentMethod !== "wechat") {
        window.alert(
          currentLanguage === "zh"
            ? "当前支付方式不可用。"
            : "Selected payment method is unavailable.",
        );
        return;
      }

      try {
        const tokenResult = await getCloudbaseAuth().getAccessToken();
        const accessToken = tokenResult?.accessToken?.trim() || "";
        if (!accessToken) {
          throw new Error(
            currentLanguage === "zh"
              ? "登录状态已失效，请重新登录后再试。"
              : "Session expired. Please sign in again.",
          );
        }

        const endpoint =
          paymentMethod === "alipay"
            ? "/api/domestic/payment/alipay/create"
            : "/api/domestic/payment/wechat/create";

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cloudbase-access-token": accessToken,
          },
          credentials: "include",
          body: JSON.stringify(requestBody),
        });

        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
          paymentId?: string;
          out_trade_no?: string;
          formHtml?: string;
          code_url?: string;
          amount?: number;
          sessionId?: string;
          url?: string;
          providerOrderId?: string;
          approvalUrl?: string;
          productType?: "ADDON" | "SUBSCRIPTION";
          addonCode?: string;
          planCode?: string;
          billingPeriod?: BillingPeriod;
        };

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error ||
              (currentLanguage === "zh" ? "创建支付订单失败。" : "Failed to create payment."),
          );
        }

        if (paymentMethod === "alipay") {
          const formHtml = typeof payload.formHtml === "string" ? payload.formHtml : "";
          if (!formHtml) {
            throw new Error(
              currentLanguage === "zh"
                ? "支付宝支付表单生成失败。"
                : "Failed to generate Alipay form.",
            );
          }

          if (payload.paymentId) {
            sessionStorage.setItem("alipay_order_id", payload.paymentId);
          }

          const wrapper = document.createElement("div");
          wrapper.style.display = "none";
          wrapper.innerHTML = formHtml;
          document.body.appendChild(wrapper);
          const form = wrapper.querySelector("form");
          if (!form) {
            wrapper.remove();
            throw new Error(
              currentLanguage === "zh"
                ? "支付宝支付表单解析失败。"
                : "Failed to parse Alipay form.",
            );
          }

          setShowSubscriptionDialog(false);
          form.submit();
          return;
        }

        const outTradeNo =
          typeof payload.out_trade_no === "string"
            ? payload.out_trade_no
            : "";
        const codeUrl = typeof payload.code_url === "string" ? payload.code_url : "";

        if (!outTradeNo || !codeUrl) {
          throw new Error(
            currentLanguage === "zh"
              ? "微信支付二维码生成失败。"
              : "Failed to create WeChat payment QR code.",
          );
        }

        sessionStorage.setItem(
          "wechat_pay_order",
          JSON.stringify({
            out_trade_no: outTradeNo,
            code_url: codeUrl,
            amount: Number(payload.amount || 0),
            productType:
              selection.productType === "addon" ? "ADDON" : "SUBSCRIPTION",
            itemName:
              selection.productType === "addon"
                ? selection.addonDisplayName
                : selection.displayName,
            addonCode:
              selection.productType === "addon" ? selection.addonCode : null,
            planName:
              selection.productType === "subscription"
                ? selection.planCode
                : null,
            billingPeriod:
              selection.productType === "subscription"
                ? selection.billingPeriod
                : null,
          }),
        );

        setShowSubscriptionDialog(false);
        router.push("/payment/wechat");
        return;
      } catch (error) {
        console.error("[Subscription] domestic payment failed:", error);
        window.alert(
          error instanceof Error
            ? error.message
            : currentLanguage === "zh"
              ? "支付发起失败，请稍后重试。"
              : "Failed to start payment. Please try again later.",
        );
        return;
      }
    }

    if (paymentMethod !== "stripe" && paymentMethod !== "paypal") {
      window.alert(
        currentLanguage === "zh"
          ? "当前支付方式不可用。"
          : "Selected payment method is unavailable.",
      );
      return;
    }

    try {
      const endpoint =
        paymentMethod === "stripe"
          ? "/api/payment/stripe/create"
          : "/api/payment/paypal/create";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        sessionId?: string;
        url?: string;
        providerOrderId?: string;
        approvalUrl?: string;
        productType?: "ADDON" | "SUBSCRIPTION";
        addonCode?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ||
            (currentLanguage === "zh"
              ? "创建支付订单失败。"
              : "Failed to create payment."),
        );
      }

      if (paymentMethod === "stripe") {
        const checkoutUrl = typeof payload.url === "string" ? payload.url : "";
        const sessionId =
          typeof payload.sessionId === "string" ? payload.sessionId : "";
        if (!checkoutUrl || !sessionId) {
          throw new Error(
            currentLanguage === "zh"
              ? "Stripe 支付链接生成失败。"
              : "Failed to create Stripe checkout URL.",
          );
        }

        sessionStorage.setItem("stripe_session_id", sessionId);
        setShowSubscriptionDialog(false);
        window.location.href = checkoutUrl;
        return;
      }

      const approvalUrl =
        typeof payload.approvalUrl === "string" ? payload.approvalUrl : "";
      const providerOrderId =
        typeof payload.providerOrderId === "string" ? payload.providerOrderId : "";
      if (!approvalUrl || !providerOrderId) {
        throw new Error(
          currentLanguage === "zh"
            ? "PayPal 支付链接生成失败。"
            : "Failed to create PayPal approval URL.",
        );
      }

      sessionStorage.setItem("paypal_order_id", providerOrderId);
      setShowSubscriptionDialog(false);
      window.location.href = approvalUrl;
    } catch (error) {
      console.error("[Subscription] global payment failed:", error);
      window.alert(
        error instanceof Error
          ? error.message
          : currentLanguage === "zh"
            ? "支付发起失败，请稍后重试。"
            : "Failed to start payment. Please try again later.",
      );
    }
  };

  const availableModels = useMemo<Record<string, { name: string }>>(() => {
    if (isConnectedGenerationTab(activeTab)) {
      return getGenerationModelOptions(activeTab, currentLanguage);
    }

    return {
      auto: {
        name: currentLanguage === "zh" ? "暂未开放" : "Coming Soon",
      },
    };
  }, [activeTab, currentLanguage]);

  const contentTypes = useMemo(() => {
    const allContentTypes = {
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
            ? "上传图片后输入编辑要求，例如：去背景、替换服饰、统一画面风格"
            : "Upload an image and describe edits, for example: remove the background, change clothing, and unify the visual style",
        category: "edit" as const,
      },
      edit_audio: {
        label: currentLanguage === "zh" ? "音频" : "Audio",
        icon: "🎵",
        placeholder:
          currentLanguage === "zh"
            ? "上传音频后输入编辑要求，例如：提炼口播文案、润色表达、重新配音"
            : "Upload audio and describe edits, for example: refine the narration, polish the script, and redub it",
        category: "edit" as const,
      },
      edit_video: {
        label: currentLanguage === "zh" ? "视频" : "Video",
        icon: "🎬",
        placeholder:
          currentLanguage === "zh"
            ? "上传视频后输入编辑要求，例如：保持主体不变、替换背景、改成电影感风格"
            : "Upload a video and describe edits, for example: keep the subject, replace the background, and restyle it cinematically",
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
    };

    return allContentTypes;
  }, [currentLanguage, text]);

  const tierLabel = (() => {
    if (!user) {
      return text.guest;
    }
    return user.planDisplayName;
  })();

  const tierClassName = (() => {
    if (!user) return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100";
    if (user.plan === "enterprise") return "bg-purple-600 text-white";
    if (user.plan === "pro") return "bg-blue-600 text-white";
    if (user.plan === "basic") return "bg-amber-500 text-white";
    return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100";
  })();
  const quotaSummary = user ? user.quotaSummary : null;
  const documentQuota = quotaSummary?.document || null;
  const imageQuota = quotaSummary?.image || null;
  const videoQuota = quotaSummary?.video || null;
  const audioQuota = quotaSummary?.audio || null;
  const guestDocumentLimit = guestQuota?.limit ?? readGuestLimitFromEnv();
  const guestDocumentRemaining =
    guestQuota?.remaining ??
    Math.max(0, guestDocumentLimit - (guestQuota?.used ?? 0));
  const displayedDocumentLimit = user
    ? Math.max(0, (documentQuota?.baseLimit || 0) + (documentQuota?.adminAdjustment || 0))
    : guestDocumentLimit;
  const displayedDocumentUsed = user ? documentQuota?.usedAmount || 0 : 0;
  const displayedDocumentRemaining = user
    ? Math.max(0, displayedDocumentLimit - displayedDocumentUsed)
    : guestDocumentRemaining;
  const displayedImageLimit = user ? Math.max(0, (imageQuota?.baseLimit || 0) + (imageQuota?.adminAdjustment || 0)) : 0;
  const displayedImageUsed = user ? imageQuota?.usedAmount || 0 : 0;
  const displayedImageRemaining = user ? Math.max(0, displayedImageLimit - displayedImageUsed) : 0;
  const displayedVideoAudioLimit = user
    ? Math.max(0, (videoQuota?.baseLimit || 0) + (videoQuota?.adminAdjustment || 0) + (audioQuota?.baseLimit || 0) + (audioQuota?.adminAdjustment || 0))
    : 0;
  const displayedVideoAudioUsed = user ? (videoQuota?.usedAmount || 0) + (audioQuota?.usedAmount || 0) : 0;
  const displayedVideoAudioRemaining = user
    ? Math.max(0, displayedVideoAudioLimit - displayedVideoAudioUsed)
    : 0;
  const videoAudioAddonRemaining = user
    ? (videoQuota?.addonRemaining || 0) + (audioQuota?.addonRemaining || 0)
    : 0;
  const documentPercent =
    displayedDocumentLimit > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (displayedDocumentRemaining / displayedDocumentLimit) * 100,
          ),
        )
      : 0;
  const imagePercent =
    displayedImageLimit > 0
      ? Math.min(
        100,
        Math.max(0, (displayedImageRemaining / displayedImageLimit) * 100),
        )
      : 0;
  const videoAudioPercent =
    displayedVideoAudioLimit > 0
      ? Math.min(
        100,
        Math.max(0, (displayedVideoAudioRemaining / displayedVideoAudioLimit) * 100),
        )
      : 0;
  const isPaidUser = Boolean(user && user.plan !== "free");
  const addonText = currentLanguage === "zh" ? "加油包" : "Add-on";
  const guestModeHint =
    currentLanguage === "zh"
      ? `游客仅可使用文档生成（单次单格式），本月额度 ${displayedDocumentRemaining}/${displayedDocumentLimit}`
      : `Guest mode: docs-only, single format each time, quota ${displayedDocumentRemaining}/${displayedDocumentLimit}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/50 dark:from-[#0f1115] dark:via-[#111827] dark:to-[#0f172a]">
      <div className="max-w-[1680px] mx-auto w-full px-3 sm:px-4 py-4 sm:py-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-6 min-h-screen flex flex-col gap-4 sm:gap-6">
        <header className="relative z-30 overflow-visible rounded-xl sm:rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-[#1f2937]/70 backdrop-blur shadow-sm px-3 sm:px-5 py-3 sm:py-4">
          <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-2 min-w-0 sm:items-center">
                <h1 className="text-[1.45rem] leading-tight sm:text-[1.9rem] lg:text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent break-words sm:truncate">
                  {appDisplayName || text.appName}
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
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{text.monthlyDocument}</span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {displayedDocumentRemaining}/{displayedDocumentLimit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                          style={{ width: `${documentPercent}%` }}
                        />
                      </div>

                      {user && (
                        <>
                          <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                            <span>{text.monthlyImage}</span>
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {displayedImageRemaining}/{displayedImageLimit}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-400 to-violet-500"
                              style={{ width: `${imagePercent}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                            <span>{text.monthlyVideo}</span>
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {displayedVideoAudioRemaining}/{displayedVideoAudioLimit}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-orange-400 to-rose-500"
                              style={{ width: `${videoAudioPercent}%` }}
                            />
                          </div>

                          <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                              <span>{addonText} {currentLanguage === "zh" ? "文档" : "Docs"}</span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">
                                {documentQuota?.addonRemaining || 0}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                              <span>{addonText} {currentLanguage === "zh" ? "图片" : "Images"}</span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">
                                {imageQuota?.addonRemaining || 0}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                              <span>{addonText} {currentLanguage === "zh" ? "视频/音频" : "Video/Audio"}</span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">
                                {videoAudioAddonRemaining}
                              </span>
                            </div>
                          </div>
                        </>
                      )}

                      <p className="text-[11px] text-gray-500 dark:text-gray-400 pt-1">
                        {user
                          ? user.planExp
                            ? user.isPlanActive
                              ? `${text.expiresAt}: ${
                                  (() => {
                                    const expMs = parseDateTimeMs(user.planExp);
                                    if (expMs === null) {
                                      return user.planExp;
                                    }
                                    return new Date(expMs).toLocaleDateString(
                                      currentLanguage === "zh" ? "zh-CN" : "en-US",
                                    );
                                  })()
                                }`
                              : currentLanguage === "zh"
                                ? "已过期"
                                : "Expired"
                            : user.plan === "free"
                              ? text.freePlan
                              : text.activeSubscription
                          : guestModeHint}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2 lg:ml-auto lg:w-auto shrink-0">
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

              {user && (
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
              )}

              {user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowUserMenu((previous) => !previous)}
                    className="h-8 w-20 sm:w-28 bg-white dark:bg-[#40414f] text-gray-900 dark:text-[#ececf1] border border-gray-300 dark:border-[#565869] hover:bg-gray-50 dark:hover:bg-[#565869] rounded-md px-1.5 sm:px-2 text-xs flex items-center justify-center gap-1"
                  >
                    {isPaidUser && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3 shrink-0 text-gray-900 dark:text-gray-100"
                        aria-hidden="true"
                      >
                        <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
                        <path d="M5 21h14" />
                      </svg>
                    )}
                    <span className="truncate max-w-[52px] sm:max-w-[72px]">{user.name}</span>
                    <span className="text-[10px]">▾</span>
                  </button>
                  {showUserMenu && (
                    <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-[#40414f] border border-gray-200 dark:border-[#565869] rounded-md shadow-lg py-1 z-30">
                      <button
                        type="button"
                        onClick={handleOpenAccountCenter}
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
              onGenerate={handleGenerate}
              selectedFile={selectedOperationFile}
              onSelectedFileChange={setSelectedOperationFile}
              generationDisabledReason={generationDisabledReason}
              featureUnavailableReason={featureUnavailableReason}
              isGuest={!user}
              guestQuota={guestQuota}
            />
          </div>

          <div className="lg:col-span-1 min-h-0 lg:h-[85vh] lg:max-h-[85vh]">
            <OperationsDashboard
              generations={generations}
              currentLanguage={currentLanguage}
              targetResultView={targetResultView}
              canDeletePersistedResults={Boolean(user)}
              deletingGenerationIds={deletingGenerationIds}
              onDeleteGeneration={handleDeleteGeneration}
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
              ×
            </button>
            <AuthSystem
              currentLanguage={currentLanguage}
              isDomesticVersion={isDomesticVersion}
              user={user ? { name: user.name, email: user.email } : null}
              onLogin={handleOpenLogin}
              onSignup={handleOpenSignup}
              onResetPassword={handleOpenResetPassword}
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
              ×
            </button>
            <PaymentSystem
              currentLanguage={currentLanguage}
              isDomesticVersion={isDomesticVersion}
              initialSelectedPlan="pro"
              initialBillingPeriod="monthly"
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







