/**
 * 支付埋点追踪助手模块
 * 统一处理支付和订阅事件的数据埋点
 */

import { trackAnalyticsEvent } from "@/services/analytics";

export interface PaymentTrackingParams {
  userId: string;
  amount: number;
  currency: string;
  plan: string;
  provider: string;
  orderId: string;
}

export interface SubscriptionTrackingParams {
  userId: string;
  action: "subscribe" | "upgrade" | "renew" | "downgrade";
  fromPlan?: string;
  toPlan: string;
  period: "monthly" | "annual";
}

/**
 * 追踪支付事件（静默失败）
 */
export function trackPayment(params: PaymentTrackingParams): void {
  trackAnalyticsEvent({
    userId: params.userId,
    eventType: "payment",
    eventData: {
      amount: params.amount,
      currency: params.currency,
      plan: params.plan,
      provider: params.provider,
      orderId: params.orderId,
    },
  }).catch((err: Error) => console.warn(`[analytics] trackPayment error:`, err));
}

/**
 * 追踪订阅变更事件（静默失败）
 */
export function trackSubscription(params: SubscriptionTrackingParams): void {
  trackAnalyticsEvent({
    userId: params.userId,
    eventType: "subscription",
    eventData: {
      action: params.action,
      fromPlan: params.fromPlan || "Free",
      toPlan: params.toPlan,
      period: params.period,
    },
  }).catch((err: Error) => console.warn(`[analytics] trackSubscription error:`, err));
}

/**
 * 追踪支付和订阅事件（组合调用）
 */
export function trackPaymentAndSubscription(
  payment: PaymentTrackingParams,
  subscription: Omit<SubscriptionTrackingParams, "userId">
): void {
  trackPayment(payment);
  trackSubscription({ userId: payment.userId, ...subscription });
}
