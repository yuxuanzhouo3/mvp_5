type AlipayConfig = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  returnUrl: string;
  gatewayUrl: string;
  productMode: "page" | "wap";
};

type AlipayCreatePaymentInput = {
  outTradeNo: string;
  amount: number;
  description: string;
  passbackParams?: string;
};

export type AlipayQueryStatus = {
  tradeStatus: string;
  tradeNo: string | null;
  totalAmount: string | null;
  buyerPayAmount: string | null;
  rawResponse: Record<string, unknown>;
};

type AlipaySdkInstance = {
  pageExec: (
    method: string,
    options: {
      return_url: string;
      notify_url: string;
      bizContent: Record<string, unknown>;
    },
  ) => Promise<string>;
  exec: (method: string, options: { bizContent: Record<string, unknown> }) => Promise<any>;
  checkNotifySignV2: (params: Record<string, string>) => boolean;
};

function formatPrivateKey(input: string) {
  const normalized = input.replace(/\\n/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }
  if (normalized.includes("BEGIN RSA PRIVATE KEY")) {
    return normalized;
  }
  if (normalized.includes("BEGIN PRIVATE KEY")) {
    const keyContent = normalized
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s+/g, "");
    return `-----BEGIN RSA PRIVATE KEY-----\n${keyContent}\n-----END RSA PRIVATE KEY-----`;
  }

  const keyContent = normalized.replace(/\s+/g, "");
  return `-----BEGIN RSA PRIVATE KEY-----\n${keyContent}\n-----END RSA PRIVATE KEY-----`;
}

function formatPublicKey(input: string) {
  const normalized = input.replace(/\\n/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }
  if (normalized.includes("BEGIN")) {
    return normalized;
  }

  const keyContent = normalized.replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${keyContent}\n-----END PUBLIC KEY-----`;
}

function assertAlipayConfig(config: AlipayConfig) {
  if (!config.appId.trim()) {
    throw new Error("缺少支付宝配置: ALIPAY_APP_ID");
  }
  if (!config.privateKey.trim()) {
    throw new Error("缺少支付宝配置: ALIPAY_PRIVATE_KEY");
  }
  if (!config.alipayPublicKey.trim()) {
    throw new Error("缺少支付宝配置: ALIPAY_ALIPAY_PUBLIC_KEY");
  }
  if (!config.gatewayUrl.trim()) {
    throw new Error("缺少支付宝配置: ALIPAY_GATEWAY_URL");
  }
}

function toTextOrNull(input: unknown) {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  return value || null;
}

function toReadableError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "unknown";
}

export class AlipayProvider {
  private config: AlipayConfig;
  private alipaySdk: AlipaySdkInstance;

  constructor(config: AlipayConfig) {
    assertAlipayConfig(config);
    this.config = config;

    const { AlipaySdk } = require("alipay-sdk");
    this.alipaySdk = new AlipaySdk({
      appId: config.appId,
      privateKey: formatPrivateKey(config.privateKey),
      signType: "RSA2",
      alipayPublicKey: formatPublicKey(config.alipayPublicKey),
      gateway: config.gatewayUrl,
      timeout: 30000,
      camelcase: false,
    });
  }

  async createPayment(input: AlipayCreatePaymentInput) {
    const isWap = this.config.productMode === "wap";
    const method = isWap ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
    const productCode = isWap ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY";

    const bizContent = {
      out_trade_no: input.outTradeNo,
      total_amount: input.amount.toFixed(2),
      subject: input.description,
      product_code: productCode,
      passback_params: input.passbackParams || "",
      // 对齐 mvp28-fix：在 bizContent 内也显式携带回调地址
      notify_url: this.config.notifyUrl,
      return_url: this.config.returnUrl,
    };

    const formHtml = await this.alipaySdk.pageExec(method, {
      return_url: this.config.returnUrl,
      notify_url: this.config.notifyUrl,
      bizContent,
    });

    if (typeof formHtml !== "string" || !formHtml.trim()) {
      throw new Error("支付宝支付表单生成失败");
    }

    return {
      formHtml,
      signedParams: null as Record<string, string> | null,
    };
  }

  async queryPayment(outTradeNo: string): Promise<AlipayQueryStatus> {
    const result = await this.alipaySdk.exec("alipay.trade.query", {
      bizContent: {
        out_trade_no: outTradeNo,
      },
    });

    const code = toTextOrNull(result?.code) || "";
    const msg = toTextOrNull(result?.msg);
    const subMsg = toTextOrNull(result?.sub_msg);
    if (code !== "10000") {
      throw new Error(subMsg || msg || "支付宝查询失败");
    }

    const tradeStatus = toTextOrNull(result?.tradeStatus || result?.trade_status) || "UNKNOWN";
    const tradeNo = toTextOrNull(result?.tradeNo || result?.trade_no);
    const totalAmount = toTextOrNull(result?.totalAmount || result?.total_amount);
    const buyerPayAmount = toTextOrNull(
      result?.buyerPayAmount || result?.buyer_pay_amount || result?.totalAmount || result?.total_amount,
    );

    return {
      tradeStatus,
      tradeNo,
      totalAmount,
      buyerPayAmount,
      rawResponse:
        result && typeof result === "object" ? (result as Record<string, unknown>) : {},
    };
  }

  verifyCallback(params: Record<string, string>) {
    const nodeEnv = (process.env.NODE_ENV || "").toLowerCase().trim();
    const alipaySandbox = (process.env.ALIPAY_SANDBOX || "").toLowerCase().trim();
    if (nodeEnv === "development" || alipaySandbox === "true") {
      return true;
    }

    // 同步 return_url 场景可能没有签名；异步 notify_url 通常有签名
    if (!params.sign || !params.sign_type) {
      return true;
    }

    try {
      return this.alipaySdk.checkNotifySignV2(params);
    } catch (error) {
      console.error("[AlipayProvider] 验签失败:", toReadableError(error));
      return false;
    }
  }
}

export function createAlipayProviderFromEnv() {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return new AlipayProvider({
    appId: process.env.ALIPAY_APP_ID || "",
    privateKey: process.env.ALIPAY_PRIVATE_KEY || "",
    alipayPublicKey: process.env.ALIPAY_ALIPAY_PUBLIC_KEY || "",
    notifyUrl: `${appUrl}/api/domestic/payment/webhook/alipay`,
    returnUrl: `${appUrl}/payment/success?provider=alipay`,
    gatewayUrl:
      process.env.ALIPAY_GATEWAY_URL ||
      "https://openapi.alipay.com/gateway.do",
    productMode:
      (process.env.ALIPAY_PRODUCT_MODE || "page").toLowerCase() === "wap"
        ? "wap"
        : "page",
  });
}
