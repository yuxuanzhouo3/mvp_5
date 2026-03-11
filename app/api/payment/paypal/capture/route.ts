export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readGlobalOrderByProviderOrderId,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
  settleGlobalSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/global-payment";
import { capturePayPalOrder } from "@/lib/payment/providers/paypal-provider";

function isAmountMatched(expectedAmount: number, paidAmount: number) {
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
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
      const settled = await settleGlobalSubscriptionPayment({
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
        paid_at: settled.paidAt,
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

    const settled = await settleGlobalSubscriptionPayment({
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
      paid_at: settled.paidAt,
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
