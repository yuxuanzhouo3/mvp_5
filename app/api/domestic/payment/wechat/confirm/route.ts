export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  settleDomesticSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createWechatProviderFromEnv } from "@/lib/payment/providers/wechat-provider";

function isAmountMatched(expectedAmount: number, paidFen: number | null) {
  if (paidFen === null) {
    return true;
  }
  const paidAmount = Number((paidFen / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
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

    const settled = await settleDomesticSubscriptionPayment({
      db,
      order,
      provider: "wechat_pay",
      providerOrderId: outTradeNo,
      providerTransactionId: status.transactionId,
      providerPayload: {
        trade_state: status.tradeState,
        transaction_id: status.transactionId,
        amount_in_fen: status.amountInFen,
        success_time: status.successTime,
      },
    });

    return NextResponse.json({
      success: true,
      status: "COMPLETED",
      already_paid: settled.alreadyPaid,
      plan_code: settled.planCode,
      plan_expires_at: settled.planExpiresAt || null,
      paid_at: settled.paidAt,
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