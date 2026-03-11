export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertGlobalSubscriptionPurchaseAllowed,
  createGlobalSubscriptionOrder,
  ensureGlobalAppUser,
  getGlobalClientMeta,
  markGlobalOrderFailed,
  readGlobalOrderByProviderOrderId,
  readGlobalPlanPricing,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
  resolveGlobalBillingPeriod,
  resolveGlobalPlanCode,
  toHttpError,
} from "@/lib/payment/global-payment";
import {
  cancelPayPalOrder,
  createPayPalOrder,
} from "@/lib/payment/providers/paypal-provider";

type CreateRequestBody = {
  planName?: unknown;
  billingPeriod?: unknown;
};

function resolveOrigin(request: NextRequest) {
  const envBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.APP_URL?.trim().replace(/\/$/, "") ||
    "";

  if (envBase) {
    return envBase;
  }

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateRequestBody;
    const planCode = resolveGlobalPlanCode(body.planName);
    if (!planCode) {
      return NextResponse.json(
        { success: false, error: "Only Pro and Enterprise subscriptions are supported." },
        { status: 400 },
      );
    }

    const billingPeriod = resolveGlobalBillingPeriod(body.billingPeriod);
    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    await ensureGlobalAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });
    await assertGlobalSubscriptionPurchaseAllowed({
      db,
      userId: user.userId,
      targetPlanCode: planCode,
    });

    const plan = await readGlobalPlanPricing({
      db,
      planCode,
      billingPeriod,
    });

    if (plan.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid plan amount. Please contact support." },
        { status: 400 },
      );
    }

    const origin = resolveOrigin(request);
    const payPalOrder = await createPayPalOrder({
      amount: plan.amount,
      currency: plan.currency,
      returnUrl: `${origin}/payment/success?provider=paypal`,
      cancelUrl: `${origin}/`,
      customId: `${user.userId}|${planCode}|${billingPeriod}`,
      description:
        billingPeriod === "yearly"
          ? `${plan.displayNameEn} yearly subscription`
          : `${plan.displayNameEn} monthly subscription`,
    });

    if (!payPalOrder.orderId || !payPalOrder.approvalUrl) {
      return NextResponse.json(
        { success: false, error: "Failed to create PayPal order." },
        { status: 500 },
      );
    }

    const order = await createGlobalSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      provider: "paypal",
      providerOrderId: payPalOrder.orderId,
      clientMeta: getGlobalClientMeta(request),
    }).catch(async (orderError) => {
      const reason =
        orderError instanceof Error ? orderError.message : "创建本地订单失败";

      try {
        await cancelPayPalOrder(payPalOrder.orderId);
      } catch (cancelError) {
        console.warn(
          "[Global PayPal Create] failed to cancel orphan paypal order:",
          cancelError,
        );
      }

      try {
        const orphanOrder = await readGlobalOrderByProviderOrderId({
          db,
          provider: "paypal",
          providerOrderId: payPalOrder.orderId,
        });
        const orphanOrderId = typeof orphanOrder?.id === "string" ? orphanOrder.id : "";
        if (orphanOrderId) {
          await markGlobalOrderFailed({
            db,
            orderId: orphanOrderId,
            providerOrderId: payPalOrder.orderId,
            provider: "paypal",
            reason,
          });
        }
      } catch (rollbackError) {
        console.warn(
          "[Global PayPal Create] failed to mark orphan local order as failed:",
          rollbackError,
        );
      }

      throw orderError;
    });

    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      providerOrderId: payPalOrder.orderId,
      approvalUrl: payPalOrder.approvalUrl,
      amount: plan.amount,
      currency: plan.currency,
      planCode,
      billingPeriod,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Global PayPal Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
