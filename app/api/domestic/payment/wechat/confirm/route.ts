export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  settleDomesticAddonPayment,
  settleDomesticSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createWechatProviderFromEnv } from "@/lib/payment/providers/wechat-provider";

function isAmountMatched(expectedAmount: number, paidFen: number | null) {
  if (paidFen === null) {
    return false;
  }
  const paidAmount = Number((paidFen / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

function isAddonOrder(orderType: unknown) {
  return typeof orderType === "string" && orderType.trim().toLowerCase() === "addon";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { outTradeNo?: unknown };
    const outTradeNo =
      typeof body.outTradeNo === "string" ? body.outTradeNo.trim() : "";

    if (!outTradeNo) {
      return NextResponse.json(
        { success: false, error: "缺少订单号" },
        { status: 400 },
      );
    }

    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    const order = await readDomesticOrderByProviderOrderId({
      db,
      provider: "wechat_pay",
      providerOrderId: outTradeNo,
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在" },
        { status: 404 },
      );
    }

    if ((order.user_id || "").trim() !== user.userId) {
      return NextResponse.json(
        { success: false, error: "无权访问该订单" },
        { status: 403 },
      );
    }

    const wechatProvider = createWechatProviderFromEnv();
    const status = await wechatProvider.queryOrderByOutTradeNo(outTradeNo);

    if (status.tradeState !== "SUCCESS") {
      return NextResponse.json({
        success: false,
        status: status.tradeState,
        error: "支付尚未完成",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, status.amountInFen)) {
      return NextResponse.json(
        { success: false, error: "支付金额校验失败" },
        { status: 400 },
      );
    }

    const providerPayload = {
      trade_state: status.tradeState,
      transaction_id: status.transactionId,
      amount_in_fen: status.amountInFen,
      success_time: status.successTime,
    };
    const settled = isAddonOrder(order.order_type)
      ? await settleDomesticAddonPayment({
          db,
          order,
          provider: "wechat_pay",
          providerOrderId: outTradeNo,
          providerTransactionId: status.transactionId,
          providerPayload,
        })
      : await settleDomesticSubscriptionPayment({
          db,
          order,
          provider: "wechat_pay",
          providerOrderId: outTradeNo,
          providerTransactionId: status.transactionId,
          providerPayload,
        });

    return NextResponse.json({
      success: true,
      status: "COMPLETED",
      already_paid: settled.alreadyPaid,
      productType: isAddonOrder(order.order_type) ? "ADDON" : "SUBSCRIPTION",
      plan_code: "planCode" in settled ? settled.planCode : null,
      plan_expires_at: "planExpiresAt" in settled ? settled.planExpiresAt || null : null,
      subscription_status:
        "effectiveStatus" in settled ? settled.effectiveStatus || null : null,
      effective_at: "effectiveAt" in settled ? settled.effectiveAt || null : null,
      addon_code: "addonCode" in settled ? settled.addonCode : null,
      granted_at: "grantedAt" in settled ? settled.grantedAt : null,
      paid_at: "paidAt" in settled ? settled.paidAt : null,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Wechat Confirm] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
