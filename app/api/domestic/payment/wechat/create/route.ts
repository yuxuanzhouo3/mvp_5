export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertDomesticSubscriptionPurchaseAllowed,
  createDomesticSubscriptionOrder,
  ensureDomesticAppUser,
  generateProviderOrderId,
  getDomesticClientMeta,
  markDomesticOrderFailed,
  readDomesticPlanPricing,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  resolveDomesticBillingPeriod,
  resolveDomesticPlanCode,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createWechatProviderFromEnv } from "@/lib/payment/providers/wechat-provider";

type CreateRequestBody = {
  planName?: unknown;
  billingPeriod?: unknown;
};

export async function POST(request: NextRequest) {
  let orderId = "";
  let providerOrderId = "";

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

    providerOrderId = generateProviderOrderId("WX");
    const order = await createDomesticSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      provider: "wechat_pay",
      providerOrderId,
      clientMeta: getDomesticClientMeta(request),
    });
    orderId = order.orderId;

    const wechatProvider = createWechatProviderFromEnv();
    const paymentResult = await wechatProvider.createNativePayment({
      outTradeNo: providerOrderId,
      amountInFen: Math.max(1, Math.round(plan.amount * 100)),
      description:
        billingPeriod === "yearly"
          ? `${plan.displayNameCn} 年度订阅`
          : `${plan.displayNameCn} 月度订阅`,
      attach: user.userId,
    });

    return NextResponse.json({
      success: true,
      out_trade_no: providerOrderId,
      code_url: paymentResult.codeUrl,
      amount: plan.amount,
      currency: plan.currency,
      billingPeriod,
      planCode,
      orderId: order.orderId,
      expires_in: 7200,
    });
  } catch (error) {
    if (orderId && providerOrderId) {
      try {
        const db = await requireDomesticRuntimeDb();
        await markDomesticOrderFailed({
          db,
          orderId,
          providerOrderId,
          provider: "wechat_pay",
          reason: error instanceof Error ? error.message : "微信下单失败",
        });
      } catch (rollbackError) {
        console.warn("[Wechat Create] rollback failed:", rollbackError);
      }
    }

    const httpError = toHttpError(error);
    console.error("[Wechat Create] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
