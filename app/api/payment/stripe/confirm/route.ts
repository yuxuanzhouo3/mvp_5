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
import { retrieveStripeCheckoutSession } from "@/lib/payment/providers/stripe-provider";

function isAmountMatched(expectedAmount: number, paidAmountInCents: number | null) {
  if (paidAmountInCents === null) {
    return true;
  }

  const paidAmount = Number((paidAmountInCents / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "Missing Stripe sessionId" },
        { status: 400 },
      );
    }

    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    const order = await readGlobalOrderByProviderOrderId({
      db,
      provider: "stripe",
      providerOrderId: sessionId,
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

    const session = await retrieveStripeCheckoutSession(sessionId);
    if ((session.paymentStatus || "").toLowerCase() !== "paid") {
      return NextResponse.json({
        success: false,
        status: session.paymentStatus,
        error: "Payment not completed",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, session.amountTotal)) {
      return NextResponse.json(
        { success: false, error: "Payment amount verification failed" },
        { status: 400 },
      );
    }

    const settled = await settleGlobalSubscriptionPayment({
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
      paid_at: settled.paidAt,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Global Stripe Confirm] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
