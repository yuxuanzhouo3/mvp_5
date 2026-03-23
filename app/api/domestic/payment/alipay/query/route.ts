export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  toHttpError,
} from "@/lib/payment/domestic-payment";
import { createAlipayProviderFromEnv } from "@/lib/payment/providers/alipay-provider";

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
      provider: "alipay",
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
      const amount =
        Number.isFinite(Number(order.amount)) ? Number(order.amount).toFixed(2) : null;

      return NextResponse.json({
        success: true,
        status: "TRADE_SUCCESS",
        is_paid: true,
        trade_no: order.provider_transaction_id || null,
        total_amount: amount,
        buyer_pay_amount: amount,
        local_status: "paid",
      });
    }

    const alipayProvider = createAlipayProviderFromEnv();
    const status = await alipayProvider.queryPayment(outTradeNo);
    const isPaid =
      status.tradeStatus === "TRADE_SUCCESS" ||
      status.tradeStatus === "TRADE_FINISHED";

    return NextResponse.json({
      success: true,
      status: status.tradeStatus,
      is_paid: isPaid,
      trade_no: status.tradeNo,
      total_amount: status.totalAmount,
      buyer_pay_amount: status.buyerPayAmount,
      local_status: order.payment_status || "pending",
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Alipay Query] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
