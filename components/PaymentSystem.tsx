"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Crown, Loader2, Rocket, Shield, Sparkles, Star } from "lucide-react";
import { getUIText, type UILanguage } from "@/lib/ui-text";

export type PlanKey = "free" | "pro" | "enterprise";
export type BillingPeriod = "monthly" | "yearly";
export type PaymentMethod = "alipay" | "wechat" | "stripe" | "paypal";

type PaymentPlan = {
  planCode: PlanKey;
  displayNameCn: string;
  displayNameEn: string;
  planLevel: number;
  quotas: {
    monthlyDocumentLimit: number;
    monthlyImageLimit: number;
    monthlyVideoLimit: number;
    monthlyAudioLimit: number;
  };
  prices: {
    monthly: number;
    yearly: number;
    monthlyOriginal: number | null;
    yearlyOriginal: number | null;
  };
};

type PaymentPlansPayload = {
  source: "cn" | "global";
  currency: "CNY" | "USD";
  fallback: boolean;
  plans: PaymentPlan[];
  fetchedAt: string;
};

interface PaymentSystemProps {
  currentLanguage: UILanguage;
  isDomesticVersion: boolean;
  selectedPlan: PlanKey;
  setSelectedPlan: (plan: PlanKey) => void;
  billingPeriod: BillingPeriod;
  setBillingPeriod: (period: BillingPeriod) => void;
  onSubscribe: (paymentMethod: PaymentMethod) => void;
  isLoggedIn: boolean;
}

const PLAN_ORDER: PlanKey[] = ["free", "pro", "enterprise"];

function normalizePlanCode(input: unknown): PlanKey | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "free" || normalized === "pro" || normalized === "enterprise") {
    return normalized;
  }
  if (normalized === "basic") {
    return "free";
  }
  return null;
}

function toSafeNumber(input: unknown, fallback = 0) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeText(input: unknown, fallback: string) {
  if (typeof input !== "string") {
    return fallback;
  }
  const normalized = input.trim();
  return normalized || fallback;
}

function normalizePlanPayload(input: unknown): PaymentPlan | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const row = input as Record<string, unknown>;
  const planCode = normalizePlanCode(row.planCode);
  if (!planCode) {
    return null;
  }

  const quotas =
    row.quotas && typeof row.quotas === "object"
      ? (row.quotas as Record<string, unknown>)
      : {};
  const prices =
    row.prices && typeof row.prices === "object"
      ? (row.prices as Record<string, unknown>)
      : {};

  return {
    planCode,
    displayNameCn: normalizeText(row.displayNameCn, "免费版"),
    displayNameEn: normalizeText(row.displayNameEn, "Free"),
    planLevel: Math.max(0, Math.trunc(toSafeNumber(row.planLevel, 0))),
    quotas: {
      monthlyDocumentLimit: Math.max(
        0,
        Math.trunc(toSafeNumber(quotas.monthlyDocumentLimit, 0)),
      ),
      monthlyImageLimit: Math.max(
        0,
        Math.trunc(toSafeNumber(quotas.monthlyImageLimit, 0)),
      ),
      monthlyVideoLimit: Math.max(
        0,
        Math.trunc(toSafeNumber(quotas.monthlyVideoLimit, 0)),
      ),
      monthlyAudioLimit: Math.max(
        0,
        Math.trunc(toSafeNumber(quotas.monthlyAudioLimit, 0)),
      ),
    },
    prices: {
      monthly: Math.max(0, toSafeNumber(prices.monthly, 0)),
      yearly: Math.max(0, toSafeNumber(prices.yearly, 0)),
      monthlyOriginal:
        prices.monthlyOriginal === null || prices.monthlyOriginal === undefined
          ? null
          : Math.max(0, toSafeNumber(prices.monthlyOriginal, 0)),
      yearlyOriginal:
        prices.yearlyOriginal === null || prices.yearlyOriginal === undefined
          ? null
          : Math.max(0, toSafeNumber(prices.yearlyOriginal, 0)),
    },
  };
}

