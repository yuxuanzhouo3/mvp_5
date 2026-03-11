export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readDomesticOrderByProviderOrderId,
  requireDomesticRuntimeDb,
  settleDomesticSubscriptionPayment,
} from "@/lib/payment/domestic-payment";
import { createWechatProviderFromEnv } from "@/lib/payment/providers/wechat-provider";

type WechatWebhookResource = {
  ciphertext?: string;
  nonce?: string;
  associated_data?: string;
};

type WechatWebhookPayload = {
  id?: string;
  event_type?: string;
  resource?: WechatWebhookResource;
};

function decryptWechatResource(resource: WechatWebhookResource) {
  const apiV3Key = process.env.WECHAT_PAY_API_V3_KEY?.trim() || "";
  if (!apiV3Key || apiV3Key.length !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY 未配置或长度不正确");
  }

  const ciphertext = (resource.ciphertext || "").trim();
  const nonce = (resource.nonce || "").trim();
  const associatedData = (resource.associated_data || "").trim();

  if (!ciphertext || !nonce) {
    throw new Error("微信回调缺少加密字段");
  }

  const cipherBuffer = Buffer.from(ciphertext, "base64");
  if (cipherBuffer.length <= 16) {
    throw new Error("微信回调密文长度不正确");
  }

  const encrypted = cipherBuffer.subarray(0, cipherBuffer.length - 16);
  const authTag = cipherBuffer.subarray(cipherBuffer.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(apiV3Key, "utf8"),
    Buffer.from(nonce, "utf8"),
  );

  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
  }
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(encrypted, undefined, "utf8");
  plaintext += decipher.final("utf8");
  return JSON.parse(plaintext) as Record<string, unknown>;
}

function wechatSuccess() {
  return NextResponse.json(
    {
      code: "SUCCESS",
      message: "OK",
    },
    { status: 200 },
  );
}

function wechatFail(message: string, status = 400) {
  return NextResponse.json(
    {
      code: "FAIL",
      message,
    },
    { status },
  );
}

function isAmountMatched(expectedAmount: number, paidFen: number | null) {
  if (paidFen === null) {
    return true;
  }
  const paidAmount = Number((paidFen / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

export async function POST(request: NextRequest) {
  let outTradeNo = "";
  try {
    const bodyText = await request.text();
    const payload = (bodyText
      ? (JSON.parse(bodyText) as WechatWebhookPayload)
      : {}) as WechatWebhookPayload;
    const eventType = (payload.event_type || "").trim();

    console.info("[Wechat Webhook] payload received", {
      hasBody: Boolean(bodyText),
      length: bodyText.length,
      eventType: eventType || null,
      eventId: payload.id || null,
    });

    if (eventType !== "TRANSACTION.SUCCESS") {
      return wechatSuccess();
    }

    const paymentData = decryptWechatResource(payload.resource || {});
    outTradeNo = String(paymentData.out_trade_no || "").trim();

    if (!outTradeNo) {
      console.warn("[Wechat Webhook] missing out_trade_no in decrypted payload");
      return wechatSuccess();
    }

    const db = await requireDomesticRuntimeDb();
    const order = await readDomesticOrderByProviderOrderId({
      db,
      provider: "wechat_pay",
      providerOrderId: outTradeNo,
    });

    if (!order) {
      console.warn("[Wechat Webhook] order not found, ignore", { outTradeNo });
      return wechatSuccess();
    }

    // 二次向微信查询，避免仅依赖回调内容直接结算
    const wechatProvider = createWechatProviderFromEnv();
    const status = await wechatProvider.queryOrderByOutTradeNo(outTradeNo);
    if (status.tradeState !== "SUCCESS") {
      console.warn("[Wechat Webhook] payment not completed in provider query", {
        outTradeNo,
        tradeState: status.tradeState,
      });
      return wechatSuccess();
    }

    const expectedAmount = Number(order.amount || 0);
    if (!isAmountMatched(expectedAmount, status.amountInFen)) {
      console.error("[Wechat Webhook] amount mismatch", {
        outTradeNo,
        expectedAmount,
        paidFen: status.amountInFen,
      });
      return wechatFail("Amount mismatch", 400);
    }

    const settled = await settleDomesticSubscriptionPayment({
      db,
      order,
      provider: "wechat_pay",
      providerOrderId: outTradeNo,
      providerTransactionId: status.transactionId,
      providerPayload: {
        webhook_event_type: eventType,
        webhook_payload_id: payload.id || null,
        webhook_trade_state: String(paymentData.trade_state || ""),
        webhook_transaction_id: String(paymentData.transaction_id || ""),
        query_trade_state: status.tradeState,
        query_transaction_id: status.transactionId,
        query_amount_in_fen: status.amountInFen,
        query_success_time: status.successTime,
      },
    });

    console.info("[Wechat Webhook] settled", {
      outTradeNo,
      alreadyPaid: settled.alreadyPaid,
      planCode: settled.planCode,
      planExpiresAt: settled.planExpiresAt || null,
    });
    return wechatSuccess();
  } catch (error) {
    console.error("[Wechat Webhook] process failed", {
      outTradeNo: outTradeNo || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return wechatFail("Internal server error", 500);
  }
}
