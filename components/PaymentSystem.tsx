"use client";

import React from "react";
import { getUIText, type UILanguage } from "@/lib/ui-text";

export type PlanKey = "basic" | "pro" | "enterprise";
export type BillingPeriod = "monthly" | "annual";

interface PlanInfo {
  key: PlanKey;
  title: string;
  monthlyPrice: string;
  annualPrice: string;
  features: string[];
  gradient: string;
}

interface PaymentSystemProps {
  currentLanguage: UILanguage;
  isDomesticVersion: boolean;
  selectedPlan: PlanKey;
  setSelectedPlan: (plan: PlanKey) => void;
  billingPeriod: BillingPeriod;
  setBillingPeriod: (period: BillingPeriod) => void;
  onSubscribe: () => void;
  isLoggedIn: boolean;
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

  const plans: PlanInfo[] = [
    {
      key: "basic",
      title: text.basicPlan,
      monthlyPrice: isDomesticVersion ? "¥29" : "$9",
      annualPrice: isDomesticVersion ? "¥20" : "$6",
      features:
        currentLanguage === "zh"
          ? ["每日 100 次外部模型", "每月 200 张图片", "每月 60 次视频/音频"]
          : [
              "100 daily external calls",
              "200 monthly images",
              "60 monthly video/audio tasks",
            ],
      gradient: "from-amber-500 to-orange-500",
    },
    {
      key: "pro",
      title: text.proPlan,
      monthlyPrice: isDomesticVersion ? "¥99" : "$29",
      annualPrice: isDomesticVersion ? "¥69" : "$20",
      features:
        currentLanguage === "zh"
          ? ["每日 300 次外部模型", "每月 600 张图片", "每月 180 次视频/音频"]
          : [
              "300 daily external calls",
              "600 monthly images",
              "180 monthly video/audio tasks",
            ],
      gradient: "from-blue-500 to-indigo-600",
    },
    {
      key: "enterprise",
      title: text.enterprisePlan,
      monthlyPrice: isDomesticVersion ? "¥299" : "$99",
      annualPrice: isDomesticVersion ? "¥209" : "$69",
      features:
        currentLanguage === "zh"
          ? ["超高并发与优先队列", "更高额度与管理控制台", "专属支持与定制模型接入"]
          : [
              "High concurrency and priority queue",
              "Higher limits with admin controls",
              "Dedicated support and custom model routing",
            ],
      gradient: "from-purple-500 to-fuchsia-600",
    },
  ];

  return (
    <section className="rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-2xl p-6 sm:p-8 space-y-6">
      {/* 标题区域 */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 rounded-xl shadow-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/25 mb-3">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {text.subscription}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {currentLanguage === "zh" ? "选择适合您的订阅计划" : "Choose the plan that fits your needs"}
        </p>
      </div>

      {/* 计费周期切换 */}
      <div className="flex items-center justify-center gap-3">
        <div className="rounded-xl bg-gray-100 dark:bg-gray-800 p-1.5 text-sm shadow-inner">
          <button
            type="button"
            onClick={() => setBillingPeriod("monthly")}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              billingPeriod === "monthly"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-md"
                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            {text.billingMonthly}
          </button>
          <button
            type="button"
            onClick={() => setBillingPeriod("annual")}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              billingPeriod === "annual"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-md"
                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            {text.billingAnnual}
          </button>
        </div>
        {billingPeriod === "annual" && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {text.saveThirty}
          </span>
        )}
      </div>

      {/* 订阅计划卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const selected = selectedPlan === plan.key;
          const isPro = plan.key === "pro";
          return (
            <button
              type="button"
              key={plan.key}
              onClick={() => setSelectedPlan(plan.key)}
              className={`relative text-left rounded-2xl border-2 transition-all p-5 ${
                selected
                  ? "border-blue-500 dark:border-blue-400 ring-4 ring-blue-500/20 shadow-xl scale-105"
                  : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-lg"
              } ${isPro ? "md:-mt-2 md:mb-2" : ""}`}
            >
              {isPro && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-bold shadow-lg">
                  {currentLanguage === "zh" ? "推荐" : "Popular"}
                </div>
              )}
              <div
                className={`inline-flex px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r ${plan.gradient} shadow-md`}
              >
                {plan.title}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {billingPeriod === "monthly" ? plan.monthlyPrice : plan.annualPrice}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  /{text.billingMonthly}
                </span>
              </div>
              {billingPeriod === "annual" && (
                <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {currentLanguage === "zh" ? "年付节省 30%" : "Save 30% annually"}
                </div>
              )}
              <ul className="mt-4 space-y-2.5 text-sm text-gray-600 dark:text-gray-300">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* 支付信息和订阅按钮 */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span>{text.paymentMethod}: {isDomesticVersion ? "支付宝 / 微信支付" : "Stripe / PayPal"}</span>
        </div>
        <button
          type="button"
          onClick={onSubscribe}
          disabled={!isLoggedIn}
          className="w-full h-12 px-6 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white text-base font-bold shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
        >
          {text.subscribeNow}
        </button>
        {!isLoggedIn && (
          <p className="text-center text-sm text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {text.subscribeHint}
          </p>
        )}
      </div>
    </section>
  );
};

export default PaymentSystem;
