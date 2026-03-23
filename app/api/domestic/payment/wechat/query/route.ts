export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createWechatProviderFromEnv } from "@/lib/payment/providers/wechat-provider";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const outTradeNo = searchParams.get("out_trade_no")?.trim() || "";

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

    if ((order.payment_status || "").trim().toLowerCase() === "paid") {
      return NextResponse.json({
        success: true,
        trade_state: "SUCCESS",
        transaction_id: order.provider_transaction_id || null,
        amount:
          Number.isFinite(Number(order.amount))
            ? Math.max(1, Math.round(Number(order.amount) * 100))
            : null,
        success_time: order.paid_at || null,
        is_paid: true,
        local_status: "paid",
      });
    }

    const wechatProvider = createWechatProviderFromEnv();
    const status = await wechatProvider.queryOrderByOutTradeNo(outTradeNo);

    return NextResponse.json({
      success: true,
      trade_state: status.tradeState,
      transaction_id: status.transactionId,
      amount: status.amountInFen,
      success_time: status.successTime,
      is_paid: status.tradeState === "SUCCESS",
      local_status: order.payment_status || "pending",
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Wechat Query] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
