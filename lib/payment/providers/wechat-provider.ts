import crypto from "node:crypto";

type WechatV3Config = {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKey: string;
  serialNo: string;
  notifyUrl: string;
  platformPublicKey?: string;
  platformSerialNo?: string;
};

type CreateNativeOrderParams = {
  outTradeNo: string;
  amountInFen: number;
  description: string;
  attach?: string;
};

export type WechatPaymentStatus = {
  tradeState: string;
  transactionId: string | null;
  amountInFen: number | null;
  successTime: string | null;
};

function formatPrivateKey(input: string) {
  const normalized = input.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN PRIVATE KEY") || normalized.includes("BEGIN RSA PRIVATE KEY")) {
    return normalized;
  }

  const cleaned = normalized.replace(/\s+/g, "");
  const lines = cleaned.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

function formatPublicVerifierKey(input: string) {
  const normalized = input.replace(/\\n/g, "\n").trim();
  if (
    normalized.includes("BEGIN PUBLIC KEY") ||
    normalized.includes("BEGIN CERTIFICATE")
  ) {
    return normalized;
  }

  const cleaned = normalized.replace(/\s+/g, "");
  const lines = cleaned.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function assertWechatConfig(config: WechatV3Config) {
  const requiredKeys: Array<keyof WechatV3Config> = [
    "appId",
    "mchId",
    "apiV3Key",
    "privateKey",
    "serialNo",
    "notifyUrl",
  ];

  for (const key of requiredKeys) {
    if (!config[key]?.trim()) {
      throw new Error(`缺少微信支付配置: ${key}`);
    }
  }

  if (config.apiV3Key.trim().length !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY 长度必须为 32");
  }
}

export class WechatPayProvider {
  private config: WechatV3Config;
  private apiBaseUrl = "https://api.mch.weixin.qq.com";

  constructor(config: WechatV3Config) {
    assertWechatConfig(config);
    this.config = {
      ...config,
      privateKey: formatPrivateKey(config.privateKey),
      platformPublicKey: config.platformPublicKey
        ? formatPublicVerifierKey(config.platformPublicKey)
        : undefined,
      platformSerialNo: config.platformSerialNo?.trim() || undefined,
    };
  }

  async createNativePayment(params: CreateNativeOrderParams) {
    const payload: Record<string, unknown> = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: this.config.notifyUrl,
      amount: {
        total: params.amountInFen,
        currency: "CNY",
      },
    };

    if (params.attach) {
      payload.attach = params.attach;
    }

    const response = await this.requestWithSignature(
      "POST",
      "/v3/pay/transactions/native",
      payload,
    );

    if (!response.code_url || typeof response.code_url !== "string") {
      throw new Error("微信支付下单失败：未返回 code_url");
    }

    return {
      codeUrl: response.code_url,
    };
  }

  async queryOrderByOutTradeNo(outTradeNo: string): Promise<WechatPaymentStatus> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}`;
    const response = await this.requestWithSignature("GET", path, undefined, {
      mchid: this.config.mchId,
    });

    return {
      tradeState:
        typeof response.trade_state === "string" && response.trade_state.trim()
          ? response.trade_state.trim()
          : "UNKNOWN",
      transactionId:
        typeof response.transaction_id === "string" && response.transaction_id.trim()
          ? response.transaction_id.trim()
          : null,
      amountInFen:
        response?.amount && typeof response.amount === "object"
          ? Number((response.amount as { total?: unknown }).total ?? NaN)
          : null,
      successTime:
        typeof response.success_time === "string" && response.success_time.trim()
          ? response.success_time.trim()
          : null,
    };
  }

  canVerifyWebhookSignature() {
    return Boolean(this.config.platformPublicKey);
  }

  verifyWebhookSignature(input: {
    body: string;
    signature: string;
    timestamp: string;
    nonce: string;
    serial?: string | null;
  }) {
    const signature = input.signature.trim();
    const timestamp = input.timestamp.trim();
    const nonce = input.nonce.trim();
    const serial = input.serial?.trim() || "";
    const verifierKey = this.config.platformPublicKey?.trim() || "";
    const expectedSerial = this.config.platformSerialNo?.trim() || "";

    if (!verifierKey || !signature || !timestamp || !nonce) {
      return false;
    }

    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) {
      return false;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNumber) > 300) {
      return false;
    }

    if (expectedSerial && serial && expectedSerial !== serial) {
      return false;
    }

    const message = `${timestamp}\n${nonce}\n${input.body}\n`;

    try {
      return crypto
        .createVerify("RSA-SHA256")
        .update(message, "utf8")
        .verify(verifierKey, signature, "base64");
    } catch {
      return false;
    }
  }

  private buildAuthorizationHeader(
    method: string,
    pathWithQuery: string,
    timestamp: string,
    nonce: string,
    body: string,
  ) {
    const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(message)
      .sign(this.config.privateKey, "base64");

    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.config.serialNo}"`;
  }

  private async requestWithSignature(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ) {
    const queryString = query
      ? Object.entries(query)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join("&")
      : "";

    const pathWithQuery = queryString ? `${path}?${queryString}` : path;
    const url = `${this.apiBaseUrl}${pathWithQuery}`;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const bodyText = body ? JSON.stringify(body) : "";

    const authorization = this.buildAuthorizationHeader(
      method,
      pathWithQuery,
      timestamp,
      nonce,
      bodyText,
    );

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": nonce,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: method === "POST" ? bodyText : undefined,
      cache: "no-store",
    });

    const responseText = await response.text();
    let payload: Record<string, unknown> = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const message =
        (typeof payload.message === "string" && payload.message.trim()) ||
        response.statusText ||
        "微信支付请求失败";
      throw new Error(`微信支付 API 错误: ${message}`);
    }

    return payload;
  }
}

export function createWechatProviderFromEnv() {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return new WechatPayProvider({
    appId: process.env.WECHAT_PAY_APP_ID || "",
    mchId: process.env.WECHAT_PAY_MCH_ID || "",
    apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || "",
    privateKey: process.env.WECHAT_PAY_PRIVATE_KEY || "",
    serialNo: process.env.WECHAT_PAY_SERIAL_NO || "",
    notifyUrl: `${appUrl}/api/domestic/payment/webhook/wechat`,
    platformPublicKey:
      process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ||
      process.env.WECHAT_PAY_PUBLIC_KEY ||
      process.env.WECHAT_PAY_PLATFORM_CERT ||
      process.env.WECHAT_PAY_PLATFORM_CERTIFICATE ||
      "",
    platformSerialNo:
      process.env.WECHAT_PAY_PLATFORM_SERIAL_NO ||
      process.env.WECHAT_PAY_PUBLIC_KEY_SERIAL_NO ||
      "",
  });
}