function getPlanTheme(plan: PlanKey) {
  if (plan === "free") {
    return {
      gradient: "from-emerald-500 to-teal-600",
      background: "from-emerald-50/75 to-teal-50/65 dark:from-emerald-950/30 dark:to-teal-950/30",
      border: "border-emerald-200/80 dark:border-emerald-800/60",
      selectedBorder: "border-emerald-500 dark:border-emerald-400",
      ring: "ring-emerald-500/30",
      text: "text-emerald-600 dark:text-emerald-400",
      icon: <Star className="w-5 h-5" />,
    };
  }

  if (plan === "pro") {
    return {
      gradient: "from-violet-500 to-indigo-600",
      background: "from-violet-50/75 to-indigo-50/65 dark:from-violet-950/30 dark:to-indigo-950/30",
      border: "border-violet-200/80 dark:border-violet-800/60",
      selectedBorder: "border-violet-500 dark:border-violet-400",
      ring: "ring-violet-500/30",
      text: "text-violet-600 dark:text-violet-400",
      icon: <Rocket className="w-5 h-5" />,
    };
  }

  return {
    gradient: "from-amber-500 to-orange-600",
    background: "from-amber-50/75 to-orange-50/65 dark:from-amber-950/30 dark:to-orange-950/30",
    border: "border-amber-200/80 dark:border-amber-800/60",
    selectedBorder: "border-amber-500 dark:border-amber-400",
    ring: "ring-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    icon: <Shield className="w-5 h-5" />,
  };
}

function buildFeatureList(plan: PaymentPlan, language: UILanguage) {
  const videoAudioLimit = Math.max(
    0,
    toSafeNumber(plan.quotas.monthlyVideoLimit, 0) +
      toSafeNumber(plan.quotas.monthlyAudioLimit, 0),
  );

  if (language === "zh") {
    return [
      `每月文档 ${Math.max(0, toSafeNumber(plan.quotas.monthlyDocumentLimit, 0))}`,
      `每月图片 ${Math.max(0, toSafeNumber(plan.quotas.monthlyImageLimit, 0))}`,
      `每月视频/音频 ${videoAudioLimit}`,
    ];
  }

  return [
    `${Math.max(0, toSafeNumber(plan.quotas.monthlyDocumentLimit, 0))} monthly docs`,
    `${Math.max(0, toSafeNumber(plan.quotas.monthlyImageLimit, 0))} monthly images`,
    `${videoAudioLimit} monthly video/audio`,
  ];
}

