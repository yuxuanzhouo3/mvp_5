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
import { createAlipayProviderFromEnv } from "@/lib/payment/providers/alipay-provider";

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

    providerOrderId = generateProviderOrderId("ALI");
    const order = await createDomesticSubscriptionOrder({
      db,
      userId: user.userId,
      userEmail: user.email,
      plan,
      provider: "alipay",
      providerOrderId,
      clientMeta: getDomesticClientMeta(request),
    });
    orderId = order.orderId;

    const alipayProvider = createAlipayProviderFromEnv();
    const paymentResult = await alipayProvider.createPayment({
      outTradeNo: providerOrderId,
      amount: plan.amount,
      description:
        billingPeriod === "yearly"
          ? `${plan.displayNameCn} 年度订阅`
          : `${plan.displayNameCn} 月度订阅`,
      passbackParams: user.userId,
    });

    return NextResponse.json({
      success: true,
      paymentId: providerOrderId,
      orderId: order.orderId,
      amount: plan.amount,
      currency: plan.currency,
      billingPeriod,
      planCode,
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
