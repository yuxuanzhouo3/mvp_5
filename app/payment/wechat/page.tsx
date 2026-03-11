"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { getCloudbaseAuth } from "@/lib/cloudbase/client";

type WechatPayOrder = {
  out_trade_no: string;
  code_url: string;
  amount: number;
  planName: string;
  billingPeriod: "monthly" | "yearly";
};

type PaymentStatus = "pending" | "success" | "failed" | "expired";

function formatCountdown(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

async function getDomesticAuthHeaders() {
  const tokenResult = await getCloudbaseAuth().getAccessToken();
  const accessToken = tokenResult?.accessToken?.trim() || "";
  if (!accessToken) {
    throw new Error("登录状态已失效，请重新登录后再试。");
  }

  return {
    "Content-Type": "application/json",
    "x-cloudbase-access-token": accessToken,
  };
}

export default function WechatPaymentPage() {
  const router = useRouter();
  const { currentLanguage, isDomesticVersion } = useLanguage();
  const isZh = currentLanguage === "zh";

  const [order, setOrder] = useState<WechatPayOrder | null>(null);
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [checking, setChecking] = useState(false);
  const [countdown, setCountdown] = useState(5 * 60);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isDomesticVersion) {
      router.replace("/");
      return;
    }

    const raw = sessionStorage.getItem("wechat_pay_order");
    if (!raw) {
      router.replace("/");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as WechatPayOrder;
      if (!parsed.out_trade_no || !parsed.code_url) {
        throw new Error("invalid_order");
      }
      setOrder(parsed);
    } catch {
      sessionStorage.removeItem("wechat_pay_order");
      router.replace("/");
    }
  }, [isDomesticVersion, router]);

  useEffect(() => {
    if (status !== "pending") {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          setStatus("expired");
          sessionStorage.removeItem("wechat_pay_order");
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status]);

  const confirmAndFinish = async (outTradeNo: string) => {
    const headers = await getDomesticAuthHeaders();
    const response = await fetch("/api/domestic/payment/wechat/confirm", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ outTradeNo }),
    });

    const payload = (await response.json()) as {
      success?: boolean;
      error?: string;
    };

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "确认支付失败");
    }

    sessionStorage.removeItem("wechat_pay_order");
    window.dispatchEvent(new CustomEvent("quota:refresh"));
    setStatus("success");

    window.setTimeout(() => {
      router.replace(`/payment/success?provider=wechat&out_trade_no=${encodeURIComponent(outTradeNo)}`);
    }, 1200);
  };

  const checkPaymentStatus = async () => {
    if (!order || status !== "pending") {
      return;
    }

    setChecking(true);
    try {
      const headers = await getDomesticAuthHeaders();
      const response = await fetch(
        `/api/domestic/payment/wechat/query?out_trade_no=${encodeURIComponent(order.out_trade_no)}`,
        {
          method: "GET",
          headers,
          credentials: "include",
        },
      );

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        trade_state?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "查询支付状态失败");
      }

      const tradeState = (payload.trade_state || "").toUpperCase();
      if (tradeState === "SUCCESS") {
        await confirmAndFinish(order.out_trade_no);
        return;
      }

      if (tradeState === "CLOSED" || tradeState === "REVOKED") {
        setStatus("failed");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "查询失败");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!order || status !== "pending") {
      return;
    }

    const interval = window.setInterval(() => {
      void checkPaymentStatus();
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [order, status]);

  const qrImageUrl = useMemo(() => {
    if (!order?.code_url) {
      return "";
    }

    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(
      order.code_url,
    )}`;
  }, [order]);

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  const planLabel =
    order.planName === "enterprise"
      ? isZh
        ? "企业版"
        : "Enterprise"
      : isZh
        ? "专业版"
        : "Pro";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50/40 dark:from-[#0f1115] dark:via-[#111827] dark:to-[#0f172a] px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-[#1f2937]/85 shadow-xl p-6 space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {isZh ? "微信支付" : "WeChat Pay"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isZh ? "请扫码完成支付" : "Scan QR code to complete payment"}
          </p>
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isZh ? "订阅套餐" : "Plan"}: {planLabel}
          </p>
          <p className="text-2xl font-bold text-green-600">¥{Number(order.amount || 0).toFixed(2)}</p>
        </div>

        <div className="flex justify-center">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-3">
            {qrImageUrl ? (
              <img
                src={qrImageUrl}
                alt="wechat-pay-qr"
                className="h-64 w-64"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-64 w-64 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-gray-600 dark:text-gray-300">
          {status === "pending"
            ? isZh
              ? `二维码有效期：${formatCountdown(countdown)}`
              : `Expires in ${formatCountdown(countdown)}`
            : status === "success"
              ? isZh
                ? "支付成功，正在跳转..."
                : "Payment successful, redirecting..."
              : status === "expired"
                ? isZh
                  ? "二维码已过期，请返回重新发起支付。"
                  : "QR code expired, please retry from homepage."
                : isZh
                  ? "支付失败，请返回后重试。"
                  : "Payment failed, please retry."}
        </div>
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 break-all">
          {isZh ? "二维码异常时可复制该链接到微信扫码：" : "If QR fails, copy this link to WeChat:"}
          <br />
          {order.code_url}
        </p>

        {errorMessage ? (
          <p className="text-xs text-center text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void checkPaymentStatus();
            }}
            disabled={checking || status !== "pending"}
            className="flex-1 h-10 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            {checking
              ? isZh
                ? "检测中..."
                : "Checking..."
              : isZh
                ? "我已支付，点击刷新"
                : "I've paid, refresh"}
          </button>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem("wechat_pay_order");
              router.replace("/");
            }}
            className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
