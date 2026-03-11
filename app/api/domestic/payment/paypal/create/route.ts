export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertDomesticSubscriptionPurchaseAllowed,
  createDomesticSubscriptionOrder,
  ensureDomesticAppUser,
  getDomesticClientMeta,
  markDomesticOrderFailed,
  prepareDomesticSubscriptionCheckout,
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  resolveDomesticBillingPeriod,
  resolveDomesticPlanCode,
  toHttpError,
} from "@/lib/payment/domestic-payment";
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

    const subscriptionQuote = await prepareDomesticSubscriptionCheckout({
      db,
      userId: user.userId,
      planCode,
      billingPeriod,
    });
    const plan = subscriptionQuote.checkoutPlan;

    if (plan.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "当前套餐金额无效，请联系管理员。" },
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
          ? `${plan.displayNameCn} 年度订阅`
          : `${plan.displayNameCn} 月度订阅`,
    });

    if (!payPalOrder.orderId || !payPalOrder.approvalUrl) {
      return NextResponse.json(
        { success: false, error: "PayPal 下单失败，请稍后重试。" },
        { status: 500 },
      );
    }

    const order = await createDomesticSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      extraJson: subscriptionQuote.extraJson,
      provider: "paypal",
      providerOrderId: payPalOrder.orderId,
      clientMeta: getDomesticClientMeta(request),
    }).catch(async (orderError) => {
      const reason =
        orderError instanceof Error ? orderError.message : "创建本地订单失败";

      try {
        await cancelPayPalOrder(payPalOrder.orderId);
      } catch (cancelError) {
        console.warn(
          "[Domestic PayPal Create] failed to cancel orphan paypal order:",
          cancelError,
        );
      }

      try {
        const orphanOrder = await readDomesticOrderByProviderOrderId({
          db,
          provider: "paypal",
          providerOrderId: payPalOrder.orderId,
        });
        const orphanOrderId = typeof orphanOrder?.id === "string" ? orphanOrder.id : "";
        if (orphanOrderId) {
          await markDomesticOrderFailed({
            db,
            orderId: orphanOrderId,
            providerOrderId: payPalOrder.orderId,
            provider: "paypal",
            reason,
          });
        }
      } catch (rollbackError) {
        console.warn(
          "[Domestic PayPal Create] failed to mark orphan local order as failed:",
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
    console.error("[Domestic PayPal Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
