export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readGlobalOrderByProviderOrderId,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
  settleGlobalAddonPayment,
  settleGlobalSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/global-payment";
import { capturePayPalOrder } from "@/lib/payment/providers/paypal-provider";

function isAmountMatched(expectedAmount: number, paidAmount: number) {
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

function isAddonOrder(orderType: unknown) {
  return typeof orderType === "string" && orderType.trim().toLowerCase() === "addon";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { orderId?: unknown };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Missing PayPal orderId" },
        { status: 400 },
      );
    }

    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    const order = await readGlobalOrderByProviderOrderId({
      db,
      provider: "paypal",
      providerOrderId: orderId,
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 },
      );
    }

    if ((order.user_id || "").trim() !== user.userId) {
      return NextResponse.json(
        { success: false, error: "Forbidden order access" },
        { status: 403 },
      );
    }

    if ((order.payment_status || "").toLowerCase() === "paid") {
      const settled = isAddonOrder(order.order_type)
        ? await settleGlobalAddonPayment({
            db,
            order,
            provider: "paypal",
            providerOrderId: orderId,
            providerTransactionId: order.provider_transaction_id || null,
          })
        : await settleGlobalSubscriptionPayment({
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
        productType: isAddonOrder(order.order_type) ? "ADDON" : "SUBSCRIPTION",
        plan_code: "planCode" in settled ? settled.planCode : null,
        plan_expires_at: "planExpiresAt" in settled ? settled.planExpiresAt || null : null,
        subscription_status:
          "effectiveStatus" in settled ? settled.effectiveStatus || null : null,
        effective_at: "effectiveAt" in settled ? settled.effectiveAt || null : null,
        addon_code: "addonCode" in settled ? settled.addonCode : null,
        granted_at: "grantedAt" in settled ? settled.grantedAt : null,
        paid_at: "paidAt" in settled ? settled.paidAt : null,
      });
    }

    const captureResult = await capturePayPalOrder(orderId);
    if ((captureResult.status || "").toUpperCase() !== "COMPLETED") {
      return NextResponse.json({
        success: false,
        status: captureResult.status,
        error: "Payment not completed",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, captureResult.amount)) {
      return NextResponse.json(
        { success: false, error: "Payment amount verification failed" },
        { status: 400 },
      );
    }

    const settled = isAddonOrder(order.order_type)
      ? await settleGlobalAddonPayment({
          db,
          order,
          provider: "paypal",
          providerOrderId: orderId,
          providerTransactionId: captureResult.captureId,
          providerPayload: captureResult.raw,
        })
      : await settleGlobalSubscriptionPayment({
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
      productType: isAddonOrder(order.order_type) ? "ADDON" : "SUBSCRIPTION",
      plan_code: "planCode" in settled ? settled.planCode : null,
      plan_expires_at: "planExpiresAt" in settled ? settled.planExpiresAt || null : null,
      subscription_status:
        "effectiveStatus" in settled ? settled.effectiveStatus || null : null,
      effective_at: "effectiveAt" in settled ? settled.effectiveAt || null : null,
      addon_code: "addonCode" in settled ? settled.addonCode : null,
      granted_at: "grantedAt" in settled ? settled.grantedAt : null,
      paid_at: "paidAt" in settled ? settled.paidAt : null,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Global PayPal Capture] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
