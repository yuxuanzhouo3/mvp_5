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
import { createAlipayProviderFromEnv } from "@/lib/payment/providers/alipay-provider";

function isAmountMatched(expectedAmount: number, paidAmountText: string | null) {
  if (!paidAmountText) {
    return true;
  }
  const paidAmount = Number(paidAmountText);
  if (!Number.isFinite(paidAmount)) {
    return true;
  }
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

function pickAmountForValidation(input: {
  buyerPayAmount: string | null;
  totalAmount: string | null;
}) {
  const total = Number(input.totalAmount);
  const buyer = Number(input.buyerPayAmount);

  // 支付宝沙箱常出现 buyer_pay_amount = 0.00，优先使用 total_amount 做主校验。
  if (Number.isFinite(total) && total > 0) {
    return input.totalAmount;
  }
  if (Number.isFinite(buyer) && buyer > 0) {
    return input.buyerPayAmount;
  }
  if (Number.isFinite(total)) {
    return input.totalAmount;
  }
  if (Number.isFinite(buyer)) {
    return input.buyerPayAmount;
  }
  return input.totalAmount || input.buyerPayAmount || null;
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

    const alipayProvider = createAlipayProviderFromEnv();
    const status = await alipayProvider.queryPayment(outTradeNo);

    const isPaid =
      status.tradeStatus === "TRADE_SUCCESS" ||
      status.tradeStatus === "TRADE_FINISHED";

    if (!isPaid) {
      return NextResponse.json({
        success: false,
        status: status.tradeStatus,
        error: "支付尚未完成",
      });
    }

    const expectedAmount = Number(order.amount || 0);
    const paidAmountText = pickAmountForValidation({
      buyerPayAmount: status.buyerPayAmount,
      totalAmount: status.totalAmount,
    });
    if (
      !isAmountMatched(
        expectedAmount,
        paidAmountText,
      )
    ) {
      console.warn("[Alipay Confirm] amount mismatch", {
        outTradeNo,
        expectedAmount,
        buyerPayAmount: status.buyerPayAmount,
        totalAmount: status.totalAmount,
        pickedPaidAmount: paidAmountText,
      });
      return NextResponse.json(
        { success: false, error: "支付金额校验失败" },
        { status: 400 },
      );
    }

    const settled = await settleDomesticSubscriptionPayment({
      db,
      order,
      provider: "alipay",
      providerOrderId: outTradeNo,
      providerTransactionId: status.tradeNo,
      providerPayload: {
        trade_status: status.tradeStatus,
        trade_no: status.tradeNo,
        total_amount: status.totalAmount,
        buyer_pay_amount: status.buyerPayAmount,
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
    console.error("[Alipay Confirm] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
