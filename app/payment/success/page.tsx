"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { getCloudbaseAuth } from "@/lib/cloudbase/client";

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

function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentLanguage, isDomesticVersion } = useLanguage();
  const isZh = currentLanguage === "zh";

  const [confirming, setConfirming] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const runConfirm = async () => {
      const provider = (
        searchParams.get("provider") ||
        (isDomesticVersion ? "alipay" : "stripe")
      ).toLowerCase();

      try {
        const isWeChat = provider === "wechat";
        const isAlipay = provider === "alipay";
        const isStripe = provider === "stripe";
        const isPaypal = provider === "paypal";

        let endpoint = "";
        let bodyPayload: Record<string, string> | null = null;
        let headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (isDomesticVersion && (isWeChat || isAlipay)) {
          headers = await getDomesticAuthHeaders();
          const outTradeNo =
            searchParams.get("out_trade_no") ||
            (isAlipay
              ? sessionStorage.getItem("alipay_order_id")
              : sessionStorage.getItem("wechat_pay_order")
                ? (() => {
                    try {
                      const parsed = JSON.parse(
                        sessionStorage.getItem("wechat_pay_order") || "{}",
                      ) as { out_trade_no?: string };
                      return parsed.out_trade_no || "";
                    } catch {
                      return "";
                    }
                  })()
                : "") ||
            "";

          if (!outTradeNo) {
            setErrorMessage(
              isZh ? "缺少支付订单号，无法确认支付。" : "Missing order number, unable to confirm payment.",
            );
            setConfirming(false);
            return;
          }

          endpoint = isWeChat
            ? "/api/domestic/payment/wechat/confirm"
            : "/api/domestic/payment/alipay/confirm";
          bodyPayload = { outTradeNo };
        } else if (isStripe) {
          const sessionId =
            searchParams.get("session_id") ||
            sessionStorage.getItem("stripe_session_id") ||
            "";

          if (!sessionId) {
            setErrorMessage(
              isZh ? "缺少 Stripe 会话标识，无法确认支付。" : "Missing Stripe session id, unable to confirm payment.",
            );
            setConfirming(false);
            return;
          }

          if (isDomesticVersion) {
            headers = await getDomesticAuthHeaders();
            endpoint = "/api/domestic/payment/stripe/confirm";
          } else {
            endpoint = "/api/payment/stripe/confirm";
          }
          bodyPayload = { sessionId };
        } else if (isPaypal) {
          const orderId =
            searchParams.get("token") ||
            searchParams.get("orderId") ||
            sessionStorage.getItem("paypal_order_id") ||
            "";

          if (!orderId) {
            setErrorMessage(
              isZh ? "缺少 PayPal 订单号，无法确认支付。" : "Missing PayPal order id, unable to confirm payment.",
            );
            setConfirming(false);
            return;
          }

          if (isDomesticVersion) {
            headers = await getDomesticAuthHeaders();
            endpoint = "/api/domestic/payment/paypal/capture";
          } else {
            endpoint = "/api/payment/paypal/capture";
          }
          bodyPayload = { orderId };
        } else {
          setErrorMessage(
            isZh ? "不支持的支付渠道，无法确认支付。" : "Unsupported payment provider, unable to confirm payment.",
          );
          setConfirming(false);
          return;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(bodyPayload),
        });

        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "确认支付失败");
        }

        sessionStorage.removeItem("alipay_order_id");
        sessionStorage.removeItem("wechat_pay_order");
        sessionStorage.removeItem("stripe_session_id");
        sessionStorage.removeItem("paypal_order_id");
        sessionStorage.setItem(
          "mornstudio_payment_confirmed_at",
          String(Date.now()),
        );
        window.dispatchEvent(new CustomEvent("quota:refresh"));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "确认支付失败");
      } finally {
        setConfirming(false);
      }
    };

    void runConfirm();
  }, [isDomesticVersion, isZh, searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 dark:from-[#0f1115] dark:via-[#111827] dark:to-[#0f172a] px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-[#1f2937]/85 shadow-xl p-6 space-y-5 text-center">
        {confirming ? (
          <div className="space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mx-auto" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {isZh ? "正在确认支付状态..." : "Confirming payment..."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-emerald-600">
              {errorMessage
                ? isZh
                  ? "支付确认失败"
                  : "Payment Confirmation Failed"
                : isZh
                  ? "支付成功"
                  : "Payment Successful"}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {errorMessage
                ? errorMessage
                : isZh
                  ? "订阅已生效，额度已刷新。"
                  : "Subscription is active and quota is refreshed."}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={confirming}
            onClick={() => {
              router.replace("/");
            }}
            className="flex-1 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            {isZh ? "返回首页" : "Back to Home"}
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={() => {
              router.replace("/");
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent("quota:refresh"));
              }, 150);
            }}
            className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {isZh ? "刷新额度" : "Refresh Quota"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
