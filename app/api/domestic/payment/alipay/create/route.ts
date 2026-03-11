export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertDomesticSubscriptionPurchaseAllowed,
  createDomesticAddonOrder,
  createDomesticSubscriptionOrder,
  ensureDomesticAppUser,
  generateProviderOrderId,
  getDomesticClientMeta,
  markDomesticOrderFailed,
  prepareDomesticSubscriptionCheckout,
  readDomesticAddonPricing,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  resolveDomesticAddonCode,
  resolveDomesticBillingPeriod,
  resolveDomesticPlanCode,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createAlipayProviderFromEnv } from "@/lib/payment/providers/alipay-provider";

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

export async function POST(request: NextRequest) {
  let orderId = "";
  let providerOrderId = "";

  try {
    const body = (await request.json()) as CreateRequestBody;
    const productType = resolveProductType(body.productType);
    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    await ensureDomesticAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    providerOrderId = generateProviderOrderId("ALI");
    let order: { orderId: string; orderNo: string };
    let amount = 0;
    let currency: "CNY" = "CNY";
    let planCode: string | null = null;
    let billingPeriod: string | null = null;
    let addonCode: string | null = null;
    let description = "";
    let passbackParams = "";

    if (productType === "ADDON") {
      const resolvedAddonCode = resolveDomesticAddonCode(body.addonPackageId);
      if (!resolvedAddonCode) {
        return NextResponse.json(
          { success: false, error: "仅支持已配置的加油包支付。" },
          { status: 400 },
        );
      }

      const addon = await readDomesticAddonPricing({
        db,
        addonCode: resolvedAddonCode,
      });
      if (addon.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "当前加油包金额无效，请联系管理员。" },
          { status: 400 },
        );
      }

      amount = addon.amount;
      currency = addon.currency;
      addonCode = addon.addonCode;
      description = `${addon.displayNameCn} 加油包`;
      passbackParams = encodeURIComponent(
        JSON.stringify({
          user_id: user.userId,
          product_type: "addon",
          addon_code: addon.addonCode,
        }),
      );

      order = await createDomesticAddonOrder({
        db,
        userId: user.userId,
        userEmail: user.email,
        addon,
        provider: "alipay",
        providerOrderId,
        clientMeta: getDomesticClientMeta(request),
      });
    } else {
      const resolvedPlanCode = resolveDomesticPlanCode(body.planName);
      if (!resolvedPlanCode) {
        return NextResponse.json(
          { success: false, error: "仅支持专业版或企业版订阅支付。" },
          { status: 400 },
        );
      }

      const resolvedBillingPeriod = resolveDomesticBillingPeriod(body.billingPeriod);
      await assertDomesticSubscriptionPurchaseAllowed({
        db,
        userId: user.userId,
        targetPlanCode: resolvedPlanCode,
      });

      const subscriptionQuote = await prepareDomesticSubscriptionCheckout({
        db,
        userId: user.userId,
        planCode: resolvedPlanCode,
        billingPeriod: resolvedBillingPeriod,
      });
      const plan = subscriptionQuote.checkoutPlan;

      if (plan.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "当前套餐金额无效，请联系管理员。" },
          { status: 400 },
        );
      }

      amount = plan.amount;
      currency = plan.currency;
      planCode = plan.planCode;
      billingPeriod = resolvedBillingPeriod;
      description =
        resolvedBillingPeriod === "yearly"
          ? `${plan.displayNameCn} 年度订阅`
          : `${plan.displayNameCn} 月度订阅`;
      passbackParams = encodeURIComponent(
        JSON.stringify({
          user_id: user.userId,
          product_type: "subscription",
          plan_code: plan.planCode,
          billing_period: resolvedBillingPeriod,
        }),
      );

      order = await createDomesticSubscriptionOrder({
        db,
        userId: user.userId,
        userEmail: user.email,
        plan,
        extraJson: subscriptionQuote.extraJson,
        provider: "alipay",
        providerOrderId,
        clientMeta: getDomesticClientMeta(request),
      });
    }
    orderId = order.orderId;

    const alipayProvider = createAlipayProviderFromEnv();
    const paymentResult = await alipayProvider.createPayment({
      outTradeNo: providerOrderId,
      amount,
      description,
      passbackParams,
    });

    return NextResponse.json({
      success: true,
      paymentId: providerOrderId,
      orderId: order.orderId,
      amount,
      currency,
      productType,
      billingPeriod,
      planCode,
      addonCode,
      formHtml: paymentResult.formHtml,
    });
  } catch (error) {
    if (orderId && providerOrderId) {
      try {
        const db = await requireDomesticRuntimeDb();
        await markDomesticOrderFailed({
          db,
          orderId,
          providerOrderId,
          provider: "alipay",
          reason: error instanceof Error ? error.message : "支付宝下单失败",
        });
      } catch (rollbackError) {
        console.warn("[Alipay Create] rollback failed:", rollbackError);
      }
    }

    const httpError = toHttpError(error);
    console.error("[Alipay Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
