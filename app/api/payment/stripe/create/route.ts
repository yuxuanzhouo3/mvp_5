export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertGlobalSubscriptionPurchaseAllowed,
  createGlobalAddonOrder,
  createGlobalSubscriptionOrder,
  ensureGlobalAppUser,
  getGlobalClientMeta,
  markGlobalOrderFailed,
  prepareGlobalSubscriptionCheckout,
  readGlobalAddonPricing,
  readGlobalOrderByProviderOrderId,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
  resolveGlobalAddonCode,
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
  productType?: unknown;
  addonPackageId?: unknown;
};

function resolveProductType(input: unknown) {
  return typeof input === "string" && input.trim().toUpperCase() === "ADDON"
    ? "ADDON"
    : "SUBSCRIPTION";
}

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
    const productType = resolveProductType(body.productType);
    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    await ensureGlobalAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    const origin = resolveOrigin(request);
    const successUrl = `${origin}/payment/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/`;
    let stripeSession: Awaited<ReturnType<typeof createStripeCheckoutSession>>;
    let amount = 0;
    let currency: "USD" = "USD";
    let planCode: string | null = null;
    let billingPeriod: string | null = null;
    let addonCode: string | null = null;
    let addonPlan: Awaited<ReturnType<typeof readGlobalAddonPricing>> | null = null;
    let subscriptionQuote: Awaited<
      ReturnType<typeof prepareGlobalSubscriptionCheckout>
    > | null = null;

    if (productType === "ADDON") {
      const resolvedAddonCode = resolveGlobalAddonCode(body.addonPackageId);
      if (!resolvedAddonCode) {
        return NextResponse.json(
          { success: false, error: "Unsupported add-on package." },
          { status: 400 },
        );
      }

      addonPlan = await readGlobalAddonPricing({
        db,
        addonCode: resolvedAddonCode,
      });

      if (addonPlan.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "Invalid add-on amount. Please contact support." },
          { status: 400 },
        );
      }

      amount = addonPlan.amount;
      currency = addonPlan.currency;
      addonCode = addonPlan.addonCode;

      stripeSession = await createStripeCheckoutSession({
        amount: addonPlan.amount,
        currency: addonPlan.currency,
        successUrl,
        cancelUrl,
        description: `${addonPlan.displayNameEn} add-on pack`,
        clientReferenceId: user.userId,
        metadata: {
          user_id: user.userId,
          source: "global",
          product_type: "addon",
          addon_code: addonPlan.addonCode,
        },
      });
    } else {
      const resolvedPlanCode = resolveGlobalPlanCode(body.planName);
      if (!resolvedPlanCode) {
        return NextResponse.json(
          { success: false, error: "Only Pro and Enterprise subscriptions are supported." },
          { status: 400 },
        );
      }

      const resolvedBillingPeriod = resolveGlobalBillingPeriod(body.billingPeriod);
      await assertGlobalSubscriptionPurchaseAllowed({
        db,
        userId: user.userId,
        targetPlanCode: resolvedPlanCode,
      });

      subscriptionQuote = await prepareGlobalSubscriptionCheckout({
        db,
        userId: user.userId,
        planCode: resolvedPlanCode,
        billingPeriod: resolvedBillingPeriod,
      });
      const plan = subscriptionQuote.checkoutPlan;

      if (plan.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "Invalid plan amount. Please contact support." },
          { status: 400 },
        );
      }

      amount = plan.amount;
      currency = plan.currency;
      planCode = plan.planCode;
      billingPeriod = resolvedBillingPeriod;

      stripeSession = await createStripeCheckoutSession({
        amount: plan.amount,
        currency: plan.currency,
        successUrl,
        cancelUrl,
        description:
          resolvedBillingPeriod === "yearly"
            ? `${plan.displayNameEn} yearly subscription`
            : `${plan.displayNameEn} monthly subscription`,
        clientReferenceId: user.userId,
        metadata: {
          user_id: user.userId,
          source: "global",
          product_type: "subscription",
          plan_code: plan.planCode,
          billing_period: resolvedBillingPeriod,
        },
      });
    }

    if (!stripeSession.id || !stripeSession.url) {
      return NextResponse.json(
        { success: false, error: "Failed to create Stripe checkout session." },
        { status: 500 },
      );
    }

    const createOrder =
      productType === "ADDON"
        ? createGlobalAddonOrder({
            db,
            userId: user.userId,
            userEmail: user.email,
            addon: addonPlan!,
            provider: "stripe",
            providerOrderId: stripeSession.id,
            clientMeta: getGlobalClientMeta(request),
          })
        : createGlobalSubscriptionOrder({
            db,
            userId: user.userId,
            userEmail: user.email,
            plan: subscriptionQuote!.checkoutPlan,
            extraJson: subscriptionQuote!.extraJson,
            provider: "stripe",
            providerOrderId: stripeSession.id,
            clientMeta: getGlobalClientMeta(request),
          });

    const order = await createOrder.catch(async (orderError) => {
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
      amount,
      currency,
      productType,
      planCode,
      billingPeriod,
      addonCode,
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
