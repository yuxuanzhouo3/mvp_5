import { randomUUID } from "node:crypto";
import {
  getRoutedRuntimeDbClient,
  resolveBackendFromLanguage,
  type RoutedAdminDbClient,
} from "@/lib/server/database-routing";
import { trackAnalyticsSessionEvent } from "@/lib/analytics/tracker";
import {
  verifyCloudbaseAccessToken,
  type CloudbaseVerifiedUser,
} from "@/lib/server/cloudbase-auth";

export const DOMESTIC_SOURCE = "cn" as const;
export const DOMESTIC_CURRENCY = "CNY" as const;
const CLOUDBASE_ACCESS_TOKEN_HEADER = "x-cloudbase-access-token";

export type DomesticPlanCode = "pro" | "enterprise";
export type DomesticBillingPeriod = "monthly" | "yearly";
export type DomesticPaymentProvider =
  | "alipay"
  | "wechat_pay"
  | "stripe"
  | "paypal";

export type DomesticClientMeta = {
  ipAddress: string;
  userAgent: string;
  countryCode: string;
};

export type DomesticPlanPricing = {
  planCode: DomesticPlanCode;
  billingPeriod: DomesticBillingPeriod;
  currency: "CNY";
  amount: number;
  originalAmount: number | null;
  displayNameCn: string;
  displayNameEn: string;
  monthlyDocumentLimit: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  monthlyAudioLimit: number;
  planLevel: number;
};

type DomesticPlanDefinition = {
  planCode: DomesticPlanCode;
  displayNameCn: string;
  displayNameEn: string;
  monthlyDocumentLimit: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  monthlyAudioLimit: number;
  planLevel: number;
};

export type DomesticOrderRow = {
  id?: string | null;
  order_no?: string | null;
  user_id?: string | null;
  source?: string | null;
  order_type?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  plan_code?: string | null;
  billing_period?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  payment_provider?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  provider_order_id?: string | null;
  provider_transaction_id?: string | null;
  extra_json?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

type AppUserRow = {
  id?: string | null;
  source?: string | null;
  email?: string | null;
  email_normalized?: string | null;
  display_name?: string | null;
  current_plan_code?: string | null;
  plan_expires_at?: string | null;
};

type PlanPriceRow = {
  source?: string | null;
  plan_code?: string | null;
  billing_period?: string | null;
  currency?: string | null;
  amount?: number | string | null;
  original_amount?: number | string | null;
  is_active?: boolean | null;
};

type SubscriptionPlanRow = {
  plan_code?: string | null;
  display_name_cn?: string | null;
  display_name_en?: string | null;
  plan_level?: number | string | null;
  monthly_document_limit?: number | string | null;
  monthly_image_limit?: number | string | null;
  monthly_video_limit?: number | string | null;
  monthly_audio_limit?: number | string | null;
  is_active?: boolean | null;
};

type PaymentTxRow = {
  id?: string | null;
  order_id?: string | null;
  provider?: string | null;
  provider_order_id?: string | null;
};

type SubscriptionChangeLogRow = {
  action?: string | null;
  to_plan_code?: string | null;
  to_period_end?: string | null;
};

type UserSubscriptionRow = {
  id?: string | null;
  user_id?: string | null;
  plan_code?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

type UserQuotaAccountRow = {
  id?: string | null;
  status?: string | null;
  cycle_end_date?: string | null;
};

type UserQuotaBalanceRow = {
  id?: string | null;
  quota_type?: string | null;
};

export class DomesticPaymentError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomesticPaymentError";
    this.status = status;
  }
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

function isDuplicateEntryError(error: unknown) {
  const message = toReadableError(error, "").toLowerCase();
  return (
    message.includes("duplicate entry") ||
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("already exists") ||
    message.includes("1062")
  );
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
    throw new DomesticPaymentError(`${context}: ${queryError}`, 503);
  }
  return toQueryRows<T>(result);
}

async function executeQuery(queryPromise: Promise<unknown>, context: string) {
  const result = await queryPromise;
  const queryError = toQueryErrorMessage(result);
  if (queryError) {
    throw new DomesticPaymentError(`${context}: ${queryError}`, 503);
  }
  return result;
}

function toSafeNumber(input: unknown, fallback = 0) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function toSafeInt(input: unknown, fallback = 0) {
  return Math.max(0, Math.trunc(toSafeNumber(input, fallback)));
}

function toSafeAmount(input: unknown, fallback = 0) {
  return Math.max(0, Number(toSafeNumber(input, fallback).toFixed(2)));
}

