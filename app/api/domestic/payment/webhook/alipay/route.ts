export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticRuntimeDb,
  settleDomesticAddonPayment,
  settleDomesticSubscriptionPayment,
} from "@/lib/payment/domestic-payment";
import { createAlipayProviderFromEnv } from "@/lib/payment/providers/alipay-provider";

function parseAlipayBody(bodyText: string) {
  const searchParams = new URLSearchParams(bodyText);
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return {
    params,
    outTradeNo: searchParams.get("out_trade_no")?.trim() || "",
    tradeStatus: searchParams.get("trade_status")?.trim() || "",
    tradeNo: searchParams.get("trade_no")?.trim() || "",
    totalAmount: searchParams.get("total_amount")?.trim() || "",
    buyerPayAmount: searchParams.get("buyer_pay_amount")?.trim() || "",
  };
}

function isPaidTradeStatus(tradeStatus: string) {
  return tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED";
}

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

  // 支付宝沙箱常返回 buyer_pay_amount=0.00，校验应优先 total_amount。
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

function isAddonOrder(orderType: unknown) {
  return typeof orderType === "string" && orderType.trim().toLowerCase() === "addon";
}

export async function POST(request: NextRequest) {
  let outTradeNo = "";
  try {
    const bodyText = await request.text();
    const parsed = parseAlipayBody(bodyText);
    outTradeNo = parsed.outTradeNo;
    const alipayProvider = createAlipayProviderFromEnv();

    console.info("[Alipay Webhook] payload received", {
      hasBody: Boolean(bodyText),
      length: bodyText.length,
      out_trade_no: outTradeNo || null,
      trade_status: parsed.tradeStatus || null,
      has_sign: Boolean(parsed.params.sign),
      has_sign_type: Boolean(parsed.params.sign_type),
    });

    // 无订单号或非成功状态直接 ACK，避免无意义重试
    if (!outTradeNo || !isPaidTradeStatus(parsed.tradeStatus)) {
      return new NextResponse("success", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    // 对齐 mvp28-fix：先按支付宝参数验签（沙箱/开发环境自动放行）
    const isValidSignature = alipayProvider.verifyCallback(parsed.params);
    if (!isValidSignature) {
      console.error("[Alipay Webhook] signature verify failed", {
        outTradeNo,
      });
      return new NextResponse("failure", {
        status: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const db = await requireDomesticRuntimeDb();
    const order = await readDomesticOrderByProviderOrderId({
      db,
      provider: "alipay",
      providerOrderId: outTradeNo,
    });

    if (!order) {
      console.warn("[Alipay Webhook] order not found, ignore", { outTradeNo });
      return new NextResponse("success", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    // 二次向支付宝查询，防止伪造 webhook 直接结算
    const status = await alipayProvider.queryPayment(outTradeNo);
    if (!isPaidTradeStatus(status.tradeStatus)) {
      console.warn("[Alipay Webhook] payment not completed in provider query", {
        outTradeNo,
        tradeStatus: status.tradeStatus,
      });
      return new NextResponse("success", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const expectedAmount = Number(order.amount || 0);
    const paidAmountText = pickAmountForValidation({
      buyerPayAmount: status.buyerPayAmount,
      totalAmount: status.totalAmount,
    });
    if (!isAmountMatched(expectedAmount, paidAmountText)) {
      console.error("[Alipay Webhook] amount mismatch", {
        outTradeNo,
        expectedAmount,
        buyerPayAmount: status.buyerPayAmount,
        totalAmount: status.totalAmount,
        pickedPaidAmount: paidAmountText,
      });
      return new NextResponse("failure", {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const providerPayload = {
      webhook_trade_status: parsed.tradeStatus,
      webhook_trade_no: parsed.tradeNo,
      webhook_total_amount: parsed.totalAmount,
      webhook_buyer_pay_amount: parsed.buyerPayAmount,
      query_trade_status: status.tradeStatus,
      query_trade_no: status.tradeNo,
      query_total_amount: status.totalAmount,
      query_buyer_pay_amount: status.buyerPayAmount,
    };
    const settled = isAddonOrder(order.order_type)
      ? await settleDomesticAddonPayment({
          db,
          order,
          provider: "alipay",
          providerOrderId: outTradeNo,
          providerTransactionId: status.tradeNo,
          providerPayload,
        })
      : await settleDomesticSubscriptionPayment({
          db,
          order,
          provider: "alipay",
          providerOrderId: outTradeNo,
          providerTransactionId: status.tradeNo,
          providerPayload,
        });

    console.info("[Alipay Webhook] settled", {
      outTradeNo,
      alreadyPaid: settled.alreadyPaid,
      productType: isAddonOrder(order.order_type) ? "addon" : "subscription",
      planCode: "planCode" in settled ? settled.planCode : null,
      addonCode: "addonCode" in settled ? settled.addonCode : null,
      planExpiresAt: "planExpiresAt" in settled ? settled.planExpiresAt || null : null,
    });
  } catch (error) {
    console.error("[Alipay Webhook] process failed", {
      outTradeNo: outTradeNo || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse("failure", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new NextResponse("success", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
