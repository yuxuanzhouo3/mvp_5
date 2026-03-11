export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  settleDomesticSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { retrieveStripeCheckoutSession } from "@/lib/payment/providers/stripe-provider";

function isAmountMatched(expectedAmount: number, paidAmountInCents: number | null) {
  if (paidAmountInCents === null) {
    return true;
  }

  const paidAmount = Number((paidAmountInCents / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

export async function POST(request: NextRequest) {
  const enableDomesticStripe =
    process.env.ENABLE_DOMESTIC_STRIPE_PAYMENT === "true";
  if (!enableDomesticStripe) {
    return NextResponse.json(
      {
        success: false,
        error: "国内版仅支持支付宝和微信支付，不支持 Stripe。",
      },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "缺少 Stripe sessionId" },
        { status: 400 },
      );
    }

    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    const order = await readDomesticOrderByProviderOrderId({
      db,
      provider: "stripe",
      providerOrderId: sessionId,
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在" },
        { status: 404 },
      );
    }

    if ((order.user_id || "").trim() !== user.userId) {
      return NextResponse.json(
        { success: false, error: "无权访问该订单" },
        { status: 403 },
      );
    }

    const session = await retrieveStripeCheckoutSession(sessionId);
    if ((session.paymentStatus || "").toLowerCase() !== "paid") {
      return NextResponse.json({
        success: false,
        status: session.paymentStatus,
        error: "支付尚未完成",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, session.amountTotal)) {
      return NextResponse.json(
        { success: false, error: "支付金额校验失败" },
        { status: 400 },
      );
    }

    const settled = await settleDomesticSubscriptionPayment({
      db,
      order,
      provider: "stripe",
      providerOrderId: sessionId,
      providerTransactionId: session.paymentIntentId,
      providerPayload: {
        payment_status: session.paymentStatus,
        amount_total: session.amountTotal,
        currency: session.currency,
        payment_intent: session.paymentIntentId,
        metadata: session.metadata,
      },
    });

    return NextResponse.json({
      success: true,
      status: "COMPLETED",
      already_paid: settled.alreadyPaid,
      plan_code: settled.planCode,
      plan_expires_at: settled.planExpiresAt || null,
      subscription_status: settled.effectiveStatus || null,
      effective_at: settled.effectiveAt || null,
      paid_at: settled.paidAt,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Domestic Stripe Confirm] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
