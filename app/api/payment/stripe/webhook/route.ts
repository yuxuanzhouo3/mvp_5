export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  GLOBAL_SOURCE,
  isGlobalRuntime,
  markGlobalOrderFailed,
  readGlobalOrderByProviderOrderId,
  requireGlobalRuntimeDb,
  settleGlobalAddonPayment,
  settleGlobalSubscriptionPayment,
  toHttpError,
} from "@/lib/payment/global-payment";
import type { RoutedAdminDbClient } from "@/lib/server/database-routing";

const STRIPE_PROVIDER = "stripe" as const;
const STRIPE_TOLERANCE_SECONDS = 300;
const STRIPE_SUCCESS_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

type StripeWebhookSession = {
  id?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_intent?: unknown;
  metadata?: unknown;
};

type StripeWebhookEvent = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: {
    object?: StripeWebhookSession;
  };
};

type StripeSignaturePayload = {
  timestamp: number | null;
  signatures: string[];
};

type PaymentWebhookEventRow = {
  id?: string | null;
  event_id?: string | null;
  event_type?: string | null;
  processing_status?: string | null;
  related_order_id?: string | null;
  signature_valid?: boolean | null;
};

type WebhookProcessingStatus = "pending" | "processed" | "ignored" | "failed";

function stripeResponse(message = "ok", status = 200) {
  return new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function toReadableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}

function toQueryErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }

  const error = (result as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  return "unknown";
}

function toQueryRows<T>(result: unknown): T[] {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return [];
  }

  const data = (result as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === "object") {
    return [data as T];
  }
  return [];
}

async function queryRows<T>(queryPromise: Promise<unknown>, context: string) {
  const result = await queryPromise;
  const queryError = toQueryErrorMessage(result);
  if (queryError) {
    throw new Error(`${context}: ${queryError}`);
  }
  return toQueryRows<T>(result);
}

async function executeQuery(queryPromise: Promise<unknown>, context: string) {
  const result = await queryPromise;
  const queryError = toQueryErrorMessage(result);
  if (queryError) {
    throw new Error(`${context}: ${queryError}`);
  }
  return result;
}

function createTextId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function normalizeText(input: unknown, fallback = "") {
  if (typeof input !== "string") {
    return fallback;
  }
  const normalized = input.trim();
  return normalized || fallback;
}

function normalizeObject(input: unknown) {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
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

function parseStripeSignature(header: string): StripeSignaturePayload {
  const output: StripeSignaturePayload = {
    timestamp: null,
    signatures: [],
  };

  header
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!value) {
        return;
      }

      if (key === "t") {
        const timestamp = Number.parseInt(value, 10);
        if (Number.isFinite(timestamp) && timestamp > 0) {
          output.timestamp = timestamp;
        }
        return;
      }

      if (key === "v1" && /^[0-9a-f]+$/i.test(value)) {
        output.signatures.push(value.toLowerCase());
      }
    });

  return output;
}

function safeEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyStripeWebhookSignature(input: {
  bodyText: string;
  signatureHeader: string;
  secret: string;
}) {
  const signature = parseStripeSignature(input.signatureHeader);
  if (!signature.timestamp || signature.signatures.length === 0) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - signature.timestamp) > STRIPE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedPayload = `${signature.timestamp}.${input.bodyText}`;
  const expectedSignature = createHmac("sha256", input.secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return signature.signatures.some((candidate) => safeEqualHex(expectedSignature, candidate));
}

function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (!secret) {
    throw new Error("Missing Stripe configuration: STRIPE_WEBHOOK_SECRET");
  }
  return secret;
}

function parseStripeWebhookEvent(bodyText: string) {
  if (!bodyText.trim()) {
    throw new Error("Empty Stripe webhook payload");
  }
  return JSON.parse(bodyText) as StripeWebhookEvent;
}

function readStripeSessionFromEvent(event: StripeWebhookEvent) {
  const data = normalizeObject(event.data);
  return normalizeObject(data.object) as StripeWebhookSession;
}