function stringifyCloudbaseJson(input: unknown) {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "string") {
    return input;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function parseJsonRecord(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }

  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (typeof input === "string") {
    const text = input.trim();
    if (!text) {
      return {};
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeText(input: unknown, fallback: string) {
  if (typeof input !== "string") {
    return fallback;
  }
  const value = input.trim();
  return value || fallback;
}

function createTextId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

async function trackDomesticAnalyticsEvent(input: {
  userId?: string | null;
  eventType: string;
  eventName: string;
  relatedOrderId?: string | null;
  eventValue?: number | null;
  eventData?: Record<string, unknown>;
  ensureSession?: boolean;
}) {
  const userId = normalizeText(input.userId, "");
  if (!userId) {
    return;
  }

  try {
    await trackAnalyticsSessionEvent({
      source: DOMESTIC_SOURCE,
      userId,
      ensureSession: Boolean(input.ensureSession),
      eventType: input.eventType,
      eventName: input.eventName,
      relatedOrderId: input.relatedOrderId || undefined,
      eventValue: input.eventValue ?? undefined,
      eventData: input.eventData,
    });
  } catch (error) {
    console.warn(
      `[DomesticPayment][analytics] track failed (${input.eventType}/${input.eventName}):`,
      error,
    );
  }
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatUtcDateTimeForSql(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toDomesticDateTime(input?: Date | string | null) {
  if (!input) {
    return formatUtcDateTimeForSql(new Date());
  }

  if (input instanceof Date) {
    return formatUtcDateTimeForSql(input);
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return formatUtcDateTimeForSql(new Date());
  }
  return formatUtcDateTimeForSql(parsed);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function compareByDateDesc(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return rightTime - leftTime;
}

export function isDomesticRuntime() {
  return resolveBackendFromLanguage() === "cloudbase";
}

export function resolveDomesticPlanCode(input: unknown): DomesticPlanCode | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === "pro") {
    return "pro";
  }
  if (normalized === "enterprise" || normalized === "ent") {
    return "enterprise";
  }
  return null;
}

export function resolveDomesticBillingPeriod(input: unknown): DomesticBillingPeriod {
  if (typeof input !== "string") {
    return "monthly";
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === "yearly" || normalized === "annual") {
    return "yearly";
  }

  return "monthly";
}

export function getDomesticDurationDays(period: DomesticBillingPeriod) {
  return period === "yearly" ? 365 : 30;
}

export function getDomesticClientMeta(request: Request): DomesticClientMeta {
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "";

  return {
    ipAddress,
    userAgent: request.headers.get("user-agent")?.trim() || "",
    countryCode:
      request.headers.get("x-vercel-ip-country")?.trim() ||
      request.headers.get("cf-ipcountry")?.trim() ||
      "",
  };
}

export async function requireDomesticRuntimeDb() {
  if (!isDomesticRuntime()) {
    throw new DomesticPaymentError("当前环境不是国内版，禁止调用国内支付接口。", 403);
  }

  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    throw new DomesticPaymentError("数据库连接不可用，请稍后重试。", 503);
  }
  if (db.backend !== "cloudbase") {
    throw new DomesticPaymentError("国内支付仅支持 CloudBase 数据源。", 503);
  }

  return db;
}

export async function requireDomesticLoginUser(request: Request) {
  if (!isDomesticRuntime()) {
    throw new DomesticPaymentError("当前环境不是国内版，禁止调用国内支付接口。", 403);
  }

  const accessToken =
    request.headers.get(CLOUDBASE_ACCESS_TOKEN_HEADER)?.trim() || "";

  if (!accessToken) {
    throw new DomesticPaymentError("缺少登录凭证，请重新登录后再试。", 401);
  }

  let verifiedUser: CloudbaseVerifiedUser | null = null;
  try {
    verifiedUser = await verifyCloudbaseAccessToken(accessToken);
  } catch (error) {
    throw new DomesticPaymentError(
      `登录校验失败: ${toReadableError(error, "unknown")}`,
      503,
    );
  }

  if (!verifiedUser?.userId) {
    throw new DomesticPaymentError("登录状态已失效，请重新登录。", 401);
  }

  return verifiedUser;
}

export async function ensureDomesticAppUser(input: {
  db: RoutedAdminDbClient;
  userId: string;
  email: string | null;
}) {
  const { db, userId, email } = input;
  const nowIso = toDomesticDateTime(new Date());
  const normalizedEmail = (email || "").trim().toLowerCase() || null;

  const rows = await queryRows<AppUserRow>(
    db
      .from("app_users")
      .select("id,source,email,email_normalized,display_name,current_plan_code")
      .eq("id", userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(1),
    "读取用户信息失败",
  );

  if (rows.length > 0) {
    const row = rows[0];
    const updates: Record<string, unknown> = {
      updated_at: nowIso,
      is_active: true,
      last_login_at: nowIso,
    };

    if (normalizedEmail && (!row.email_normalized || row.email_normalized !== normalizedEmail)) {
      updates.email = normalizedEmail;
      updates.email_normalized = normalizedEmail;
    }

    await executeQuery(
      db
        .from("app_users")
        .update(updates)
        .eq("id", userId)
        .eq("source", DOMESTIC_SOURCE),
      "更新用户信息失败",
    );

    return;
  }

  await executeQuery(
    db.from("app_users").insert({
      id: userId,
      source: DOMESTIC_SOURCE,
      email: normalizedEmail,
      email_normalized: normalizedEmail,
      display_name: normalizedEmail ? normalizedEmail.split("@")[0] : "用户",
      current_plan_code: "free",
      subscription_status: "inactive",
      is_active: true,
      last_login_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    }),
    "创建用户信息失败",
  );
}

export async function assertDomesticSubscriptionPurchaseAllowed(input: {
  db: RoutedAdminDbClient;
  userId: string;
  targetPlanCode: DomesticPlanCode;
}) {
  const rows = await queryRows<AppUserRow>(
    input.db
      .from("app_users")
      .select("id,source,current_plan_code,plan_expires_at")
      .eq("id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(1),
    "读取用户套餐状态失败",
  );

  const userRow = rows[0];
  const currentPlanCode = resolveDomesticPlanCode(userRow?.current_plan_code);
  if (!currentPlanCode || currentPlanCode === input.targetPlanCode) {
    return;
  }

  const expiresAtText = normalizeText(userRow?.plan_expires_at, "");
  const expiresAtMs = expiresAtText ? new Date(expiresAtText).getTime() : 0;
  if (expiresAtMs <= Date.now()) {
    return;
  }

  const [currentPlan, targetPlan] = await Promise.all([
    readDomesticPlanDefinition({
      db: input.db,
      planCode: currentPlanCode,
    }),
    readDomesticPlanDefinition({
      db: input.db,
      planCode: input.targetPlanCode,
    }),
  ]);

  if (targetPlan.planLevel < currentPlan.planLevel) {
    throw new DomesticPaymentError(
      "当前为更高等级套餐，降级请在当前周期结束后再操作。",
      400,
    );
  }
}

export async function readDomesticPlanPricing(input: {
  db: RoutedAdminDbClient;
  planCode: DomesticPlanCode;
  billingPeriod: DomesticBillingPeriod;
}) {
  const { db, planCode, billingPeriod } = input;

  const [priceRows, planDefinition] = await Promise.all([
    queryRows<PlanPriceRow>(
      db
        .from("plan_prices")
        .select(
          "source,plan_code,billing_period,currency,amount,original_amount,is_active",
        )
        .eq("source", DOMESTIC_SOURCE)
        .eq("plan_code", planCode)
        .eq("billing_period", billingPeriod)
        .eq("currency", DOMESTIC_CURRENCY)
        .limit(5),
      "读取套餐价格失败",
    ),
    readDomesticPlanDefinition({ db, planCode }),
  ]);

  const activePrice = priceRows.find((item) => item.is_active !== false);

  if (!activePrice) {
    throw new DomesticPaymentError("未找到可用的国内套餐价格配置。", 400);
  }

  return {
    planCode: planDefinition.planCode,
    billingPeriod,
    currency: DOMESTIC_CURRENCY,
    amount: toSafeAmount(activePrice.amount, 0),
    originalAmount:
      activePrice.original_amount === null || activePrice.original_amount === undefined
        ? null
        : toSafeAmount(activePrice.original_amount, 0),
    displayNameCn: planDefinition.displayNameCn,
    displayNameEn: planDefinition.displayNameEn,
    monthlyDocumentLimit: planDefinition.monthlyDocumentLimit,
    monthlyImageLimit: planDefinition.monthlyImageLimit,
    monthlyVideoLimit: planDefinition.monthlyVideoLimit,
    monthlyAudioLimit: planDefinition.monthlyAudioLimit,
    planLevel: planDefinition.planLevel,
  } as DomesticPlanPricing;
}

async function readDomesticPlanDefinition(input: {
  db: RoutedAdminDbClient;
  planCode: DomesticPlanCode;
}): Promise<DomesticPlanDefinition> {
  const rows = await queryRows<SubscriptionPlanRow>(
    input.db
      .from("subscription_plans")
      .select(
        "plan_code,display_name_cn,display_name_en,plan_level,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit,is_active",
      )
      .eq("plan_code", input.planCode)
      .limit(5),
    "读取套餐定义失败",
  );

  const activePlan = rows.find((item) => item.is_active !== false);
  if (!activePlan) {
    throw new DomesticPaymentError("未找到可用的套餐定义。", 400);
  }

  return {
    planCode: input.planCode,
    displayNameCn: normalizeText(activePlan.display_name_cn, input.planCode),
    displayNameEn: normalizeText(activePlan.display_name_en, input.planCode),
    monthlyDocumentLimit: toSafeInt(activePlan.monthly_document_limit, 0),
    monthlyImageLimit: toSafeInt(activePlan.monthly_image_limit, 0),
    monthlyVideoLimit: toSafeInt(activePlan.monthly_video_limit, 0),
    monthlyAudioLimit: toSafeInt(activePlan.monthly_audio_limit, 0),
    planLevel: toSafeInt(activePlan.plan_level, 0),
  };
}

function buildOrderName(plan: DomesticPlanPricing) {
  const periodText =
    plan.billingPeriod === "yearly" ? "年度订阅" : "月度订阅";
  return `${plan.displayNameCn} - ${periodText}`;
}

export function generateProviderOrderId(prefix: "WX" | "ALI") {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${timestamp}${random}`;
}

function generateOrderNo() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD${timestamp}${random}`;
}

export async function createDomesticSubscriptionOrder(input: {
  db: RoutedAdminDbClient;
  userId: string;
  userEmail: string | null;
  plan: DomesticPlanPricing;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  clientMeta: DomesticClientMeta;
}) {
  const { db, userId, userEmail, plan, provider, providerOrderId, clientMeta } = input;
  const nowIso = toDomesticDateTime(new Date());

  const orderId = createTextId("order");
  const orderNo = generateOrderNo();
  const discountAmount =
    plan.originalAmount && plan.originalAmount > plan.amount
      ? Number((plan.originalAmount - plan.amount).toFixed(2))
      : 0;

  await executeQuery(
    db.from("orders").insert({
      id: orderId,
      order_no: orderNo,
      user_id: userId,
      source: DOMESTIC_SOURCE,
      order_type: "subscription",
      product_code: plan.planCode,
      product_name: buildOrderName(plan),
      plan_code: plan.planCode,
      billing_period: plan.billingPeriod,
      amount: plan.amount,
      currency: plan.currency,
      original_amount: plan.originalAmount,
      discount_amount: discountAmount,
      payment_provider: provider,
      payment_method: provider,
      payment_status: "pending",
      provider_order_id: providerOrderId,
      idempotency_key: `${DOMESTIC_SOURCE}_${provider}_${providerOrderId}`,
      ip_address: clientMeta.ipAddress,
      user_agent: clientMeta.userAgent,
      country_code: clientMeta.countryCode,
      extra_json: stringifyCloudbaseJson({
        user_email: userEmail,
      }),
      created_at: nowIso,
      updated_at: nowIso,
    }),
    "写入订单失败",
  );

  await executeQuery(
    db.from("payment_transactions").insert({
      id: createTextId("paytx"),
      order_id: orderId,
      user_id: userId,
      source: DOMESTIC_SOURCE,
      provider,
      transaction_type: "charge",
      amount: plan.amount,
      currency: plan.currency,
      status: "pending",
      provider_order_id: providerOrderId,
      request_payload_json: stringifyCloudbaseJson({
        plan_code: plan.planCode,
        billing_period: plan.billingPeriod,
        user_id: userId,
      }),
      created_at: nowIso,
      updated_at: nowIso,
    }),
    "写入支付流水失败",
  );

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: "payment_initiated",
    eventName: `${provider}_subscription_order_created`,
    relatedOrderId: orderId,
    eventValue: plan.amount,
    eventData: {
      provider,
      plan_code: plan.planCode,
      billing_period: plan.billingPeriod,
      currency: plan.currency,
    },
    ensureSession: true,
  });

  return {
    orderId,
    orderNo,
  };
}

export async function markDomesticOrderFailed(input: {
  db: RoutedAdminDbClient;
  orderId: string;
  providerOrderId: string;
  provider: DomesticPaymentProvider;
  reason: string;
}) {
  const nowIso = toDomesticDateTime(new Date());
  await executeQuery(
    input.db
      .from("orders")
      .update({
        payment_status: "failed",
        notes: input.reason,
        updated_at: nowIso,
      })
      .eq("id", input.orderId),
    "更新失败订单状态失败",
  );

  await executeQuery(
    input.db
      .from("payment_transactions")
      .update({
        status: "failed",
        error_message: input.reason,
        processed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("order_id", input.orderId)
      .eq("provider", input.provider)
      .eq("provider_order_id", input.providerOrderId),
    "更新失败流水状态失败",
  );

  try {
    const orderRows = await queryRows<DomesticOrderRow>(
      input.db
        .from("orders")
        .select("id,user_id,plan_code,billing_period,amount,currency")
        .eq("id", input.orderId)
        .limit(1),
      "读取失败订单失败",
    );
    const failedOrder = orderRows[0];

    void trackDomesticAnalyticsEvent({
      userId: failedOrder?.user_id || null,
      eventType: "payment_failed",
      eventName: `${input.provider}_payment_failed`,
      relatedOrderId: input.orderId,
      eventValue: toSafeAmount(failedOrder?.amount, 0),
      eventData: {
        provider: input.provider,
        provider_order_id: input.providerOrderId,
        plan_code: failedOrder?.plan_code || null,
        billing_period: failedOrder?.billing_period || null,
        currency: failedOrder?.currency || DOMESTIC_CURRENCY,
        reason: input.reason,
      },
      ensureSession: true,
    });
  } catch (error) {
    console.warn("[DomesticPayment] track failed payment analytics failed:", error);
  }
}

export async function readDomesticOrderByProviderOrderId(input: {
  db: RoutedAdminDbClient;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
}) {
  const rows = await queryRows<DomesticOrderRow>(
    input.db
      .from("orders")
      .select(
        "id,order_no,user_id,source,order_type,product_code,product_name,plan_code,billing_period,amount,currency,payment_provider,payment_status,paid_at,provider_order_id,provider_transaction_id,extra_json,created_at,updated_at",
      )
      .eq("source", DOMESTIC_SOURCE)
      .eq("payment_provider", input.provider)
      .eq("provider_order_id", input.providerOrderId)
      .limit(2),
    "读取订单失败",
  );

  return rows[0] || null;
}

async function upsertSubscription(input: {
  db: RoutedAdminDbClient;
  userId: string;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  orderId: string;
  planCode: DomesticPlanCode;
  billingPeriod: DomesticBillingPeriod;
  planExpiresAtIso: string;
  nowIso: string;
}) {
  type SubscriptionApplyResult = {
    action: "activate" | "renew" | "upgrade";
    fromPlanCode: string;
    periodStartIso: string;
    periodEndIso: string;
    shouldSyncQuotaNow: boolean;
  };

  const rows = await queryRows<UserSubscriptionRow>(
    input.db
      .from("user_subscriptions")
      .select("id,user_id,plan_code,status,current_period_end")
      .eq("user_id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(20),
    "读取用户订阅失败",
  );

  const latestRow = [...rows].sort((left, right) =>
    compareByDateDesc(left.current_period_end, right.current_period_end),
  )[0];

  const fromPlanCode = normalizeText(latestRow?.plan_code, "free") as string;
  const nowMs = new Date(input.nowIso).getTime();
  const currentPeriodEndIso = normalizeText(latestRow?.current_period_end, "");
  const currentPeriodEndMs = currentPeriodEndIso
    ? new Date(currentPeriodEndIso).getTime()
    : 0;
  const currentStillActive = currentPeriodEndMs > nowMs;
  const samePlanRenew = currentStillActive && fromPlanCode === input.planCode;

  let action: SubscriptionApplyResult["action"] = "activate";
  let periodStartIso = input.nowIso;
  let periodEndIso = input.planExpiresAtIso;
  let shouldSyncQuotaNow = true;

  if (samePlanRenew) {
    action = "renew";
    periodStartIso = currentPeriodEndIso;
    periodEndIso = toDomesticDateTime(
      addDays(new Date(currentPeriodEndIso), getDomesticDurationDays(input.billingPeriod)),
    );
    // 同套餐提前续费仅延长到期时间，不应立即重置当期额度。
    shouldSyncQuotaNow = false;
  } else if (fromPlanCode !== "free" && fromPlanCode !== input.planCode) {
    action = "upgrade";
  }

  if (latestRow?.id) {
    await executeQuery(
      input.db
        .from("user_subscriptions")
        .update({
          plan_code: input.planCode,
          billing_period: input.billingPeriod,
          status: "active",
          provider: input.provider,
          provider_subscription_id: input.providerOrderId,
          latest_order_id: input.orderId,
          current_period_start: periodStartIso,
          current_period_end: periodEndIso,
          cancel_at_period_end: false,
          canceled_at: null,
          updated_at: input.nowIso,
          metadata_json: stringifyCloudbaseJson({
            last_paid_order_id: input.orderId,
            source: DOMESTIC_SOURCE,
          }),
        })
        .eq("id", latestRow.id),
      "更新用户订阅失败",
    );
  } else {
    await executeQuery(
      input.db.from("user_subscriptions").insert({
        id: createTextId("sub"),
        user_id: input.userId,
        source: DOMESTIC_SOURCE,
        plan_code: input.planCode,
        billing_period: input.billingPeriod,
        status: "active",
        provider: input.provider,
        provider_subscription_id: input.providerOrderId,
        latest_order_id: input.orderId,
        start_at: input.nowIso,
        current_period_start: periodStartIso,
        current_period_end: periodEndIso,
        cancel_at_period_end: false,
        metadata_json: stringifyCloudbaseJson({
          last_paid_order_id: input.orderId,
          source: DOMESTIC_SOURCE,
        }),
        created_at: input.nowIso,
        updated_at: input.nowIso,
      }),
      "创建用户订阅失败",
    );
  }

  await executeQuery(
    input.db.from("subscription_change_logs").insert({
      id: createTextId("sub_log"),
      user_id: input.userId,
      source: DOMESTIC_SOURCE,
      action,
      from_plan_code: fromPlanCode,
      to_plan_code: input.planCode,
      from_period_end: latestRow?.current_period_end || null,
      to_period_end: periodEndIso,
      reason: `domestic_payment_${input.provider}`,
      operator_type: "user",
      operator_id: input.userId,
      related_order_id: input.orderId,
      created_at: input.nowIso,
    }),
    "写入订阅变更日志失败",
  );

  return {
    action,
    fromPlanCode,
    periodStartIso,
    periodEndIso,
    shouldSyncQuotaNow,
  } as SubscriptionApplyResult;
}

async function syncQuotaAccount(input: {
  db: RoutedAdminDbClient;
  userId: string;
  plan: DomesticPlanPricing;
  now: Date;
}) {
  const nowIso = toDomesticDateTime(input.now);
  const resetAt = addDays(input.now, 30);
  const cycleStartDate = formatDateOnly(input.now);
  const cycleEndDate = formatDateOnly(resetAt);

  const accountRows = await queryRows<UserQuotaAccountRow>(
    input.db
      .from("user_quota_accounts")
      .select("id,status,cycle_end_date")
      .eq("user_id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(20),
    "读取额度账户失败",
  );

  const activeAccount = [...accountRows]
    .filter((item) => normalizeText(item.status, "") === "active")
    .sort((left, right) => compareByDateDesc(left.cycle_end_date, right.cycle_end_date))[0];

  let quotaAccountId = normalizeText(activeAccount?.id, "") || createTextId("quota_account");

  if (activeAccount?.id) {
    await executeQuery(
      input.db
        .from("user_quota_accounts")
        .update({
          plan_code: input.plan.planCode,
          status: "active",
          cycle_type: "monthly",
          cycle_start_date: cycleStartDate,
          cycle_end_date: cycleEndDate,
          next_reset_at: toDomesticDateTime(resetAt),
          updated_at: nowIso,
        })
        .eq("id", activeAccount.id),
      "更新额度账户失败",
    );
  } else {
    try {
      await executeQuery(
        input.db.from("user_quota_accounts").insert({
          id: quotaAccountId,
          user_id: input.userId,
          source: DOMESTIC_SOURCE,
          plan_code: input.plan.planCode,
          status: "active",
          cycle_type: "monthly",
          cycle_start_date: cycleStartDate,
          cycle_end_date: cycleEndDate,
          next_reset_at: toDomesticDateTime(resetAt),
          created_at: nowIso,
          updated_at: nowIso,
        }),
        "创建额度账户失败",
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      // 并发 confirm 场景：另一次请求已先插入同周期账户，回读后继续流程。
      const concurrentRows = await queryRows<UserQuotaAccountRow>(
        input.db
          .from("user_quota_accounts")
          .select("id,status,cycle_end_date")
          .eq("user_id", input.userId)
          .eq("source", DOMESTIC_SOURCE)
          .eq("cycle_start_date", cycleStartDate)
          .eq("cycle_end_date", cycleEndDate)
          .limit(5),
        "读取并发创建后的额度账户失败",
      );

      const concurrentAccount = concurrentRows
        .map((row) => normalizeText(row.id, ""))
        .find((id) => Boolean(id));

      if (!concurrentAccount) {
        throw error;
      }

      quotaAccountId = concurrentAccount;

      await executeQuery(
        input.db
          .from("user_quota_accounts")
          .update({
            plan_code: input.plan.planCode,
            status: "active",
            cycle_type: "monthly",
            cycle_start_date: cycleStartDate,
            cycle_end_date: cycleEndDate,
            next_reset_at: toDomesticDateTime(resetAt),
            updated_at: nowIso,
          })
          .eq("id", quotaAccountId),
        "更新并发创建后的额度账户失败",
      );
    }
  }

  for (const account of accountRows) {
    if (!account.id || account.id === quotaAccountId) {
      continue;
    }
    if (normalizeText(account.status, "") !== "active") {
      continue;
    }

    await executeQuery(
      input.db
        .from("user_quota_accounts")
        .update({
          status: "expired",
          updated_at: nowIso,
        })
        .eq("id", account.id),
      "更新历史额度账户失败",
    );
  }

  const existingBalanceRows = await queryRows<UserQuotaBalanceRow>(
    input.db
      .from("user_quota_balances")
      .select("id,quota_type")
      .eq("quota_account_id", quotaAccountId)
      .limit(20),
    "读取额度余额失败",
  );

  const balanceMap = new Map<string, string>();
  for (const row of existingBalanceRows) {
    const quotaType = normalizeText(row.quota_type, "");
    const id = normalizeText(row.id, "");
    if (!quotaType || !id) {
      continue;
    }
    balanceMap.set(quotaType, id);
  }

  const quotaDefinitions: Array<{ type: string; limit: number }> = [
    { type: "document", limit: input.plan.monthlyDocumentLimit },
    { type: "image", limit: input.plan.monthlyImageLimit },
    { type: "video", limit: input.plan.monthlyVideoLimit },
    { type: "audio", limit: input.plan.monthlyAudioLimit },
  ];

  for (const definition of quotaDefinitions) {
    const existingId = balanceMap.get(definition.type);

    if (existingId) {
      await executeQuery(
        input.db
          .from("user_quota_balances")
          .update({
            base_limit: definition.limit,
            addon_limit: 0,
            admin_adjustment: 0,
            used_amount: 0,
            remaining_amount: definition.limit,
            updated_at: nowIso,
          })
          .eq("id", existingId),
        "更新额度余额失败",
      );
      continue;
    }

    try {
      await executeQuery(
        input.db.from("user_quota_balances").insert({
          id: createTextId("quota_balance"),
          quota_account_id: quotaAccountId,
          quota_type: definition.type,
          base_limit: definition.limit,
          addon_limit: 0,
          admin_adjustment: 0,
          used_amount: 0,
          remaining_amount: definition.limit,
          updated_at: nowIso,
        }),
        "创建额度余额失败",
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      // 并发场景下同一 quota_type 可能已被另一请求插入，转为更新即可。
      const concurrentBalanceRows = await queryRows<UserQuotaBalanceRow>(
        input.db
          .from("user_quota_balances")
          .select("id,quota_type")
          .eq("quota_account_id", quotaAccountId)
          .eq("quota_type", definition.type)
          .limit(1),
        "读取并发创建后的额度余额失败",
      );

      const concurrentBalanceId = normalizeText(concurrentBalanceRows[0]?.id, "");
      if (!concurrentBalanceId) {
        throw error;
      }

      await executeQuery(
        input.db
          .from("user_quota_balances")
          .update({
            base_limit: definition.limit,
            addon_limit: 0,
            admin_adjustment: 0,
            used_amount: 0,
            remaining_amount: definition.limit,
            updated_at: nowIso,
          })
          .eq("id", concurrentBalanceId),
        "更新并发创建后的额度余额失败",
      );
    }
  }
}

export async function settleDomesticSubscriptionPayment(input: {
  db: RoutedAdminDbClient;
  order: DomesticOrderRow;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  providerTransactionId?: string | null;
  providerPayload?: unknown;
}) {
  const orderId = normalizeText(input.order.id, "");
  const userId = normalizeText(input.order.user_id, "");
  const planCode = resolveDomesticPlanCode(input.order.plan_code);
  const billingPeriod = resolveDomesticBillingPeriod(input.order.billing_period);

  if (!orderId || !userId || !planCode) {
    throw new DomesticPaymentError("订单缺少必要字段，无法确认支付。", 400);
  }

  const paymentStatus = normalizeText(input.order.payment_status, "pending").toLowerCase();
  const rawExtraJson = parseJsonRecord(input.order.extra_json);
  const hasAppliedMarker = rawExtraJson.subscription_applied === true;

  if (paymentStatus === "paid" && hasAppliedMarker) {
    const paidAt = normalizeText(input.order.paid_at, "") || null;
    return {
      alreadyPaid: true,
      planCode,
      paidAt,
    };
  }

  const now = new Date();
  const nowIso = toDomesticDateTime(now);
  const paidAtIso =
    paymentStatus === "paid" && normalizeText(input.order.paid_at, "")
      ? normalizeText(input.order.paid_at, "")
      : nowIso;
  const defaultPlanExpiresAt = addDays(now, getDomesticDurationDays(billingPeriod));
  const defaultPlanExpiresAtIso = toDomesticDateTime(defaultPlanExpiresAt);

  const planDefinition = await readDomesticPlanDefinition({
    db: input.db,
    planCode,
  });

  const plan: DomesticPlanPricing = {
    ...planDefinition,
    billingPeriod,
    currency: DOMESTIC_CURRENCY,
    amount: toSafeAmount(input.order.amount, 0),
    originalAmount: null,
  };

  await executeQuery(
    input.db
      .from("orders")
      .update({
        payment_status: "paid",
        paid_at: paidAtIso,
        provider_transaction_id: input.providerTransactionId || null,
        updated_at: nowIso,
        notes: null,
        extra_json: stringifyCloudbaseJson({
          ...rawExtraJson,
          provider_payload: input.providerPayload || null,
        }),
      })
      .eq("id", orderId),
    "更新订单支付状态失败",
  );

  const txRows = await queryRows<PaymentTxRow>(
    input.db
      .from("payment_transactions")
      .select("id,order_id,provider,provider_order_id")
      .eq("order_id", orderId)
      .eq("provider", input.provider)
      .eq("provider_order_id", input.providerOrderId)
      .limit(5),
    "读取支付流水失败",
  );

  if (txRows[0]?.id) {
    await executeQuery(
      input.db
        .from("payment_transactions")
        .update({
          status: "success",
          provider_transaction_id: input.providerTransactionId || null,
          response_payload_json: stringifyCloudbaseJson(input.providerPayload || null),
          processed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", txRows[0].id),
      "更新支付流水失败",
    );
  } else {
    await executeQuery(
      input.db.from("payment_transactions").insert({
        id: createTextId("paytx"),
        order_id: orderId,
        user_id: userId,
        source: DOMESTIC_SOURCE,
        provider: input.provider,
        transaction_type: "charge",
        amount: toSafeAmount(input.order.amount, plan.amount),
        currency: DOMESTIC_CURRENCY,
        status: "success",
        provider_order_id: input.providerOrderId,
        provider_transaction_id: input.providerTransactionId || null,
        response_payload_json: stringifyCloudbaseJson(input.providerPayload || null),
        processed_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      }),
      "创建支付流水失败",
    );
  }

  const existedApplyLog = (
    await queryRows<SubscriptionChangeLogRow>(
      input.db
        .from("subscription_change_logs")
        .select("action,to_plan_code,to_period_end")
        .eq("source", DOMESTIC_SOURCE)
        .eq("related_order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1),
      "读取订阅幂等日志失败",
    )
  )[0];

  if (existedApplyLog) {
    const stablePlanCode =
      resolveDomesticPlanCode(existedApplyLog.to_plan_code) || planCode;
    const stablePeriodEnd =
      normalizeText(existedApplyLog.to_period_end, "") || defaultPlanExpiresAtIso;
    const stableAction =
      normalizeText(existedApplyLog.action, "") || "activate";
    const shouldSyncQuotaNow = stableAction !== "renew";

    const appUserUpdates: Record<string, unknown> = {
      current_plan_code: stablePlanCode,
      subscription_status: "active",
      plan_expires_at: stablePeriodEnd,
      updated_at: nowIso,
    };
    if (shouldSyncQuotaNow) {
      appUserUpdates.plan_started_at = nowIso;
    }

    await executeQuery(
      input.db
        .from("app_users")
        .update(appUserUpdates)
        .eq("id", userId)
        .eq("source", DOMESTIC_SOURCE),
      "同步用户套餐状态失败",
    );

    if (shouldSyncQuotaNow) {
      await syncQuotaAccount({
        db: input.db,
        userId,
        plan,
        now,
      });
    }

    await executeQuery(
      input.db
        .from("orders")
        .update({
          updated_at: nowIso,
          extra_json: stringifyCloudbaseJson({
            ...rawExtraJson,
            provider_payload: input.providerPayload || null,
            subscription_applied: true,
            subscription_applied_at: nowIso,
            subscription_action: stableAction,
            subscription_period_end: stablePeriodEnd,
          }),
        })
        .eq("id", orderId),
      "补写订单订阅应用标记失败",
    );

    return {
      alreadyPaid: true,
      planCode: stablePlanCode,
      planExpiresAt: stablePeriodEnd,
      paidAt: paidAtIso,
    };
  }

  const subscriptionResult = await upsertSubscription({
    db: input.db,
    userId,
    provider: input.provider,
    providerOrderId: input.providerOrderId,
    orderId,
    planCode,
    billingPeriod,
    planExpiresAtIso: defaultPlanExpiresAtIso,
    nowIso,
  });

  const appUserUpdates: Record<string, unknown> = {
    current_plan_code: planCode,
    subscription_status: "active",
    plan_expires_at: subscriptionResult.periodEndIso,
    updated_at: nowIso,
  };

  if (subscriptionResult.shouldSyncQuotaNow) {
    appUserUpdates.plan_started_at = nowIso;
  }

  await executeQuery(
    input.db
      .from("app_users")
      .update(appUserUpdates)
      .eq("id", userId)
      .eq("source", DOMESTIC_SOURCE),
    "更新用户套餐状态失败",
  );

  if (subscriptionResult.shouldSyncQuotaNow) {
    await syncQuotaAccount({
      db: input.db,
      userId,
      plan,
      now,
    });
  }

  await executeQuery(
      input.db
        .from("orders")
        .update({
          updated_at: nowIso,
          extra_json: stringifyCloudbaseJson({
            ...rawExtraJson,
            provider_payload: input.providerPayload || null,
            subscription_applied: true,
            subscription_applied_at: nowIso,
            subscription_action: subscriptionResult.action,
            subscription_period_start: subscriptionResult.periodStartIso,
            subscription_period_end: subscriptionResult.periodEndIso,
          }),
        })
        .eq("id", orderId),
      "写入订单订阅应用标记失败",
  );

  const subscriptionEventType =
    subscriptionResult.action === "renew"
      ? "subscription_renewed"
      : subscriptionResult.action === "upgrade"
        ? "subscription_upgraded"
        : "subscription_activated";

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: "payment_success",
    eventName: `${input.provider}_payment_success`,
    relatedOrderId: orderId,
    eventValue: toSafeAmount(input.order.amount, plan.amount),
    eventData: {
      provider: input.provider,
      provider_order_id: input.providerOrderId,
      provider_transaction_id: input.providerTransactionId || null,
      plan_code: planCode,
      billing_period: billingPeriod,
      currency: DOMESTIC_CURRENCY,
      action: subscriptionResult.action,
    },
    ensureSession: true,
  });

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: subscriptionEventType,
    eventName: `subscription_${subscriptionResult.action}`,
    relatedOrderId: orderId,
    eventData: {
      provider: input.provider,
      from_plan_code: subscriptionResult.fromPlanCode,
      to_plan_code: planCode,
      billing_period: billingPeriod,
      period_start: subscriptionResult.periodStartIso,
      period_end: subscriptionResult.periodEndIso,
    },
    ensureSession: true,
  });

  return {
    alreadyPaid: false,
    planCode,
    planExpiresAt: subscriptionResult.periodEndIso,
    paidAt: paidAtIso,
  };
}

export function toHttpError(error: unknown) {
  if (error instanceof DomesticPaymentError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: toReadableError(error, "支付服务暂不可用，请稍后重试。"),
  };
}
