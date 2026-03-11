type PayPalEnvironment = "live" | "sandbox";

type PayPalCreateOrderInput = {
  amount: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  customId: string;
  description: string;
};

export type PayPalCreateOrderResult = {
  orderId: string;
  approvalUrl: string | null;
};

export type PayPalCaptureResult = {
  status: string;
  orderId: string;
  captureId: string | null;
  amount: number;
  currency: string;
  raw: Record<string, unknown>;
};

function getPayPalEnvironment(): PayPalEnvironment {
  const value = (process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase();
  return value === "live" || value === "production" ? "live" : "sandbox";
}

function getPayPalBaseUrl() {
  return getPayPalEnvironment() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getPayPalCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() || "";

  if (!clientId || !clientSecret) {
    throw new Error("缺少 PayPal 配置: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  }

  return { clientId, clientSecret };
}

function parsePayPalCapturePayload(
  orderId: string,
  json: Record<string, unknown>,
): PayPalCaptureResult {
  const purchaseUnits = Array.isArray(json.purchase_units) ? json.purchase_units : [];
  const firstUnit = purchaseUnits[0] as Record<string, unknown> | undefined;
  const payments = firstUnit?.payments as Record<string, unknown> | undefined;
  const captures = Array.isArray(payments?.captures)
    ? (payments?.captures as Array<Record<string, unknown>>)
    : [];
  const firstCapture = captures[0];

  const amountNode =
    (firstCapture?.amount as Record<string, unknown> | undefined) ||
    (firstUnit?.amount as Record<string, unknown> | undefined) ||
    {};

  const amount = Number(amountNode.value || 0);
  const currency =
    (typeof amountNode.currency_code === "string" && amountNode.currency_code.trim())
      ? amountNode.currency_code.trim().toUpperCase()
      : "USD";

  const status =
    (typeof firstCapture?.status === "string" && firstCapture.status.trim()) ||
    (typeof json.status === "string" && json.status.trim()) ||
    "UNKNOWN";

  return {
    status,
    orderId,
    captureId:
      typeof firstCapture?.id === "string" && firstCapture.id.trim()
        ? firstCapture.id.trim()
        : null,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    raw: json,
  };
}

async function getPayPalAccessToken() {
  const { clientId, clientSecret } = getPayPalCredentials();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      (typeof json.error_description === "string" && json.error_description.trim()) ||
      response.statusText ||
      "获取 PayPal Access Token 失败";
    throw new Error(message);
  }

  const token = typeof json.access_token === "string" ? json.access_token.trim() : "";
  if (!token) {
    throw new Error("PayPal Access Token 为空");
  }

  return token;
}

export async function createPayPalOrder(input: PayPalCreateOrderInput): Promise<PayPalCreateOrderResult> {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: input.currency,
            value: input.amount.toFixed(2),
          },
          custom_id: input.customId,
          description: input.description.slice(0, 127),
        },
      ],
      application_context: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const details = Array.isArray(json.details) ? json.details : [];
    const firstDetail = details[0] as Record<string, unknown> | undefined;
    const message =
      (typeof firstDetail?.description === "string" && firstDetail.description.trim()) ||
      (typeof json.message === "string" && json.message.trim()) ||
      response.statusText ||
      "创建 PayPal 订单失败";
    throw new Error(message);
  }

  const orderId = typeof json.id === "string" ? json.id.trim() : "";
  const links = Array.isArray(json.links) ? json.links : [];
  const approve = links.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return (item as Record<string, unknown>).rel === "approve";
  }) as Record<string, unknown> | undefined;

  return {
    orderId,
    approvalUrl:
      approve && typeof approve.href === "string" && approve.href.trim()
        ? approve.href.trim()
        : null,
  };
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResult> {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const details = Array.isArray(json.details) ? json.details : [];
    const firstDetail = details[0] as Record<string, unknown> | undefined;
    const issue =
      typeof firstDetail?.issue === "string" ? firstDetail.issue.trim() : "";

    if (issue === "ORDER_ALREADY_CAPTURED") {
      const fallbackResponse = await fetch(
        `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        },
      );

      const fallbackText = await fallbackResponse.text();
      const fallbackJson = fallbackText
        ? (JSON.parse(fallbackText) as Record<string, unknown>)
        : {};

      if (fallbackResponse.ok) {
        return parsePayPalCapturePayload(orderId, fallbackJson);
      }
    }

    const message =
      (typeof firstDetail?.description === "string" && firstDetail.description.trim()) ||
      (typeof firstDetail?.issue === "string" && firstDetail.issue.trim()) ||
      (typeof json.message === "string" && json.message.trim()) ||
      response.statusText ||
      "PayPal 捕获订单失败";
    throw new Error(message);
  }

  return parsePayPalCapturePayload(orderId, json);
}

export async function cancelPayPalOrder(orderId: string) {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );

  if (response.ok) {
    return {
      orderId,
      canceled: true,
    };
  }

  const text = await response.text();
  let message = response.statusText || "PayPal 取消订单失败";
  try {
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const details = Array.isArray(json.details) ? json.details : [];
    const firstDetail = details[0] as Record<string, unknown> | undefined;
    message =
      (typeof firstDetail?.description === "string" && firstDetail.description.trim()) ||
      (typeof firstDetail?.issue === "string" && firstDetail.issue.trim()) ||
      (typeof json.message === "string" && json.message.trim()) ||
      message;
  } catch {
    if (text.trim()) {
      message = text.trim();
    }
  }

  throw new Error(message);
}
