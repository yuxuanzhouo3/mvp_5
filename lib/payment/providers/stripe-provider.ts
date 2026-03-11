type StripeCreateSessionInput = {
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  description: string;
  metadata?: Record<string, string>;
  clientReferenceId?: string;
};

export type StripeSessionDetail = {
  id: string;
  url: string | null;
  paymentStatus: string;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  metadata: Record<string, string>;
};

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() || "";
  if (!key) {
    throw new Error("缺少 Stripe 配置: STRIPE_SECRET_KEY");
  }
  if (!/^sk_(test|live)_/i.test(key)) {
    throw new Error("STRIPE_SECRET_KEY 格式不正确");
  }
  return key;
}

function encodeForm(payload: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    form.append(key, value);
  }
  return form.toString();
}

function normalizeMetadata(input: unknown) {
  const output: Record<string, string> = {};
  if (!input || typeof input !== "object") {
    return output;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    output[key] = normalized;
  }

  return output;
}

export async function createStripeCheckoutSession(input: StripeCreateSessionInput) {
  const secretKey = getStripeSecretKey();
  const unitAmount = Math.max(1, Math.round(input.amount * 100));

  const payload: Record<string, string> = {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(unitAmount),
    "line_items[0][price_data][product_data][name]": input.description,
    "payment_method_types[0]": "card",
  };

  if (input.clientReferenceId?.trim()) {
    payload.client_reference_id = input.clientReferenceId.trim();
  }

  const metadata = input.metadata || {};
  Object.entries(metadata).forEach(([key, value]) => {
    payload[`metadata[${key}]`] = value;
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(payload),
    cache: "no-store",
  });

  const payloadText = await response.text();
  const json = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error =
      json?.error && typeof json.error === "object"
        ? (json.error as Record<string, unknown>)
        : {};
    const message =
      (typeof error.message === "string" && error.message.trim()) ||
      response.statusText ||
      "Stripe 下单失败";
    throw new Error(message);
  }

  return {
    id: typeof json.id === "string" ? json.id : "",
    url: typeof json.url === "string" ? json.url : null,
  };
}

export async function retrieveStripeCheckoutSession(sessionId: string): Promise<StripeSessionDetail> {
  const secretKey = getStripeSecretKey();
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
      sessionId,
    )}?expand[]=payment_intent`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      cache: "no-store",
    },
  );

  const payloadText = await response.text();
  const json = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error =
      json?.error && typeof json.error === "object"
        ? (json.error as Record<string, unknown>)
        : {};
    const message =
      (typeof error.message === "string" && error.message.trim()) ||
      response.statusText ||
      "Stripe 查询失败";
    throw new Error(message);
  }

  const paymentIntent = json.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : paymentIntent && typeof paymentIntent === "object"
        ? ((paymentIntent as Record<string, unknown>).id as string | undefined) || null
        : null;

  return {
    id: typeof json.id === "string" ? json.id : "",
    url: typeof json.url === "string" ? json.url : null,
    paymentStatus:
      typeof json.payment_status === "string" ? json.payment_status : "unpaid",
    amountTotal:
      typeof json.amount_total === "number"
        ? json.amount_total
        : typeof json.amount_total === "string"
          ? Number(json.amount_total)
          : null,
    currency:
      typeof json.currency === "string" && json.currency.trim()
        ? json.currency.toUpperCase()
        : null,
    paymentIntentId: paymentIntentId && paymentIntentId.trim() ? paymentIntentId.trim() : null,
    metadata: normalizeMetadata(json.metadata),
  };
}

export async function expireStripeCheckoutSession(sessionId: string) {
  const secretKey = getStripeSecretKey();
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    },
  );

  const payloadText = await response.text();
  const json = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error =
      json?.error && typeof json.error === "object"
        ? (json.error as Record<string, unknown>)
        : {};
    const message =
      (typeof error.message === "string" && error.message.trim()) ||
      response.statusText ||
      "Stripe 会话作废失败";
    throw new Error(message);
  }

  return {
    id: typeof json.id === "string" ? json.id : sessionId,
    status: typeof json.status === "string" ? json.status : null,
  };
}
