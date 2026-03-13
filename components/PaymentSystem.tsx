"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Crown, Loader2, Rocket, Shield, Sparkles, Star, Zap } from "lucide-react";
import { getCloudbaseAuth } from "@/lib/cloudbase/client";
import { getUIText, type UILanguage } from "@/lib/ui-text";
import { SubscriptionRulesDialog } from "./SubscriptionRulesDialog";

export type PlanKey = "free" | "pro" | "enterprise";
export type BillingPeriod = "monthly" | "yearly";
export type PaymentMethod = "alipay" | "wechat" | "stripe" | "paypal";
export type AddonKey = "light" | "standard" | "premium";
export type PurchaseSelection =
  | { productType: "subscription"; planCode: PlanKey; billingPeriod: BillingPeriod; displayName: string }
  | { productType: "addon"; addonCode: AddonKey; addonDisplayName: string; amount: number };

type PaymentPlan = {
  planCode: PlanKey;
  displayNameCn: string;
  displayNameEn: string;
  planLevel: number;
  quotas: { monthlyDocumentLimit: number; monthlyImageLimit: number; monthlyVideoLimit: number; monthlyAudioLimit: number };
  prices: { monthly: number; yearly: number; monthlyOriginal: number | null; yearlyOriginal: number | null };
};

type PaymentAddon = {
  addonCode: AddonKey;
  displayNameCn: string;
  displayNameEn: string;
  quotas: { documentQuota: number; imageQuota: number; videoQuota: number; audioQuota: number };
  price: number;
};

type PaymentPlansPayload = {
  source: "cn" | "global";
  currency: "CNY" | "USD";
  fallback: boolean;
  plans: PaymentPlan[];
  addons: PaymentAddon[];
};

type PaymentQuotePayload = {
  success?: boolean;
  error?: string;
  productType?: "ADDON" | "SUBSCRIPTION";
  planCode?: PlanKey;
  billingPeriod?: BillingPeriod;
  addonCode?: AddonKey;
  amount?: number;
  originalAmount?: number | null;
  currency?: "CNY" | "USD";
  isUpgrade?: boolean;
};

type PaymentQuoteState = {
  selectionKey: string;
  payload: PaymentQuotePayload;
};

interface PaymentSystemProps {
  currentLanguage: UILanguage;
  isDomesticVersion: boolean;
  initialSelectedPlan?: PlanKey;
  initialBillingPeriod?: BillingPeriod;
  onSubscribe: (paymentMethod: PaymentMethod, selection: PurchaseSelection) => void;
  isLoggedIn: boolean;
}

const PLAN_ORDER: PlanKey[] = ["free", "pro", "enterprise"];
const ADDON_ORDER: AddonKey[] = ["light", "standard", "premium"];

const toNum = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const toText = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const normalizePlanCode = (v: unknown) => {
  const code = typeof v === "string" ? v.trim().toLowerCase() : "";
  return code === "basic" ? "free" : PLAN_ORDER.includes(code as PlanKey) ? (code as PlanKey) : null;
};
const normalizeAddonCode = (v: unknown) => {
  const code = typeof v === "string" ? v.trim().toLowerCase() : "";
  return ADDON_ORDER.includes(code as AddonKey) ? (code as AddonKey) : null;
};

function normalizePlan(input: unknown): PaymentPlan | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const planCode = normalizePlanCode(row.planCode);
  if (!planCode) return null;
  const quotas = (row.quotas as Record<string, unknown>) || {};
  const prices = (row.prices as Record<string, unknown>) || {};
  return {
    planCode,
    displayNameCn: toText(row.displayNameCn, planCode),
    displayNameEn: toText(row.displayNameEn, planCode),
    planLevel: Math.max(0, Math.trunc(toNum(row.planLevel, 0))),
    quotas: {
      monthlyDocumentLimit: Math.max(0, Math.trunc(toNum(quotas.monthlyDocumentLimit, 0))),
      monthlyImageLimit: Math.max(0, Math.trunc(toNum(quotas.monthlyImageLimit, 0))),
      monthlyVideoLimit: Math.max(0, Math.trunc(toNum(quotas.monthlyVideoLimit, 0))),
      monthlyAudioLimit: Math.max(0, Math.trunc(toNum(quotas.monthlyAudioLimit, 0))),
    },
    prices: {
      monthly: Math.max(0, toNum(prices.monthly, 0)),
      yearly: Math.max(0, toNum(prices.yearly, 0)),
      monthlyOriginal: prices.monthlyOriginal == null ? null : Math.max(0, toNum(prices.monthlyOriginal, 0)),
      yearlyOriginal: prices.yearlyOriginal == null ? null : Math.max(0, toNum(prices.yearlyOriginal, 0)),
    },
  };
}

