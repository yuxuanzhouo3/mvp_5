export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertDomesticSubscriptionPurchaseAllowed,
  createDomesticSubscriptionOrder,
  ensureDomesticAppUser,
  getDomesticClientMeta,
  markDomesticOrderFailed,
  readDomesticOrderByProviderOrderId,
  readDomesticPlanPricing,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  resolveDomesticBillingPeriod,
  resolveDomesticPlanCode,
  toHttpError,
} from "@/lib/payment/domestic-payment";
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
    const body = (await request.json()) as CreateRequestBody;
    const planCode = resolveDomesticPlanCode(body.planName);
    if (!planCode) {
      return NextResponse.json(
        { success: false, error: "仅支持专业版或企业版订阅支付。" },
        { status: 400 },
      );
    }

    const billingPeriod = resolveDomesticBillingPeriod(body.billingPeriod);
    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    await ensureDomesticAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });
    await assertDomesticSubscriptionPurchaseAllowed({
      db,
      userId: user.userId,
      targetPlanCode: planCode,
    });

    const plan = await readDomesticPlanPricing({
      db,
      planCode,
      billingPeriod,
    });

    if (plan.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "当前套餐金额无效，请联系管理员。" },
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
          ? `${plan.displayNameCn} 年度订阅`
          : `${plan.displayNameCn} 月度订阅`,
      clientReferenceId: user.userId,
      metadata: {
        user_id: user.userId,
        source: "cn",
        plan_code: plan.planCode,
        billing_period: billingPeriod,
      },
    });

    if (!stripeSession.id || !stripeSession.url) {
      return NextResponse.json(
        { success: false, error: "Stripe 下单失败，请稍后重试。" },
        { status: 500 },
      );
    }

    const order = await createDomesticSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      provider: "stripe",
      providerOrderId: stripeSession.id,
      clientMeta: getDomesticClientMeta(request),
    }).catch(async (orderError) => {
      const reason =
        orderError instanceof Error ? orderError.message : "创建本地订单失败";

      try {
        await expireStripeCheckoutSession(stripeSession.id);
      } catch (expireError) {
        console.warn(
          "[Domestic Stripe Create] failed to expire orphan checkout session:",
          expireError,
        );
      }

      try {
        const orphanOrder = await readDomesticOrderByProviderOrderId({
          db,
          provider: "stripe",
          providerOrderId: stripeSession.id,
        });
        const orphanOrderId = typeof orphanOrder?.id === "string" ? orphanOrder.id : "";
        if (orphanOrderId) {
          await markDomesticOrderFailed({
            db,
            orderId: orphanOrderId,
            providerOrderId: stripeSession.id,
            provider: "stripe",
            reason,
          });
        }
      } catch (rollbackError) {
        console.warn(
          "[Domestic Stripe Create] failed to mark orphan local order as failed:",
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
    console.error("[Domestic Stripe Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
