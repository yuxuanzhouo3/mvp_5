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
  cancelPayPalOrder,
  createPayPalOrder,
} from "@/lib/payment/providers/paypal-provider";

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
    let payPalOrder: Awaited<ReturnType<typeof createPayPalOrder>>;
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

      payPalOrder = await createPayPalOrder({
        amount: addonPlan.amount,
        currency: addonPlan.currency,
        returnUrl: `${origin}/payment/success?provider=paypal`,
        cancelUrl: `${origin}/`,
        customId: `${user.userId}|addon|${addonPlan.addonCode}`,
        description: `${addonPlan.displayNameEn} add-on pack`,
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

      payPalOrder = await createPayPalOrder({
        amount: plan.amount,
        currency: plan.currency,
        returnUrl: `${origin}/payment/success?provider=paypal`,
        cancelUrl: `${origin}/`,
        customId: `${user.userId}|subscription|${plan.planCode}|${resolvedBillingPeriod}`,
        description:
          resolvedBillingPeriod === "yearly"
            ? `${plan.displayNameEn} yearly subscription`
            : `${plan.displayNameEn} monthly subscription`,
      });
    }

    if (!payPalOrder.orderId || !payPalOrder.approvalUrl) {
      return NextResponse.json(
        { success: false, error: "Failed to create PayPal order." },
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
            provider: "paypal",
            providerOrderId: payPalOrder.orderId,
            clientMeta: getGlobalClientMeta(request),
          })
        : createGlobalSubscriptionOrder({
            db,
            userId: user.userId,
            userEmail: user.email,
            plan: subscriptionQuote!.checkoutPlan,
            extraJson: subscriptionQuote!.extraJson,
            provider: "paypal",
            providerOrderId: payPalOrder.orderId,
            clientMeta: getGlobalClientMeta(request),
          });

    const order = await createOrder.catch(async (orderError) => {
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
      amount,
      currency,
      productType,
      planCode,
      billingPeriod,
      addonCode,
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