function toEventTimeIso(input: unknown) {
  const timestamp =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number.parseInt(input, 10)
        : NaN;

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

function toAmountInCents(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.round(input));
  }
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function isAmountMatched(expectedAmount: number, paidAmountInCents: number | null) {
  if (paidAmountInCents === null) {
    return true;
  }

  const paidAmount = Number((paidAmountInCents / 100).toFixed(2));
  return Math.abs(expectedAmount - paidAmount) <= 0.01;
}

function resolvePaymentIntentId(input: unknown) {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  const object = normalizeObject(input);
  const id = object.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function isAddonOrder(orderType: unknown) {
  return typeof orderType === "string" && orderType.trim().toLowerCase() === "addon";
}

async function readWebhookEvent(input: { db: RoutedAdminDbClient; eventId: string }) {
  const rows = await queryRows<PaymentWebhookEventRow>(
    input.db
      .from("payment_webhook_events")
      .select("id,event_id,event_type,processing_status,related_order_id,signature_valid")
      .eq("source", GLOBAL_SOURCE)
      .eq("provider", STRIPE_PROVIDER)
      .eq("event_id", input.eventId)
      .limit(1),
    "Read Stripe webhook event failed",
  );

  return rows[0] || null;
}

async function updateWebhookEvent(input: {
  db: RoutedAdminDbClient;
  id: string;
  status: WebhookProcessingStatus;
  eventType?: string;
  eventTime?: string | null;
  signatureValid?: boolean;
  payload?: unknown;
  errorMessage?: string | null;
  relatedOrderId?: string | null;
}) {
  const patch: Record<string, unknown> = {
    processing_status: input.status,
    updated_at: new Date().toISOString(),
  };

  if (typeof input.eventType === "string") {
    patch.event_type = input.eventType;
  }
  if (input.eventTime !== undefined) {
    patch.event_time = input.eventTime;
  }
  if (typeof input.signatureValid === "boolean") {
    patch.signature_valid = input.signatureValid;
  }
  if (input.payload !== undefined) {
    patch.payload_json = input.payload;
  }
  if (input.errorMessage !== undefined) {
    patch.error_message = input.errorMessage;
  }
  if (input.relatedOrderId !== undefined) {
    patch.related_order_id = input.relatedOrderId;
  }

  await executeQuery(
    input.db.from("payment_webhook_events").update(patch).eq("id", input.id),
    "Update Stripe webhook event failed",
  );
}

async function ensurePendingWebhookEvent(input: {
  db: RoutedAdminDbClient;
  eventId: string;
  eventType: string;
  eventTime: string | null;
  payload: unknown;
}) {
  const existing = await readWebhookEvent({
    db: input.db,
    eventId: input.eventId,
  });

  if (existing?.id) {
    const status = normalizeText(existing.processing_status, "pending").toLowerCase();
    if (status === "processed" || status === "ignored") {
      return existing;
    }

    await updateWebhookEvent({
      db: input.db,
      id: existing.id,
      status: "pending",
      eventType: input.eventType,
      eventTime: input.eventTime,
      signatureValid: true,
      payload: input.payload,
      errorMessage: null,
      relatedOrderId: existing.related_order_id || null,
    });

    return {
      ...existing,
      processing_status: "pending",
    };
  }

  const id = createTextId("webhook_evt");
  const nowIso = new Date().toISOString();

  try {
    await executeQuery(
      input.db.from("payment_webhook_events").insert({
        id,
        source: GLOBAL_SOURCE,
        provider: STRIPE_PROVIDER,
        event_id: input.eventId,
        event_type: input.eventType,
        event_time: input.eventTime,
        signature_valid: true,
        processing_status: "pending",
        payload_json: input.payload,
        error_message: null,
        related_order_id: null,
        created_at: nowIso,
        updated_at: nowIso,
      }),
      "Create Stripe webhook event failed",
    );

    return {
      id,
      event_id: input.eventId,
      event_type: input.eventType,
      processing_status: "pending",
      related_order_id: null,
      signature_valid: true,
    } satisfies PaymentWebhookEventRow;
  } catch (error) {
    const duplicated = await readWebhookEvent({
      db: input.db,
      eventId: input.eventId,
    });
    if (duplicated?.id) {
      return duplicated;
    }
    throw error;
  }
}

async function processPaidSession(input: {
  db: RoutedAdminDbClient;
  recordId: string;
  eventId: string;
  eventType: string;
  event: StripeWebhookEvent;
}) {
  const session = readStripeSessionFromEvent(input.event);
  const sessionId = normalizeText(session.id, "");
  if (!sessionId) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "failed",
      errorMessage: "Stripe checkout session is missing id",
    });
    return stripeResponse();
  }

  const paymentStatus = normalizeText(session.payment_status, "").toLowerCase();
  if (paymentStatus !== "paid") {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "ignored",
      errorMessage: `Stripe checkout session is not paid: ${paymentStatus || "unknown"}`,
    });
    return stripeResponse();
  }

  const order = await readGlobalOrderByProviderOrderId({
    db: input.db,
    provider: STRIPE_PROVIDER,
    providerOrderId: sessionId,
  });

  if (!order) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "failed",
      errorMessage: `Global order not found for Stripe session ${sessionId}`,
    });
    console.warn("[Global Stripe Webhook] order not found", {
      sessionId,
      eventId: input.eventId,
      eventType: input.eventType,
    });
    return stripeResponse();
  }

  const orderId = normalizeText(order.id, "");
  if (!orderId) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "failed",
      errorMessage: `Global order is missing id for Stripe session ${sessionId}`,
    });
    return stripeResponse();
  }

  const expectedAmount = Number(order.amount || 0);
  const paidAmountInCents = toAmountInCents(session.amount_total);
  if (!isAmountMatched(expectedAmount, paidAmountInCents)) {
    const message = `Stripe amount mismatch: expected ${expectedAmount}, got ${
      paidAmountInCents === null ? "unknown" : Number((paidAmountInCents / 100).toFixed(2))
    }`;

    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "failed",
      relatedOrderId: orderId || null,
      errorMessage: message,
    });

    console.error("[Global Stripe Webhook] amount mismatch", {
      sessionId,
      orderId: orderId || null,
      expectedAmount,
      paidAmountInCents,
    });
    return stripeResponse();
  }

  const paymentIntentId = resolvePaymentIntentId(session.payment_intent);
  const metadata = normalizeMetadata(session.metadata);
  const providerPayload = {
    webhook_event_id: input.eventId,
    webhook_event_type: input.eventType,
    payment_status: paymentStatus,
    amount_total: paidAmountInCents,
    currency: normalizeText(session.currency, "").toUpperCase() || null,
    payment_intent: paymentIntentId,
    metadata,
  };
  const settled = isAddonOrder(order.order_type)
    ? await settleGlobalAddonPayment({
        db: input.db,
        order,
        provider: STRIPE_PROVIDER,
        providerOrderId: sessionId,
        providerTransactionId: paymentIntentId,
        providerPayload,
      })
    : await settleGlobalSubscriptionPayment({
        db: input.db,
        order,
        provider: STRIPE_PROVIDER,
        providerOrderId: sessionId,
        providerTransactionId: paymentIntentId,
        providerPayload,
      });

  await updateWebhookEvent({
    db: input.db,
    id: input.recordId,
    status: "processed",
    relatedOrderId: orderId || null,
    errorMessage: null,
  });

  console.info("[Global Stripe Webhook] settled", {
    sessionId,
    orderId: orderId || null,
    alreadyPaid: settled.alreadyPaid,
    productType: isAddonOrder(order.order_type) ? "addon" : "subscription",
    planCode: "planCode" in settled ? settled.planCode : null,
    addonCode: "addonCode" in settled ? settled.addonCode : null,
    planExpiresAt: "planExpiresAt" in settled ? settled.planExpiresAt || null : null,
  });

  return stripeResponse();
}