const PaymentSystem: React.FC<PaymentSystemProps> = ({
  currentLanguage,
  isDomesticVersion,
  selectedPlan,
  setSelectedPlan,
  billingPeriod,
  setBillingPeriod,
  onSubscribe,
  isLoggedIn,
}) => {
  const text = getUIText(currentLanguage);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [currency, setCurrency] = useState<"CNY" | "USD">(
    isDomesticVersion ? "CNY" : "USD",
  );
  const [isFallbackData, setIsFallbackData] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>(
    isDomesticVersion ? "alipay" : "stripe",
  );

  useEffect(() => {
    setSelectedPayment(isDomesticVersion ? "alipay" : "stripe");
  }, [isDomesticVersion]);

  useEffect(() => {
    let cancelled = false;

    const loadPlans = async () => {
      setLoadingPlans(true);
      try {
        const response = await fetch("/api/payment/plans", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP_${response.status}`);
        }

        const payload = (await response.json()) as Partial<PaymentPlansPayload>;
        const payloadPlans = Array.isArray(payload.plans) ? payload.plans : [];
        const normalizedPlans = payloadPlans
          .map((item) => normalizePlanPayload(item))
          .filter((item): item is PaymentPlan => Boolean(item))
          .sort(
            (left, right) =>
              PLAN_ORDER.indexOf(left.planCode) - PLAN_ORDER.indexOf(right.planCode),
          );

        if (cancelled) {
          return;
        }

        if (normalizedPlans.length > 0) {
          setPlans(normalizedPlans);
        }
        setCurrency(payload.currency === "USD" ? "USD" : "CNY");
        setIsFallbackData(Boolean(payload.fallback));
      } catch (error) {
        console.error("[PaymentSystem] 加载套餐失败:", error);
      } finally {
        if (!cancelled) {
          setLoadingPlans(false);
        }
      }
    };

    void loadPlans();

    return () => {
      cancelled = true;
    };
  }, [isDomesticVersion]);

  useEffect(() => {
    if (plans.length === 0) {
      return;
    }
    const exists = plans.some((plan) => plan.planCode === selectedPlan);
    if (!exists) {
      setSelectedPlan("pro");
    }
  }, [plans, selectedPlan, setSelectedPlan]);

  const amountFormatter = useMemo(() => {
    return new Intl.NumberFormat(currentLanguage === "zh" ? "zh-CN" : "en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }, [currentLanguage]);

  const symbol = currency === "CNY" ? "¥" : "$";

  const showPlans = useMemo(() => {
    if (plans.length > 0) {
      return plans;
    }
    return [];
  }, [plans]);

  const selectedPlanData = useMemo(
    () => showPlans.find((plan) => plan.planCode === selectedPlan) || null,
    [selectedPlan, showPlans],
  );

  const canSubscribe =
    isLoggedIn &&
    agreeTerms &&
    !loadingPlans &&
    selectedPlan !== "free" &&
    selectedPlanData !== null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 dark:from-[#10141c] dark:via-[#141b26] dark:to-[#0f172a] shadow-2xl p-5 sm:p-6 md:p-7">
      <div className="pointer-events-none absolute -top-24 -left-16 h-60 w-60 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-14 h-60 w-60 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative z-10 space-y-5">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center rounded-xl p-2.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg">
            <Crown className="h-5 w-5" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {text.subscription}
          </h3>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {currentLanguage === "zh"
              ? "套餐额度和价格已与后台管理系统实时同步"
              : "Plan quotas and prices are synced with admin settings in real time"}
          </p>
          {isFallbackData && (
            <p className="text-[11px] sm:text-xs text-amber-600 dark:text-amber-400">
              {currentLanguage === "zh"
                ? "当前显示为兜底数据，请检查数据库连接状态"
                : "Fallback data is shown now, please check database connectivity"}
            </p>
          )}
        </div>

        <div className="flex justify-center">
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-white/5 p-1 flex gap-1">
            <button
              type="button"
              onClick={() => setBillingPeriod("monthly")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                billingPeriod === "monthly"
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              {text.billingMonthly}
            </button>
            <button
              type="button"
              onClick={() => setBillingPeriod("yearly")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                billingPeriod === "yearly"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              {text.billingAnnual}
            </button>
          </div>
        </div>

        {loadingPlans ? (
          <div className="py-12 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {currentLanguage === "zh" ? "正在加载套餐配置..." : "Loading plans..."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            {showPlans.map((plan) => {
              const theme = getPlanTheme(plan.planCode);
              const isSelected = selectedPlan === plan.planCode;
              const isFree = plan.planCode === "free";
              const currentPrice =
                billingPeriod === "monthly" ? plan.prices.monthly : plan.prices.yearly;
              const currentOriginalPrice =
                billingPeriod === "monthly"
                  ? plan.prices.monthlyOriginal
                  : plan.prices.yearlyOriginal;
              const features = buildFeatureList(plan, currentLanguage);

              return (
                <button
                  type="button"
                  key={plan.planCode}
                  disabled={isFree}
                  onClick={() => {
                    if (!isFree) {
                      setSelectedPlan(plan.planCode);
                    }
                  }}
                  className={`relative text-left rounded-xl border-2 overflow-hidden transition ${
                    isSelected
                      ? `${theme.selectedBorder} ring-2 ${theme.ring} shadow-xl scale-[1.01]`
                      : `${theme.border} hover:shadow-lg`
                  } ${isFree ? "opacity-75 cursor-not-allowed" : ""}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${theme.background}`} />
                  <div className="relative p-4 space-y-3">
                    {plan.planCode === "pro" && (
                      <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        <Sparkles className="h-3 w-3" />
                        {currentLanguage === "zh" ? "推荐" : "Popular"}
                      </div>
                    )}

                    {isSelected && !isFree && (
                      <div className="absolute left-3 top-3 h-5 w-5 rounded-full bg-white/90 dark:bg-gray-900/90 shadow flex items-center justify-center">
                        <Check className={`h-3.5 w-3.5 ${theme.text}`} />
                      </div>
                    )}

                    <div className="pt-1 flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-lg bg-gradient-to-r ${theme.gradient} text-white flex items-center justify-center shadow`}>
                        {theme.icon}
                      </div>
                      <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {currentLanguage === "zh"
                          ? plan.displayNameCn
                          : plan.displayNameEn}
                      </h4>
                    </div>

                    <div className="pt-1 border-t border-gray-200/70 dark:border-gray-700/70">
                      <div className="flex items-end gap-1">
                        <span className={`text-2xl font-extrabold ${theme.text}`}>
                          {`${symbol}${amountFormatter.format(currentPrice)}`}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 pb-1">
                          {billingPeriod === "monthly"
                            ? currentLanguage === "zh"
                              ? "/月"
                              : "/mo"
                            : currentLanguage === "zh"
                              ? "/年"
                              : "/yr"}
                        </span>
                      </div>
                      {currentOriginalPrice !== null &&
                        currentOriginalPrice > currentPrice && (
                          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 line-through">
                            {`${symbol}${amountFormatter.format(currentOriginalPrice)}`}
                          </div>
                        )}
                    </div>

                    <ul className="space-y-1.5">
                      {features.map((feature) => (
                        <li key={`${plan.planCode}-${feature}`} className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                          <span className={`mt-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-r ${theme.gradient} text-white`}>
                            <Check className="h-2.5 w-2.5" />
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-white/5 p-4 space-y-3">
          <div className="space-y-2">
            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
              <span className="font-semibold">{text.paymentMethod}: </span>
              <span>
                {isDomesticVersion
                  ? "支付宝 / 微信支付"
                  : "Stripe / PayPal"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isDomesticVersion ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedPayment("alipay")}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                      selectedPayment === "alipay"
                        ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow"
                        : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"
                    }`}
                  >
                    💳 支付宝
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPayment("wechat")}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                      selectedPayment === "wechat"
                        ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow"
                        : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"
                    }`}
                  >
                    💬 微信
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedPayment("stripe")}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                      selectedPayment === "stripe"
                        ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow"
                        : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"
                    }`}
                  >
                    💳 Stripe
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPayment("paypal")}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                      selectedPayment === "paypal"
                        ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow"
                        : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"
                    }`}
                  >
                    🅿️ PayPal
                  </button>
                </>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(event) => setAgreeTerms(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
            />
            <span>
              {currentLanguage === "zh"
                ? "我已阅读并同意订阅规则"
                : "I have read and agree to the subscription terms"}
            </span>
          </label>

          <button
            type="button"
            onClick={() => onSubscribe(selectedPayment)}
            disabled={!canSubscribe}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg transition"
          >
            {selectedPlan === "free"
              ? currentLanguage === "zh"
                ? "免费版无需订阅"
                : "Free plan does not require subscription"
              : text.subscribeNow}
          </button>

          {!isLoggedIn && (
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">
              {text.subscribeHint}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default PaymentSystem;
