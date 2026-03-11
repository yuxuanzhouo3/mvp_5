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
import { capturePayPalOrder } from "@/lib/payment/providers/paypal-provider";

function isAmountMatched(expectedAmount: number, paidAmount: number) {
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

export async function POST(request: NextRequest) {
  const enableDomesticPayPal =
    process.env.ENABLE_DOMESTIC_PAYPAL_PAYMENT === "true";
  if (!enableDomesticPayPal) {
    return NextResponse.json(
      {
        success: false,
        error: "国内版仅支持支付宝和微信支付，不支持 PayPal。",
      },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as { orderId?: unknown };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "缺少 PayPal orderId" },
        { status: 400 },
      );
    }

    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    const order = await readDomesticOrderByProviderOrderId({
      db,
      provider: "paypal",
      providerOrderId: orderId,
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

    if ((order.payment_status || "").toLowerCase() === "paid") {
      const settled = await settleDomesticSubscriptionPayment({
        db,
        order,
        provider: "paypal",
        providerOrderId: orderId,
        providerTransactionId: order.provider_transaction_id || null,
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
    }

    const captureResult = await capturePayPalOrder(orderId);
    if ((captureResult.status || "").toUpperCase() !== "COMPLETED") {
      return NextResponse.json({
        success: false,
        status: captureResult.status,
        error: "支付尚未完成",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, captureResult.amount)) {
      return NextResponse.json(
        { success: false, error: "支付金额校验失败" },
        { status: 400 },
      );
    }

    const settled = await settleDomesticSubscriptionPayment({
      db,
      order,
      provider: "paypal",
      providerOrderId: orderId,
      providerTransactionId: captureResult.captureId,
      providerPayload: captureResult.raw,
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
    console.error("[Domestic PayPal Capture] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
