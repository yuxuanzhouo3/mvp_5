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
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
} from "@/lib/payment/providers/stripe-provider";

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
    const successUrl = `${origin}/payment/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/`;

    const stripeSession = await createStripeCheckoutSession({
      amount: plan.amount,
      currency: plan.currency,
      successUrl,
      cancelUrl,
      description:
        billingPeriod === "yearly"
          ? `${plan.displayNameEn} yearly subscription`
          : `${plan.displayNameEn} monthly subscription`,
      clientReferenceId: user.userId,
      metadata: {
        user_id: user.userId,
        source: "global",
        plan_code: plan.planCode,
        billing_period: billingPeriod,
      },
    });

    if (!stripeSession.id || !stripeSession.url) {
      return NextResponse.json(
        { success: false, error: "Failed to create Stripe checkout session." },
        { status: 500 },
      );
    }

    const order = await createGlobalSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      provider: "stripe",
      providerOrderId: stripeSession.id,
      clientMeta: getGlobalClientMeta(request),
    }).catch(async (orderError) => {
      const reason =
        orderError instanceof Error ? orderError.message : "创建本地订单失败";

      try {
        await expireStripeCheckoutSession(stripeSession.id);
      } catch (expireError) {
        console.warn(
          "[Global Stripe Create] failed to expire orphan checkout session:",
          expireError,
        );
      }

      try {
        const orphanOrder = await readGlobalOrderByProviderOrderId({
          db,
          provider: "stripe",
          providerOrderId: stripeSession.id,
        });
        const orphanOrderId = typeof orphanOrder?.id === "string" ? orphanOrder.id : "";
        if (orphanOrderId) {
          await markGlobalOrderFailed({
            db,
            orderId: orphanOrderId,
            providerOrderId: stripeSession.id,
            provider: "stripe",
            reason,
          });
        }
      } catch (rollbackError) {
        console.warn(
          "[Global Stripe Create] failed to mark orphan local order as failed:",
          rollbackError,
        );
      }

      throw orderError;
    });

    return NextResponse.json({
      success: true,
      orderId: order.orderId,
      sessionId: stripeSession.id,
      url: stripeSession.url,
      amount: plan.amount,
      currency: plan.currency,
      planCode,
      billingPeriod,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Global Stripe Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