function normalizeAddon(input: unknown): PaymentAddon | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const addonCode = normalizeAddonCode(row.addonCode);
  if (!addonCode) return null;
  const quotas = (row.quotas as Record<string, unknown>) || {};
  return {
    addonCode,
    displayNameCn: toText(row.displayNameCn, addonCode),
    displayNameEn: toText(row.displayNameEn, addonCode),
    quotas: {
      documentQuota: Math.max(0, Math.trunc(toNum(quotas.documentQuota, 0))),
      imageQuota: Math.max(0, Math.trunc(toNum(quotas.imageQuota, 0))),
      videoQuota: Math.max(0, Math.trunc(toNum(quotas.videoQuota, 0))),
      audioQuota: Math.max(0, Math.trunc(toNum(quotas.audioQuota, 0))),
    },
    price: Math.max(0, toNum(row.price, 0)),
  };
}

function theme(key: PlanKey | AddonKey) {
  if (key === "free" || key === "light") return { g: "from-emerald-500 to-teal-600", b: "border-emerald-200/80 dark:border-emerald-800/60", s: "border-emerald-500 ring-emerald-500/30", t: "text-emerald-600 dark:text-emerald-400", i: <Star className="w-5 h-5" /> };
  if (key === "pro" || key === "standard") return { g: "from-violet-500 to-indigo-600", b: "border-violet-200/80 dark:border-violet-800/60", s: "border-violet-500 ring-violet-500/30", t: "text-violet-600 dark:text-violet-400", i: <Rocket className="w-5 h-5" /> };
  return { g: "from-amber-500 to-orange-600", b: "border-amber-200/80 dark:border-amber-800/60", s: "border-amber-500 ring-amber-500/30", t: "text-amber-600 dark:text-amber-400", i: <Shield className="w-5 h-5" /> };
}