async function processExpiredSession(input: {
  db: RoutedAdminDbClient;
  recordId: string;
  eventId: string;
  eventType: string;
  event: StripeWebhookEvent;
}) {
  const session = readStripeSessionFromEvent(input.event);
  const sessionId = normalizeText(session.id, "");
  if (!sessionId) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "ignored",
      errorMessage: "Stripe expired session is missing id",
    });
    return stripeResponse();
  }

  const order = await readGlobalOrderByProviderOrderId({
    db: input.db,
    provider: STRIPE_PROVIDER,
    providerOrderId: sessionId,
  });

  if (!order) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "ignored",
      errorMessage: `Ignore expired Stripe session without local order: ${sessionId}`,
    });
    return stripeResponse();
  }

  const orderId = normalizeText(order.id, "");
  if (!orderId) {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "failed",
      errorMessage: `Global order is missing id for expired Stripe session ${sessionId}`,
    });
    return stripeResponse();
  }

  const paymentStatus = normalizeText(order.payment_status, "pending").toLowerCase();
  if (paymentStatus === "paid") {
    await updateWebhookEvent({
      db: input.db,
      id: input.recordId,
      status: "ignored",
      relatedOrderId: orderId || null,
      errorMessage: "Ignore expired Stripe session because order is already paid",
    });
    return stripeResponse();
  }

  await markGlobalOrderFailed({
    db: input.db,
    orderId,
    provider: STRIPE_PROVIDER,
    providerOrderId: sessionId,
    reason: "Stripe checkout session expired",
  });

  await updateWebhookEvent({
    db: input.db,
    id: input.recordId,
    status: "processed",
    relatedOrderId: orderId || null,
    errorMessage: null,
  });

  console.info("[Global Stripe Webhook] expired session marked failed", {
    sessionId,
    orderId: orderId || null,
    eventId: input.eventId,
    eventType: input.eventType,
  });

  return stripeResponse();
}