const PaymentSystem: React.FC<PaymentSystemProps> = ({
  currentLanguage,
  isDomesticVersion,
  initialSelectedPlan = "pro",
  initialBillingPeriod = "monthly",
  onSubscribe,
  isLoggedIn,
}) => {
  const text = getUIText(currentLanguage);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [addons, setAddons] = useState<PaymentAddon[]>([]);
  const [currency, setCurrency] = useState<"CNY" | "USD">(isDomesticVersion ? "CNY" : "USD");
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>(isDomesticVersion ? "alipay" : "stripe");
  const [mode, setMode] = useState<"subscription" | "addon">("subscription");
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>(initialSelectedPlan);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(initialBillingPeriod);
  const [selectedAddon, setSelectedAddon] = useState<AddonKey>("standard");
  const [paymentQuote, setPaymentQuote] = useState<PaymentQuoteState | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => setSelectedPayment(isDomesticVersion ? "alipay" : "stripe"), [isDomesticVersion]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/payment/plans", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const payload = (await res.json()) as Partial<PaymentPlansPayload>;
        if (cancelled) return;
        setPlans((Array.isArray(payload.plans) ? payload.plans : []).map(normalizePlan).filter((v): v is PaymentPlan => Boolean(v)).sort((a, b) => PLAN_ORDER.indexOf(a.planCode) - PLAN_ORDER.indexOf(b.planCode)));
        setAddons((Array.isArray(payload.addons) ? payload.addons : []).map(normalizeAddon).filter((v): v is PaymentAddon => Boolean(v)).sort((a, b) => ADDON_ORDER.indexOf(a.addonCode) - ADDON_ORDER.indexOf(b.addonCode)));
        setCurrency(payload.currency === "USD" ? "USD" : "CNY");
        setFallback(Boolean(payload.fallback));
      } catch (error) {
        console.error("[PaymentSystem] 加载商品失败:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isDomesticVersion]);

  useEffect(() => {
    if (plans.length && !plans.some((p) => p.planCode === selectedPlan)) setSelectedPlan("pro");
  }, [plans, selectedPlan, setSelectedPlan]);
  useEffect(() => {
    if (addons.length && !addons.some((a) => a.addonCode === selectedAddon)) setSelectedAddon(addons[0].addonCode);
    if (!addons.length && mode === "addon") setMode("subscription");
  }, [addons, mode, selectedAddon]);

  const symbol = currency === "CNY" ? "¥" : "$";
  const fmt = useMemo(() => new Intl.NumberFormat(currentLanguage === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }), [currentLanguage]);
  const plan = plans.find((item) => item.planCode === selectedPlan) || null;
  const addon = addons.find((item) => item.addonCode === selectedAddon) || null;
  const canBuy = isLoggedIn && agreeTerms && !loading && !quoteLoading && (mode === "subscription" ? selectedPlan !== "free" && Boolean(plan) : Boolean(addon));
  const selectionKey = useMemo(
    () => mode === "subscription"
      ? `subscription:${selectedPlan}:${billingPeriod}`
      : `addon:${selectedAddon}`,
    [billingPeriod, mode, selectedAddon, selectedPlan],
  );

  useEffect(() => {
    let cancelled = false;

    const loadQuote = async () => {
      if (!isLoggedIn) {
        setPaymentQuote(null);
        setQuoteLoading(false);
        return;
      }

      if (mode === "subscription" && selectedPlan === "free") {
        setPaymentQuote(null);
        setQuoteLoading(false);
        return;
      }

      if (mode === "subscription" && !plan) {
        setPaymentQuote(null);
        setQuoteLoading(false);
        return;
      }

      if (mode === "addon" && !addon) {
        setPaymentQuote(null);
        setQuoteLoading(false);
        return;
      }

      if (mode === "addon") {
        if (!addon) {
          setPaymentQuote(null);
          setQuoteLoading(false);
          return;
        }

        setPaymentQuote({
          selectionKey,
          payload: {
            success: true,
            productType: "ADDON",
            addonCode: addon.addonCode,
            amount: addon.price,
            originalAmount: null,
            currency,
            isUpgrade: false,
          },
        });
        setQuoteLoading(false);
        return;
      }

      setPaymentQuote((current) => current?.selectionKey === selectionKey ? current : null);
      setQuoteLoading(true);

      try {
        const endpoint = isDomesticVersion
          ? "/api/domestic/payment/quote"
          : "/api/payment/quote";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (isDomesticVersion) {
          const tokenResult = await getCloudbaseAuth().getAccessToken();
          const accessToken = tokenResult?.accessToken?.trim() || "";
          if (!accessToken) {
            throw new Error("missing_cloudbase_access_token");
          }
          headers["x-cloudbase-access-token"] = accessToken;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(
            mode === "subscription"
              ? {
                  planName: selectedPlan,
                  billingPeriod,
                }
              : {
                  productType: "ADDON",
                  addonPackageId: selectedAddon,
                },
          ),
        });
        const payload = (await response.json()) as PaymentQuotePayload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "payment_quote_failed");
        }

        if (!cancelled) {
          setPaymentQuote({
            selectionKey,
            payload,
          });
          setQuoteLoading(false);
        }
      } catch (error) {
        console.warn("[PaymentSystem] 加载支付报价失败:", error);
        if (!cancelled) {
          setPaymentQuote(null);
          setQuoteLoading(false);
        }
      }
    };

    void loadQuote();
    return () => {
      cancelled = true;
    };
  }, [
    addon,
    billingPeriod,
    isDomesticVersion,
    isLoggedIn,
    mode,
    plan,
    selectionKey,
    selectedAddon,
    selectedPlan,
  ]);
  const activeQuote = paymentQuote?.selectionKey === selectionKey ? paymentQuote.payload : null;
  const fallbackAmount = mode === "subscription"
    ? (plan ? (billingPeriod === "monthly" ? plan.prices.monthly : plan.prices.yearly) : null)
    : (addon?.price ?? null);
  const payAmount = activeQuote?.amount ?? fallbackAmount;
  const payCurrency = activeQuote?.currency ?? currency;
  const paySymbol = payCurrency === "USD" ? "$" : "¥";
  const payAmountText = typeof payAmount === "number" ? `${paySymbol}${fmt.format(payAmount)}` : null;
  const buyButtonText = quoteLoading
    ? (currentLanguage === "zh" ? "计算价格中..." : "Calculating...")
    : mode === "subscription"
    ? selectedPlan === "free"
      ? (currentLanguage === "zh" ? "免费版无需订阅" : "Free plan does not require subscription")
      : currentLanguage === "zh"
        ? payAmountText
          ? `立即订阅（实付 ${payAmountText}）`
          : text.subscribeNow
        : payAmountText
          ? `Subscribe Now (${payAmountText})`
          : text.subscribeNow
    : currentLanguage === "zh"
      ? payAmountText
        ? `立即购买加油包（实付 ${payAmountText}）`
        : "立即购买加油包"
      : payAmountText
        ? `Buy Add-on (${payAmountText})`
        : "Buy Add-on";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 dark:from-[#10141c] dark:via-[#141b26] dark:to-[#0f172a] shadow-2xl p-5 sm:p-6 md:p-7">
      <div className="pointer-events-none absolute -top-24 -left-16 h-60 w-60 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-14 h-60 w-60 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="relative z-10 space-y-5">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center rounded-xl p-2.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg">{mode === "subscription" ? <Crown className="h-5 w-5" /> : <Zap className="h-5 w-5" />}</div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{mode === "subscription" ? text.subscription : currentLanguage === "zh" ? "加油包" : "Add-on Packs"}</h3>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{mode === "subscription" ? (currentLanguage === "zh" ? "套餐额度和价格已与后台管理系统实时同步" : "Plan quotas and prices are synced with admin settings in real time") : (currentLanguage === "zh" ? "加油包为一次性购买，额度永久叠加，不随月度重置清空" : "Add-ons are one-time purchases and permanently stack with monthly quota")}</p>
          {fallback && <p className="text-[11px] sm:text-xs text-amber-600 dark:text-amber-400">{currentLanguage === "zh" ? "当前显示为兜底数据，请检查数据库连接状态" : "Fallback data is shown now, please check database connectivity"}</p>}
        </div>

        <div className="flex justify-center"><div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-white/5 p-1 flex gap-1">
          <button type="button" onClick={() => setMode("subscription")} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${mode === "subscription" ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"}`}>{currentLanguage === "zh" ? "订阅套餐" : "Subscriptions"}</button>
          <button type="button" onClick={() => setMode("addon")} disabled={!addons.length} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${mode === "addon" ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"} disabled:opacity-50 disabled:cursor-not-allowed`}>{currentLanguage === "zh" ? "加油包" : "Add-ons"}</button>
        </div></div>

        {mode === "subscription" && <div className="flex justify-center"><div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-white/5 p-1 flex gap-1">
          <button type="button" onClick={() => setBillingPeriod("monthly")} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${billingPeriod === "monthly" ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"}`}>{text.billingMonthly}</button>
          <button type="button" onClick={() => setBillingPeriod("yearly")} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${billingPeriod === "yearly" ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"}`}>{text.billingAnnual}</button>
        </div></div>}

        {loading ? <div className="py-12 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400"><Loader2 className="h-4 w-4 mr-2 animate-spin" />{currentLanguage === "zh" ? "正在加载商品配置..." : "Loading products..."}</div> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            {(mode === "subscription" ? plans : addons).map((item) => {
              const isPlan = mode === "subscription";
              const key = isPlan ? (item as PaymentPlan).planCode : (item as PaymentAddon).addonCode;
              const selected = isPlan ? selectedPlan === key : selectedAddon === key;
              const cardTheme = theme(key as PlanKey | AddonKey);
              const title = currentLanguage === "zh" ? (item as PaymentPlan | PaymentAddon).displayNameCn : (item as PaymentPlan | PaymentAddon).displayNameEn;
              const price = isPlan ? (billingPeriod === "monthly" ? (item as PaymentPlan).prices.monthly : (item as PaymentPlan).prices.yearly) : (item as PaymentAddon).price;
              const original = isPlan ? (billingPeriod === "monthly" ? (item as PaymentPlan).prices.monthlyOriginal : (item as PaymentPlan).prices.yearlyOriginal) : null;
              const lines = isPlan ? [
                `${currentLanguage === "zh" ? "每月文档" : "Docs"} ${(item as PaymentPlan).quotas.monthlyDocumentLimit}`,
                `${currentLanguage === "zh" ? "每月图片" : "Images"} ${(item as PaymentPlan).quotas.monthlyImageLimit}`,
                `${currentLanguage === "zh" ? "每月视频/音频" : "Video/Audio"} ${((item as PaymentPlan).quotas.monthlyVideoLimit + (item as PaymentPlan).quotas.monthlyAudioLimit)}`,
              ] : [
                `${currentLanguage === "zh" ? "文档" : "Docs"} +${(item as PaymentAddon).quotas.documentQuota}`,
                `${currentLanguage === "zh" ? "图片" : "Images"} +${(item as PaymentAddon).quotas.imageQuota}`,
                `${currentLanguage === "zh" ? "视频/音频" : "Video/Audio"} +${(item as PaymentAddon).quotas.videoQuota + (item as PaymentAddon).quotas.audioQuota}`,
              ];
              const disabled = isPlan && key === "free";
              return (
                <button key={key} type="button" disabled={disabled} onClick={() => isPlan ? key !== "free" && setSelectedPlan(key as PlanKey) : setSelectedAddon(key as AddonKey)} className={`relative text-left rounded-xl border-2 overflow-hidden transition ${selected ? `${cardTheme.s} ring-2 shadow-xl scale-[1.01]` : `${cardTheme.b} hover:shadow-lg`} ${disabled ? "opacity-75 cursor-not-allowed" : ""}`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-white/90 to-slate-50/80 dark:from-white/5 dark:to-white/[0.02]" />
                  <div className="relative p-4 space-y-3">
                    {key === (isPlan ? "pro" : "standard") && <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white"><Sparkles className="h-3 w-3" />{currentLanguage === "zh" ? "推荐" : "Popular"}</div>}
                    {selected && !disabled && <div className="absolute left-3 top-3 h-5 w-5 rounded-full bg-white/90 dark:bg-gray-900/90 shadow flex items-center justify-center"><Check className={`h-3.5 w-3.5 ${cardTheme.t}`} /></div>}
                    <div className="pt-1 flex items-center gap-2"><div className={`h-8 w-8 rounded-lg bg-gradient-to-r ${cardTheme.g} text-white flex items-center justify-center shadow`}>{key === "light" || key === "standard" || key === "premium" ? <Zap className="w-5 h-5" /> : cardTheme.i}</div><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h4></div>
                    <div className="pt-1 border-t border-gray-200/70 dark:border-gray-700/70">
                      <div className="flex items-end gap-1"><span className={`text-2xl font-extrabold ${cardTheme.t}`}>{`${symbol}${fmt.format(price)}`}</span><span className="text-xs text-gray-500 dark:text-gray-400 pb-1">{isPlan ? (billingPeriod === "monthly" ? (currentLanguage === "zh" ? "/月" : "/mo") : (currentLanguage === "zh" ? "/年" : "/yr")) : (currentLanguage === "zh" ? "/次" : "/once")}</span></div>
                      {original !== null && original > price && <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 line-through">{`${symbol}${fmt.format(original)}`}</div>}
                    </div>
                    <ul className="space-y-1.5">{lines.map((line) => <li key={`${key}-${line}`} className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300"><span className={`mt-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-r ${cardTheme.g} text-white`}><Check className="h-2.5 w-2.5" /></span><span>{line}</span></li>)}</ul>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-white/5 p-4 space-y-3">
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300"><span className="font-semibold">{text.paymentMethod}: </span><span>{isDomesticVersion ? "支付宝 / 微信支付" : "Stripe / PayPal"}</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            {(isDomesticVersion ? ["alipay", "wechat"] : ["stripe", "paypal"]).map((method) => <button key={method} type="button" onClick={() => setSelectedPayment(method as PaymentMethod)} className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${selectedPayment === method ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow" : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20"}`}>{method === "alipay" ? "💳 支付宝" : method === "wechat" ? "💬 微信" : method === "stripe" ? "💳 Stripe" : "🅿️ PayPal"}</button>)}
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" id="agree-terms" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600" />
            <label htmlFor="agree-terms" className="cursor-pointer">
              {mode === "subscription" ? (currentLanguage === "zh" ? "我已阅读并同意" : "I have read and agree to the ") : (currentLanguage === "zh" ? "我已阅读并同意" : "I have read and agree to the ")}
              <button type="button" onClick={() => setShowTermsDialog(true)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline">
                {mode === "subscription" ? (currentLanguage === "zh" ? "《订阅规则》" : "Subscription Terms") : (currentLanguage === "zh" ? "《加油包购买规则》" : "Add-on Purchase Terms")}
              </button>
            </label>
          </div>
          <button type="button" disabled={!canBuy} onClick={() => {
            if (mode === "subscription" && plan) onSubscribe(selectedPayment, { productType: "subscription", planCode: plan.planCode, billingPeriod, displayName: currentLanguage === "zh" ? plan.displayNameCn : plan.displayNameEn });
            if (mode === "addon" && addon) onSubscribe(selectedPayment, { productType: "addon", addonCode: addon.addonCode, addonDisplayName: currentLanguage === "zh" ? addon.displayNameCn : addon.displayNameEn, amount: addon.price });
          }} className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg transition">{buyButtonText}</button>
          {!isLoggedIn && <p className="text-center text-xs text-amber-600 dark:text-amber-400">{text.subscribeHint}</p>}
        </div>
      </div>
      <SubscriptionRulesDialog open={showTermsDialog} onOpenChange={setShowTermsDialog} isDomestic={isDomesticVersion} />
    </section>
  );
};

export default PaymentSystem;