export async function POST(request: NextRequest) {
  let db: RoutedAdminDbClient | null = null;
  let recordId = "";

  try {
    if (!isGlobalRuntime()) {
      return stripeResponse("ignored");
    }

    const signatureHeader = request.headers.get("stripe-signature")?.trim() || "";
    if (!signatureHeader) {
      console.error("[Global Stripe Webhook] missing stripe-signature header");
      return stripeResponse("missing signature", 401);
    }

    const bodyText = await request.text();
    const webhookSecret = getStripeWebhookSecret();
    if (!verifyStripeWebhookSignature({ bodyText, signatureHeader, secret: webhookSecret })) {
      console.error("[Global Stripe Webhook] signature verify failed");
      return stripeResponse("invalid signature", 401);
    }

    const event = parseStripeWebhookEvent(bodyText);
    const eventId = normalizeText(event.id, "");
    const eventType = normalizeText(event.type, "");
    if (!eventId || !eventType) {
      console.error("[Global Stripe Webhook] invalid event payload", {
        hasEventId: Boolean(eventId),
        hasEventType: Boolean(eventType),
      });
      return stripeResponse("invalid payload", 400);
    }

    db = await requireGlobalRuntimeDb();
    const record = await ensurePendingWebhookEvent({
      db,
      eventId,
      eventType,
      eventTime: toEventTimeIso(event.created),
      payload: event,
    });

    recordId = normalizeText(record.id, "");
    if (!recordId) {
      throw new Error(`Stripe webhook event record id missing for event ${eventId}`);
    }

    const processingStatus = normalizeText(record.processing_status, "pending").toLowerCase();
    if (processingStatus === "processed" || processingStatus === "ignored") {
      return stripeResponse();
    }

    if (STRIPE_SUCCESS_EVENT_TYPES.has(eventType)) {
      return processPaidSession({
        db,
        recordId,
        eventId,
        eventType,
        event,
      });
    }

    if (eventType === "checkout.session.expired") {
      return processExpiredSession({
        db,
        recordId,
        eventId,
        eventType,
        event,
      });
    }

    await updateWebhookEvent({
      db,
      id: recordId,
      status: "ignored",
      errorMessage: `Ignore unsupported Stripe event: ${eventType}`,
    });
    return stripeResponse();
  } catch (error) {
    if (db && recordId) {
      try {
        await updateWebhookEvent({
          db,
          id: recordId,
          status: "failed",
          errorMessage: toReadableError(error, "Stripe webhook process failed"),
        });
      } catch (updateError) {
        console.error("[Global Stripe Webhook] failed to update webhook event status", updateError);
      }
    }

    const httpError = toHttpError(error);
    console.error("[Global Stripe Webhook] process failed", error);
    return stripeResponse(httpError.message, httpError.status);
  }
}
