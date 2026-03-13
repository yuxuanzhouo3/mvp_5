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

export type DomesticSubscriptionCheckoutQuote = {
  pricingPlan: DomesticPlanPricing;
  checkoutPlan: DomesticPlanPricing;
  extraJson: Record<string, unknown>;
  isUpgrade: boolean;
};

export type DomesticAddonCode = "light" | "standard" | "premium";

export type DomesticAddonPricing = {
  addonCode: DomesticAddonCode;
  currency: "CNY";
  amount: number;
  displayNameCn: string;
  displayNameEn: string;
  documentQuota: number;
  imageQuota: number;
  videoQuota: number;
  audioQuota: number;
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
  subscription_status?: string | null;
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

type AddonPackageRow = {
  addon_code?: string | null;
  display_name_cn?: string | null;
  display_name_en?: string | null;
  document_quota?: number | string | null;
  image_quota?: number | string | null;
  video_quota?: number | string | null;
  audio_quota?: number | string | null;
  is_active?: boolean | null;
};

type AddonPackagePriceRow = {
  source?: string | null;
  addon_code?: string | null;
  currency?: string | null;
  amount?: number | string | null;
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
  from_period_end?: string | null;
  to_plan_code?: string | null;
  to_period_end?: string | null;
};

type UserSubscriptionRow = {
  id?: string | null;
  user_id?: string | null;
  plan_code?: string | null;
  billing_period?: string | null;
  status?: string | null;
  latest_order_id?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
};

type UserQuotaAccountRow = {
  id?: string | null;
  plan_code?: string | null;
  status?: string | null;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  next_reset_at?: string | null;
};

type UserQuotaBalanceRow = {
  id?: string | null;
  quota_type?: string | null;
  base_limit?: number | string | null;
  addon_limit?: number | string | null;
  admin_adjustment?: number | string | null;
  used_amount?: number | string | null;
  remaining_amount?: number | string | null;
};

type UserAddonPurchaseRow = {
  id?: string | null;
  addon_code?: string | null;
  status?: string | null;
  granted_at?: string | null;
  updated_at?: string | null;
};

type QuotaSeedDefinition = {
  planCode: string;
  monthlyDocumentLimit: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  monthlyAudioLimit: number;
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

const ADDON_SETTLEMENT_POLL_MS = 200;
const ADDON_SETTLEMENT_POLL_ATTEMPTS = 15;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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

const DEFAULT_PLAN_QUOTA_LIMITS: Record<string, QuotaSeedDefinition> = {
  free: {
    planCode: "free",
    monthlyDocumentLimit: 120,
    monthlyImageLimit: 4,
    monthlyVideoLimit: 1,
    monthlyAudioLimit: 6,
  },
  pro: {
    planCode: "pro",
    monthlyDocumentLimit: 2000,
    monthlyImageLimit: 60,
    monthlyVideoLimit: 10,
    monthlyAudioLimit: 60,
  },
  enterprise: {
    planCode: "enterprise",
    monthlyDocumentLimit: 8000,
    monthlyImageLimit: 250,
    monthlyVideoLimit: 25,
    monthlyAudioLimit: 250,
  },
};

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

function compareByDateAsc(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return leftTime - rightTime;
}

function normalizeSubscriptionStatus(input: unknown) {
  return normalizeText(input, "").toLowerCase();
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

export function resolveDomesticAddonCode(input: unknown): DomesticAddonCode | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === "light" || normalized === "standard" || normalized === "premium") {
    return normalized as DomesticAddonCode;
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

    await ensureDomesticUserQuotaState({
      db,
      userId,
    });
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

  await ensureDomesticUserQuotaState({
    db,
    userId,
  });
}

export async function assertDomesticSubscriptionPurchaseAllowed(input: {
  db: RoutedAdminDbClient;
  userId: string;
  targetPlanCode: DomesticPlanCode;
}) {
  await applyDueDomesticPendingSubscriptions({
    db: input.db,
    userId: input.userId,
    limit: 5,
  });

  const pendingRows = await queryRows<UserSubscriptionRow>(
    input.db
      .from("user_subscriptions")
      .select("id,user_id,plan_code,status,current_period_start,current_period_end")
      .eq("user_id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .eq("status", "pending")
      .limit(5),
    "读取待生效订阅失败",
  );

  if (pendingRows.length > 0) {
    throw new DomesticPaymentError(
      "已有待生效的订阅变更，请等待当前周期结束后再操作。",
      400,
    );
  }

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
    return;
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

export async function prepareDomesticSubscriptionCheckout(input: {
  db: RoutedAdminDbClient;
  userId: string;
  planCode: DomesticPlanCode;
  billingPeriod: DomesticBillingPeriod;
}) {
  const [pricingPlan, userRows, subscriptionRows] = await Promise.all([
    readDomesticPlanPricing({
      db: input.db,
      planCode: input.planCode,
      billingPeriod: input.billingPeriod,
    }),
    queryRows<AppUserRow>(
      input.db
        .from("app_users")
        .select("id,current_plan_code,plan_expires_at")
        .eq("id", input.userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(1),
      "读取用户升级价格上下文失败",
    ),
    queryRows<UserSubscriptionRow>(
      input.db
        .from("user_subscriptions")
        .select("id,plan_code,billing_period,status,current_period_end")
        .eq("user_id", input.userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(20),
      "读取用户当前订阅周期失败",
    ),
  ]);

  const userRow = userRows[0];
  const activeSubscriptionRow = [...subscriptionRows]
    .filter((row) => {
      const status = normalizeSubscriptionStatus(row.status);
      const periodEndMs = row.current_period_end
        ? new Date(row.current_period_end).getTime()
        : 0;
      return (
        status !== "pending" &&
        status !== "expired" &&
        status !== "canceled" &&
        periodEndMs > Date.now()
      );
    })
    .sort((left, right) =>
      compareByDateDesc(left.current_period_end, right.current_period_end),
    )[0];
  const currentPlanCode = resolveDomesticPlanCode(userRow?.current_plan_code);
  const currentBillingPeriod =
    resolveDomesticBillingPeriod(activeSubscriptionRow?.billing_period) || "monthly";
  const currentPlanExpiresAt =
    normalizeText(activeSubscriptionRow?.current_period_end, "") ||
    normalizeText(userRow?.plan_expires_at, "");
  const currentPlanExpiresMs = currentPlanExpiresAt
    ? new Date(currentPlanExpiresAt).getTime()
    : 0;
  const remainingDays =
    currentPlanExpiresMs > Date.now()
      ? Math.max(
          0,
          Math.ceil((currentPlanExpiresMs - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

  if (
    !currentPlanCode ||
    currentPlanCode === input.planCode ||
    remainingDays <= 0
  ) {
    return {
      pricingPlan,
      checkoutPlan: pricingPlan,
      extraJson: {},
      isUpgrade: false,
    } satisfies DomesticSubscriptionCheckoutQuote;
  }

  const currentPlanPricing = await readDomesticPlanPricing({
    db: input.db,
    planCode: currentPlanCode,
    billingPeriod: currentBillingPeriod,
  });

  if (pricingPlan.planLevel <= currentPlanPricing.planLevel) {
    return {
      pricingPlan,
      checkoutPlan: pricingPlan,
      extraJson: {},
      isUpgrade: false,
    } satisfies DomesticSubscriptionCheckoutQuote;
  }

  const currentDurationDays = getDomesticDurationDays(currentBillingPeriod);
  const targetDurationDays = getDomesticDurationDays(input.billingPeriod);
  const currentDailyPrice = currentPlanPricing.amount / currentDurationDays;
  const targetDailyPrice = Math.max(0.01, pricingPlan.amount / targetDurationDays);
  const remainingValue = Number((remainingDays * currentDailyPrice).toFixed(2));
  const freeUpgrade = remainingValue >= pricingPlan.amount;
  const subscriptionDurationDays = freeUpgrade
    ? Math.max(1, Math.floor(remainingValue / targetDailyPrice))
    : targetDurationDays;
  const chargedAmount = freeUpgrade
    ? 0.01
    : Math.max(0.01, Number((pricingPlan.amount - remainingValue).toFixed(2)));

  return {
    pricingPlan,
    checkoutPlan: {
      ...pricingPlan,
      amount: Number(chargedAmount.toFixed(2)),
      originalAmount: pricingPlan.amount,
    },
    extraJson: {
      subscription_duration_days: subscriptionDurationDays,
      upgrade_charge_context: {
        mode: "remaining_value",
        current_plan_code: currentPlanCode,
        current_billing_period: currentBillingPeriod,
        current_plan_expires_at: currentPlanExpiresAt || null,
        current_duration_days: currentDurationDays,
        current_price_amount: currentPlanPricing.amount,
        current_daily_price: Number(currentDailyPrice.toFixed(4)),
        remaining_days: remainingDays,
        remaining_value: remainingValue,
        target_billing_period: input.billingPeriod,
        target_duration_days: targetDurationDays,
        target_price_amount: pricingPlan.amount,
        target_daily_price: Number(targetDailyPrice.toFixed(4)),
        charged_amount: Number(chargedAmount.toFixed(2)),
        free_upgrade: freeUpgrade,
      },
    },
    isUpgrade: true,
  } satisfies DomesticSubscriptionCheckoutQuote;
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

async function readQuotaSeedDefinitionByCode(input: {
  db: RoutedAdminDbClient;
  planCode: string;
}) {
  const normalizedPlanCode = normalizeText(input.planCode, "free").toLowerCase();
  const fallback =
    DEFAULT_PLAN_QUOTA_LIMITS[normalizedPlanCode] || DEFAULT_PLAN_QUOTA_LIMITS.free;

  const rows = await queryRows<SubscriptionPlanRow>(
    input.db
      .from("subscription_plans")
      .select(
        "plan_code,display_name_cn,display_name_en,plan_level,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit,is_active",
      )
      .eq("plan_code", normalizedPlanCode)
      .limit(2),
    "读取额度种子套餐配置失败",
  );

  const activePlan = rows.find((item) => item.is_active !== false) || rows[0];
  if (!activePlan) {
    return fallback;
  }

  return {
    planCode: normalizeText(activePlan.plan_code, fallback.planCode),
    monthlyDocumentLimit: toSafeInt(
      activePlan.monthly_document_limit,
      fallback.monthlyDocumentLimit,
    ),
    monthlyImageLimit: toSafeInt(activePlan.monthly_image_limit, fallback.monthlyImageLimit),
    monthlyVideoLimit: toSafeInt(activePlan.monthly_video_limit, fallback.monthlyVideoLimit),
    monthlyAudioLimit: toSafeInt(activePlan.monthly_audio_limit, fallback.monthlyAudioLimit),
  } satisfies QuotaSeedDefinition;
}

async function readCurrentDomesticQuotaSeed(input: {
  db: RoutedAdminDbClient;
  userId: string;
}) {
  const rows = await queryRows<AppUserRow>(
    input.db
      .from("app_users")
      .select("id,current_plan_code,plan_expires_at")
      .eq("id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(1),
    "读取用户当前套餐失败",
  );

  const row = rows[0];
  const currentPlanCode = normalizeText(row?.current_plan_code, "free").toLowerCase();
  const planExpiresAt = normalizeText(row?.plan_expires_at, "");
  const planExpiresMs = planExpiresAt ? new Date(planExpiresAt).getTime() : 0;
  const effectivePlanCode =
    (currentPlanCode === "pro" || currentPlanCode === "enterprise") &&
    planExpiresMs > Date.now()
      ? currentPlanCode
      : "free";

  return readQuotaSeedDefinitionByCode({
    db: input.db,
    planCode: effectivePlanCode,
  });
}

export async function applyDueDomesticPendingSubscriptions(input: {
  db: RoutedAdminDbClient;
  userId?: string;
  now?: Date;
  limit?: number;
}) {
  const now = input.now || new Date();
  const nowIso = toDomesticDateTime(now);
  const limit = input.limit ?? (input.userId ? 10 : 200);

  let pendingQuery = input.db
    .from("user_subscriptions")
    .select(
      "id,user_id,plan_code,billing_period,status,latest_order_id,current_period_start,current_period_end",
    )
    .eq("source", DOMESTIC_SOURCE)
    .eq("status", "pending");

  if (input.userId) {
    pendingQuery = pendingQuery.eq("user_id", input.userId);
  }

  const pendingRows = await queryRows<UserSubscriptionRow>(
    pendingQuery.limit(limit),
    "读取待生效订阅失败",
  );

  let appliedCount = 0;
  let errorCount = 0;

  for (const pendingRow of [...pendingRows].sort((left, right) =>
    compareByDateAsc(left.current_period_start, right.current_period_start),
  )) {
    try {
      const userId = normalizeText(pendingRow.user_id, "");
      const planCode = resolveDomesticPlanCode(pendingRow.plan_code);
      const billingPeriod = resolveDomesticBillingPeriod(pendingRow.billing_period);
      const periodStartIso = normalizeText(pendingRow.current_period_start, "");
      const periodEndIso = normalizeText(pendingRow.current_period_end, "");
      const periodStartMs = periodStartIso ? new Date(periodStartIso).getTime() : 0;

      if (
        !userId ||
        !planCode ||
        normalizeSubscriptionStatus(pendingRow.status) !== "pending" ||
        !periodEndIso ||
        !Number.isFinite(periodStartMs) ||
        periodStartMs > now.getTime()
      ) {
        continue;
      }

      const subscriptionRows = await queryRows<UserSubscriptionRow>(
        input.db
          .from("user_subscriptions")
          .select(
            "id,user_id,plan_code,billing_period,status,latest_order_id,current_period_start,current_period_end",
          )
          .eq("user_id", userId)
          .eq("source", DOMESTIC_SOURCE)
          .limit(20),
        "读取用户订阅状态失败",
      );

      const activeRow = [...subscriptionRows]
        .filter((row) => normalizeSubscriptionStatus(row.status) !== "pending")
        .sort((left, right) => compareByDateDesc(left.current_period_end, right.current_period_end))[0];
      const activePeriodEndIso = normalizeText(activeRow?.current_period_end, "");
      const activePeriodEndMs = activePeriodEndIso
        ? new Date(activePeriodEndIso).getTime()
        : 0;

      if (activeRow?.id && activePeriodEndMs > now.getTime()) {
        continue;
      }

      if (activeRow?.id) {
        await executeQuery(
          input.db
            .from("user_subscriptions")
            .update({
              status: "expired",
              updated_at: nowIso,
            })
            .eq("id", activeRow.id),
          "更新已过期订阅状态失败",
        );
      }

      await executeQuery(
        input.db
          .from("user_subscriptions")
          .update({
            status: "active",
            updated_at: nowIso,
          })
          .eq("id", pendingRow.id),
        "激活待生效订阅失败",
      );

      const planDefinition = await readDomesticPlanDefinition({
        db: input.db,
        planCode,
      });
      const plan: DomesticPlanPricing = {
        ...planDefinition,
        billingPeriod,
        currency: DOMESTIC_CURRENCY,
        amount: 0,
        originalAmount: null,
      };

      await executeQuery(
        input.db
          .from("app_users")
          .update({
            current_plan_code: planCode,
            subscription_status: "active",
            plan_started_at: periodStartIso || nowIso,
            plan_expires_at: periodEndIso,
            updated_at: nowIso,
          })
          .eq("id", userId)
          .eq("source", DOMESTIC_SOURCE),
        "激活待生效订阅时更新用户套餐失败",
      );

      await syncQuotaAccount({
        db: input.db,
        userId,
        plan,
        now,
      });

      await executeQuery(
        input.db.from("subscription_change_logs").insert({
          id: createTextId("sub_log"),
          user_id: userId,
          source: DOMESTIC_SOURCE,
          action: "activate",
          from_plan_code: normalizeText(activeRow?.plan_code, "free"),
          to_plan_code: planCode,
          from_period_end: activeRow?.current_period_end || null,
          to_period_end: periodEndIso,
          reason: "domestic_apply_pending_subscription",
          operator_type: "system",
          operator_id: null,
          related_order_id: normalizeText(pendingRow.latest_order_id, "") || null,
          created_at: nowIso,
        }),
        "写入待生效订阅激活日志失败",
      );

      appliedCount += 1;
    } catch (error) {
      errorCount += 1;
      if (input.userId) {
        throw error;
      }
      console.error("[DomesticPayment] apply pending subscription failed:", error);
    }
  }

  return {
    appliedCount,
    errorCount,
  };
}

export async function readDomesticAddonPricing(input: {
  db: RoutedAdminDbClient;
  addonCode: DomesticAddonCode;
}) {
  const [priceRows, addonRows] = await Promise.all([
    queryRows<AddonPackagePriceRow>(
      input.db
        .from("addon_package_prices")
        .select("source,addon_code,currency,amount,is_active")
        .eq("source", DOMESTIC_SOURCE)
        .eq("addon_code", input.addonCode)
        .eq("currency", DOMESTIC_CURRENCY)
        .limit(5),
      "读取国内版加油包价格失败",
    ),
    queryRows<AddonPackageRow>(
      input.db
        .from("addon_packages")
        .select(
          "addon_code,display_name_cn,display_name_en,document_quota,image_quota,video_quota,audio_quota,is_active",
        )
        .eq("addon_code", input.addonCode)
        .limit(2),
      "读取国内版加油包配置失败",
    ),
  ]);

  const activePrice = priceRows.find((item) => item.is_active !== false);
  const activeAddon = addonRows.find((item) => item.is_active !== false) || addonRows[0];

  if (!activePrice || !activeAddon) {
    throw new DomesticPaymentError("未找到可用的国内版加油包配置。", 400);
  }

  return {
    addonCode: input.addonCode,
    currency: DOMESTIC_CURRENCY,
    amount: toSafeAmount(activePrice.amount, 0),
    displayNameCn: normalizeText(activeAddon.display_name_cn, input.addonCode),
    displayNameEn: normalizeText(activeAddon.display_name_en, input.addonCode),
    documentQuota: toSafeInt(activeAddon.document_quota, 0),
    imageQuota: toSafeInt(activeAddon.image_quota, 0),
    videoQuota: toSafeInt(activeAddon.video_quota, 0),
    audioQuota: toSafeInt(activeAddon.audio_quota, 0),
  } satisfies DomesticAddonPricing;
}

function buildOrderName(plan: DomesticPlanPricing) {
  const periodText =
    plan.billingPeriod === "yearly" ? "年度订阅" : "月度订阅";
  return `${plan.displayNameCn} - ${periodText}`;
}

function buildAddonOrderName(addon: DomesticAddonPricing) {
  return `${addon.displayNameCn} - 加油包`;
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
  extraJson?: Record<string, unknown>;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  clientMeta: DomesticClientMeta;
}) {
  const { db, userId, userEmail, plan, extraJson, provider, providerOrderId, clientMeta } = input;
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
        ...(extraJson || {}),
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

export async function createDomesticAddonOrder(input: {
  db: RoutedAdminDbClient;
  userId: string;
  userEmail: string | null;
  addon: DomesticAddonPricing;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  clientMeta: DomesticClientMeta;
}) {
  const { db, userId, userEmail, addon, provider, providerOrderId, clientMeta } = input;
  const nowIso = toDomesticDateTime(new Date());

  const orderId = createTextId("order");
  const orderNo = generateOrderNo();

  await executeQuery(
    db.from("orders").insert({
      id: orderId,
      order_no: orderNo,
      user_id: userId,
      source: DOMESTIC_SOURCE,
      order_type: "addon",
      product_code: addon.addonCode,
      product_name: buildAddonOrderName(addon),
      plan_code: null,
      billing_period: null,
      amount: addon.amount,
      currency: addon.currency,
      original_amount: null,
      discount_amount: 0,
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
        addon_code: addon.addonCode,
        product_type: "addon",
        addon_quotas: {
          document: addon.documentQuota,
          image: addon.imageQuota,
          video: addon.videoQuota,
          audio: addon.audioQuota,
        },
      }),
      created_at: nowIso,
      updated_at: nowIso,
    }),
    "写入加油包订单失败",
  );

  await executeQuery(
    db.from("payment_transactions").insert({
      id: createTextId("paytx"),
      order_id: orderId,
      user_id: userId,
      source: DOMESTIC_SOURCE,
      provider,
      transaction_type: "charge",
      amount: addon.amount,
      currency: addon.currency,
      status: "pending",
      provider_order_id: providerOrderId,
      request_payload_json: stringifyCloudbaseJson({
        addon_code: addon.addonCode,
        user_id: userId,
      }),
      created_at: nowIso,
      updated_at: nowIso,
    }),
    "写入加油包支付流水失败",
  );

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: "payment_initiated",
    eventName: `${provider}_addon_order_created`,
    relatedOrderId: orderId,
    eventValue: addon.amount,
    eventData: {
      provider,
      addon_code: addon.addonCode,
      currency: addon.currency,
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
    action: "activate" | "renew" | "upgrade" | "downgrade";
    fromPlanCode: string;
    periodStartIso: string;
    periodEndIso: string;
    effectiveStatus: "active" | "pending";
    effectiveAtIso: string;
    visiblePlanExpiresAtIso: string;
    shouldSyncQuotaNow: boolean;
  };

  const rows = await queryRows<UserSubscriptionRow>(
    input.db
      .from("user_subscriptions")
      .select(
        "id,user_id,plan_code,billing_period,status,latest_order_id,current_period_start,current_period_end,created_at",
      )
      .eq("user_id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(20),
    "��取用户订阅失败",
  );

  const latestActiveRow = [...rows]
    .filter((row) => normalizeSubscriptionStatus(row.status) !== "pending")
    .sort((left, right) =>
      compareByDateDesc(left.current_period_end, right.current_period_end),
    )[0];

  const fromPlanCode = normalizeText(latestActiveRow?.plan_code, "free") as string;
  const nowMs = new Date(input.nowIso).getTime();
  const currentPeriodEndIso = normalizeText(latestActiveRow?.current_period_end, "");
  const currentPeriodEndMs = currentPeriodEndIso
    ? new Date(currentPeriodEndIso).getTime()
    : 0;
  const currentStillActive = currentPeriodEndMs > nowMs;
  const samePlanRenew = currentStillActive && fromPlanCode === input.planCode;
  const purchasedDurationDays = Math.max(
    1,
    Math.ceil(
      Math.max(
        0,
        new Date(input.planExpiresAtIso).getTime() - new Date(input.nowIso).getTime(),
      ) /
        (1000 * 60 * 60 * 24),
    ) || getDomesticDurationDays(input.billingPeriod),
  );

  let currentPlanLevel = 0;
  let targetPlanLevel = 0;

  if (currentStillActive && fromPlanCode !== "free") {
    const [currentPlan, targetPlan] = await Promise.all([
      readDomesticPlanDefinition({
        db: input.db,
        planCode: fromPlanCode as DomesticPlanCode,
      }),
      readDomesticPlanDefinition({
        db: input.db,
        planCode: input.planCode,
      }),
    ]);
    currentPlanLevel = currentPlan.planLevel;
    targetPlanLevel = targetPlan.planLevel;
  }

  const isDowngrade =
    currentStillActive &&
    currentPlanLevel > 0 &&
    targetPlanLevel > 0 &&
    targetPlanLevel < currentPlanLevel;

  let action: SubscriptionApplyResult["action"] = "activate";
  let periodStartIso = input.nowIso;
  let periodEndIso = input.planExpiresAtIso;
  let effectiveStatus: SubscriptionApplyResult["effectiveStatus"] = "active";
  let effectiveAtIso = input.nowIso;
  let visiblePlanExpiresAtIso = input.planExpiresAtIso;
  let shouldSyncQuotaNow = true;

  if (samePlanRenew) {
    action = "renew";
    periodStartIso = currentPeriodEndIso;
    periodEndIso = toDomesticDateTime(
      addDays(new Date(currentPeriodEndIso), purchasedDurationDays),
    );
    effectiveAtIso = periodStartIso;
    visiblePlanExpiresAtIso = periodEndIso;
    // 同套餐提前续费仅延长到期时间，不应立即重置当期额度。
    shouldSyncQuotaNow = false;
  } else if (
    currentStillActive &&
    currentPlanLevel > 0 &&
    targetPlanLevel > currentPlanLevel
  ) {
    action = "upgrade";
  } else if (isDowngrade) {
    action = "downgrade";
    periodStartIso = currentPeriodEndIso;
    periodEndIso = toDomesticDateTime(
      addDays(new Date(currentPeriodEndIso), purchasedDurationDays),
    );
    effectiveStatus = "pending";
    effectiveAtIso = currentPeriodEndIso;
    visiblePlanExpiresAtIso = currentPeriodEndIso;
    shouldSyncQuotaNow = false;
  }

  if (effectiveStatus === "pending") {
    // BUG FIX #1: 支持多重降级队列，按等级排序
    const existingPendingSubs = rows
      .filter((row) => normalizeSubscriptionStatus(row.status) === "pending")
      .map((row) => ({
        id: normalizeText(row.id, ""),
        planCode: normalizeText(row.plan_code, ""),
        periodStart: normalizeText(row.current_period_start, ""),
        periodEnd: normalizeText(row.current_period_end, ""),
        createdAt: normalizeText(row.created_at, input.nowIso),
      }))
      .filter((sub) => Boolean(sub.id));

    // 获取所有套餐等级
    const planLevels = new Map<string, number>();
    for (const sub of existingPendingSubs) {
      if (!planLevels.has(sub.planCode)) {
        try {
          const plan = await readDomesticPlanDefinition({
            db: input.db,
            planCode: sub.planCode as DomesticPlanCode,
          });
          planLevels.set(sub.planCode, plan.planLevel);
        } catch {
          planLevels.set(sub.planCode, 0);
        }
      }
    }
    planLevels.set(input.planCode, targetPlanLevel);

    // 构建完整的降级队列（包括新购买的）
    const allPendingSubs = [
      ...existingPendingSubs.map((sub) => ({
        ...sub,
        planLevel: planLevels.get(sub.planCode) || 0,
      })),
      {
        id: "",
        planCode: input.planCode,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        createdAt: input.nowIso,
        planLevel: targetPlanLevel,
      },
    ].sort((a, b) => {
      // 先按等级降序（高级先生效）
      if (b.planLevel !== a.planLevel) return b.planLevel - a.planLevel;
      // 同等级按创建时间升序（先买的先生效）
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // 重新计算每个订阅的生效时间
    let nextStartDate = currentPeriodEndIso;
    for (let i = 0; i < allPendingSubs.length; i++) {
      const sub = allPendingSubs[i];
      const subDurationDays = Math.ceil(
        (new Date(sub.periodEnd).getTime() - new Date(sub.periodStart).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const newPeriodEnd = toDomesticDateTime(addDays(new Date(nextStartDate), subDurationDays));

      if (sub.id) {
        // 更新现有订阅
        await executeQuery(
          input.db
            .from("user_subscriptions")
            .update({
              current_period_start: nextStartDate,
              current_period_end: newPeriodEnd,
              updated_at: input.nowIso,
            })
            .eq("id", sub.id),
          "更新降级队列订阅时间失败",
        );
      } else {
        // 创建新订阅
        await executeQuery(
          input.db.from("user_subscriptions").insert({
            id: createTextId("sub"),
            user_id: input.userId,
            source: DOMESTIC_SOURCE,
            plan_code: input.planCode,
            billing_period: input.billingPeriod,
            status: "pending",
            provider: input.provider,
            provider_subscription_id: input.providerOrderId,
            latest_order_id: input.orderId,
            start_at: input.nowIso,
            current_period_start: nextStartDate,
            current_period_end: newPeriodEnd,
            cancel_at_period_end: false,
            updated_at: input.nowIso,
            metadata_json: stringifyCloudbaseJson({
              last_paid_order_id: input.orderId,
              source: DOMESTIC_SOURCE,
              schedule_mode: "at_period_end",
            }),
            created_at: input.nowIso,
          }),
          "创建待生效订阅失败",
        );
      }

      nextStartDate = newPeriodEnd;
    }
  } else if (latestActiveRow?.id) {
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
        .eq("id", latestActiveRow.id),
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

  if (effectiveStatus === "active") {
    // BUG FIX #2: 升级时只清理低等级的 pending 订阅，保留高等级的并重新计算时间
    const pendingSubs = rows
      .filter((row) => normalizeSubscriptionStatus(row.status) === "pending")
      .map((row) => ({
        id: normalizeText(row.id, ""),
        planCode: normalizeText(row.plan_code, ""),
        billingPeriod: normalizeText(row.billing_period, ""),
        periodStart: normalizeText(row.current_period_start, ""),
        periodEnd: normalizeText(row.current_period_end, ""),
      }))
      .filter((sub) => Boolean(sub.id));

    const toDeleteIds: string[] = [];
    const toKeepSubs: Array<{ id: string; planCode: string; billingPeriod: string }> = [];

    for (const pendingSub of pendingSubs) {
      try {
        const pendingPlan = await readDomesticPlanDefinition({
          db: input.db,
          planCode: pendingSub.planCode as DomesticPlanCode,
        });
        const pendingPlanLevel = pendingPlan.planLevel;

        if (pendingPlanLevel <= targetPlanLevel) {
          // 等级低于或等于当前购买的订阅，删除
          toDeleteIds.push(pendingSub.id);
        } else {
          // 等级高于当前购买的订阅，保留但需要重新计算时间
          toKeepSubs.push({
            id: pendingSub.id,
            planCode: pendingSub.planCode,
            billingPeriod: pendingSub.billingPeriod,
          });
        }
      } catch {
        // 如果无法读取套餐定义，默认删除
        toDeleteIds.push(pendingSub.id);
      }
    }

    // 删除低等级的 pending 订阅
    for (const pendingId of toDeleteIds) {
      await executeQuery(
        input.db
          .from("user_subscriptions")
          .update({
            status: "canceled",
            canceled_at: input.nowIso,
            updated_at: input.nowIso,
          })
          .eq("id", pendingId),
        "清理低等级待生效订阅失败",
      );
    }

    // 更新保留的高等级 pending 订阅的生效时间
    let nextStart = periodEndIso;
    for (const keepSub of toKeepSubs) {
      const subDurationDays = getDomesticDurationDays(
        keepSub.billingPeriod as DomesticBillingPeriod
      );
      const newPeriodEnd = toDomesticDateTime(addDays(new Date(nextStart), subDurationDays));

      await executeQuery(
        input.db
          .from("user_subscriptions")
          .update({
            current_period_start: nextStart,
            current_period_end: newPeriodEnd,
            updated_at: input.nowIso,
          })
          .eq("id", keepSub.id),
        "更新保留的高等级订阅时间失败",
      );

      nextStart = newPeriodEnd;
    }
  }

  await executeQuery(
    input.db.from("subscription_change_logs").insert({
      id: createTextId("sub_log"),
      user_id: input.userId,
      source: DOMESTIC_SOURCE,
      action,
      from_plan_code: fromPlanCode,
      to_plan_code: input.planCode,
      from_period_end: latestActiveRow?.current_period_end || null,
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
    effectiveStatus,
    effectiveAtIso,
    visiblePlanExpiresAtIso,
    shouldSyncQuotaNow,
  } as SubscriptionApplyResult;
}

async function syncQuotaAccount(input: {
  db: RoutedAdminDbClient;
  userId: string;
  plan: QuotaSeedDefinition;
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
      .select("id,quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
      .eq("quota_account_id", quotaAccountId)
      .limit(20),
    "读取额度余额失败",
  );

  const balanceMap = new Map<string, UserQuotaBalanceRow>();
  for (const row of existingBalanceRows) {
    const quotaType = normalizeText(row.quota_type, "");
    if (!quotaType) {
      continue;
    }
    balanceMap.set(quotaType, row);
  }

  const quotaDefinitions: Array<{ type: string; limit: number }> = [
    { type: "document", limit: input.plan.monthlyDocumentLimit },
    { type: "image", limit: input.plan.monthlyImageLimit },
    { type: "video", limit: input.plan.monthlyVideoLimit },
    { type: "audio", limit: input.plan.monthlyAudioLimit },
  ];

  for (const definition of quotaDefinitions) {
    const existingRow = balanceMap.get(definition.type);
    const existingId = normalizeText(existingRow?.id, "");

    if (existingId) {
      const currentBaseLimit = toSafeInt(existingRow?.base_limit, 0);
      const currentAddonLimit = toSafeInt(existingRow?.addon_limit, 0);
      const currentAdminAdjustment = toSafeInt(existingRow?.admin_adjustment, 0);
      const currentUsedAmount = toSafeInt(existingRow?.used_amount, 0);
      const currentTotalLimit = Math.max(
        0,
        currentBaseLimit + currentAddonLimit + currentAdminAdjustment,
      );
      const currentRemainingAmount =
        existingRow?.remaining_amount === null || existingRow?.remaining_amount === undefined
          ? Math.max(0, currentTotalLimit - currentUsedAmount)
          : toSafeInt(
              existingRow.remaining_amount,
              Math.max(0, currentTotalLimit - currentUsedAmount),
            );
      const currentBaseCapacity = Math.max(0, currentBaseLimit + currentAdminAdjustment);
      const overflowUsed = Math.max(0, currentUsedAmount - currentBaseCapacity);
      const addonCarryover = Math.min(
        currentRemainingAmount,
        Math.max(0, currentAddonLimit - overflowUsed),
      );
      const nextRemainingAmount = Math.max(
        0,
        definition.limit + addonCarryover + currentAdminAdjustment,
      );

      await executeQuery(
        input.db
          .from("user_quota_balances")
          .update({
            base_limit: definition.limit,
            addon_limit: addonCarryover,
            admin_adjustment: currentAdminAdjustment,
            used_amount: 0,
            remaining_amount: nextRemainingAmount,
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
          .select("id,quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
          .eq("quota_account_id", quotaAccountId)
          .eq("quota_type", definition.type)
          .limit(1),
        "读取并发创建后的额度余额失败",
      );

      const concurrentBalanceId = normalizeText(concurrentBalanceRows[0]?.id, "");
      if (!concurrentBalanceId) {
        throw error;
      }

      const concurrentRow = concurrentBalanceRows[0];
      const currentBaseLimit = toSafeInt(concurrentRow?.base_limit, 0);
      const currentAddonLimit = toSafeInt(concurrentRow?.addon_limit, 0);
      const currentAdminAdjustment = toSafeInt(concurrentRow?.admin_adjustment, 0);
      const currentUsedAmount = toSafeInt(concurrentRow?.used_amount, 0);
      const currentTotalLimit = Math.max(
        0,
        currentBaseLimit + currentAddonLimit + currentAdminAdjustment,
      );
      const currentRemainingAmount =
        concurrentRow?.remaining_amount === null || concurrentRow?.remaining_amount === undefined
          ? Math.max(0, currentTotalLimit - currentUsedAmount)
          : toSafeInt(
              concurrentRow.remaining_amount,
              Math.max(0, currentTotalLimit - currentUsedAmount),
            );
      const currentBaseCapacity = Math.max(0, currentBaseLimit + currentAdminAdjustment);
      const overflowUsed = Math.max(0, currentUsedAmount - currentBaseCapacity);
      const addonCarryover = Math.min(
        currentRemainingAmount,
        Math.max(0, currentAddonLimit - overflowUsed),
      );
      const nextRemainingAmount = Math.max(
        0,
        definition.limit + addonCarryover + currentAdminAdjustment,
      );

      await executeQuery(
        input.db
          .from("user_quota_balances")
          .update({
            base_limit: definition.limit,
            addon_limit: addonCarryover,
            admin_adjustment: currentAdminAdjustment,
            used_amount: 0,
            remaining_amount: nextRemainingAmount,
            updated_at: nowIso,
          })
          .eq("id", concurrentBalanceId),
        "更新并发创建后的额度余额失败",
      );
    }
  }
}

async function ensureAddonQuotaBalances(input: {
  db: RoutedAdminDbClient;
  userId: string;
  now: Date;
}) {
  const nowIso = toDomesticDateTime(input.now);
  const resetAt = addDays(input.now, 30);
  const cycleStartDate = formatDateOnly(input.now);
  const cycleEndDate = formatDateOnly(resetAt);
  const seedPlan = await readCurrentDomesticQuotaSeed({
    db: input.db,
    userId: input.userId,
  });

  const accountRows = await queryRows<UserQuotaAccountRow>(
    input.db
      .from("user_quota_accounts")
      .select("id,status,cycle_end_date")
      .eq("user_id", input.userId)
      .eq("source", DOMESTIC_SOURCE)
      .limit(20),
    "读取加油包额度账户失败",
  );

  const activeAccount = [...accountRows]
    .filter((item) => normalizeText(item.status, "") === "active")
    .sort((left, right) => compareByDateDesc(left.cycle_end_date, right.cycle_end_date))[0];

  let quotaAccountId = normalizeText(activeAccount?.id, "") || createTextId("quota_account");
  if (!activeAccount?.id) {
    try {
      await executeQuery(
        input.db.from("user_quota_accounts").insert({
          id: quotaAccountId,
          user_id: input.userId,
          source: DOMESTIC_SOURCE,
          plan_code: seedPlan.planCode,
          status: "active",
          cycle_type: "monthly",
          cycle_start_date: cycleStartDate,
          cycle_end_date: cycleEndDate,
          next_reset_at: toDomesticDateTime(resetAt),
          created_at: nowIso,
          updated_at: nowIso,
        }),
        "创建加油包额度账户失败",
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      const concurrentRows = await queryRows<UserQuotaAccountRow>(
        input.db
          .from("user_quota_accounts")
          .select("id,status,cycle_end_date")
          .eq("user_id", input.userId)
          .eq("source", DOMESTIC_SOURCE)
          .limit(20),
        "读取并发创建后的加油包额度账户失败",
      );

      quotaAccountId =
        [...concurrentRows]
          .map((row) => normalizeText(row.id, ""))
          .find((id) => Boolean(id)) || quotaAccountId;
    }
  }

  const existingBalanceRows = await queryRows<UserQuotaBalanceRow>(
    input.db
      .from("user_quota_balances")
      .select("id,quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
      .eq("quota_account_id", quotaAccountId)
      .limit(20),
    "读取加油包额度余额失败",
  );

  const balanceMap = new Map<string, UserQuotaBalanceRow>();
  for (const row of existingBalanceRows) {
    const quotaType = normalizeText(row.quota_type, "");
    if (!quotaType) {
      continue;
    }
    balanceMap.set(quotaType, row);
  }

  const quotaDefinitions: Array<{ type: string; limit: number }> = [
    { type: "document", limit: seedPlan.monthlyDocumentLimit },
    { type: "image", limit: seedPlan.monthlyImageLimit },
    { type: "video", limit: seedPlan.monthlyVideoLimit },
    { type: "audio", limit: seedPlan.monthlyAudioLimit },
  ];

  for (const definition of quotaDefinitions) {
    if (balanceMap.has(definition.type)) {
      continue;
    }

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
      "补齐加油包额度余额失败",
    );
  }

  return queryRows<UserQuotaBalanceRow>(
    input.db
      .from("user_quota_balances")
      .select("id,quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
      .eq("quota_account_id", quotaAccountId)
      .limit(20),
    "读取补齐后的加油包额度余额失败",
  );
}

export async function ensureDomesticUserQuotaState(input: {
  db: RoutedAdminDbClient;
  userId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const nowIso = toDomesticDateTime(now);
  const nowMs = now.getTime();

  await applyDueDomesticPendingSubscriptions({
    db: input.db,
    userId: input.userId,
    now,
    limit: 5,
  });

  const [userRows, subscriptionRows, quotaAccountRows] = await Promise.all([
    queryRows<AppUserRow>(
      input.db
        .from("app_users")
        .select("id,current_plan_code,subscription_status,plan_expires_at")
        .eq("id", input.userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(1),
      "读取用户套餐状态失败",
    ),
    queryRows<UserSubscriptionRow>(
      input.db
        .from("user_subscriptions")
        .select("id,plan_code,status,current_period_end")
        .eq("user_id", input.userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(20),
      "读取用户订阅记录失败",
    ),
    queryRows<UserQuotaAccountRow>(
      input.db
        .from("user_quota_accounts")
        .select("id,plan_code,status,cycle_start_date,cycle_end_date,next_reset_at")
        .eq("user_id", input.userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(20),
      "读取用户额度账户失败",
    ),
  ]);

  const userRow = userRows[0];
  const rawPlanCode = normalizeText(userRow?.current_plan_code, "free").toLowerCase();
  const subscriptionStatus = normalizeText(userRow?.subscription_status, "inactive").toLowerCase();
  const planExpiresAt = normalizeText(userRow?.plan_expires_at, "");
  const planExpiresMs = planExpiresAt ? new Date(planExpiresAt).getTime() : 0;
  const hasActivePaidPlan =
    (rawPlanCode === "pro" || rawPlanCode === "enterprise") && planExpiresMs > nowMs;
  const effectivePlanCode = hasActivePaidPlan ? rawPlanCode : "free";
  const shouldUpdateUserPlanState =
    (hasActivePaidPlan && !["active", "trialing"].includes(subscriptionStatus)) ||
    (!hasActivePaidPlan &&
      (rawPlanCode !== "free" ||
        subscriptionStatus !== "inactive" ||
        Boolean(planExpiresAt)));

  if (shouldUpdateUserPlanState) {
    await executeQuery(
      input.db
        .from("app_users")
        .update({
          current_plan_code: effectivePlanCode,
          subscription_status: hasActivePaidPlan ? "active" : "inactive",
          plan_expires_at: hasActivePaidPlan ? planExpiresAt : null,
          updated_at: nowIso,
        })
        .eq("id", input.userId)
        .eq("source", DOMESTIC_SOURCE),
      "同步用户套餐状态失败",
    );
  }

  for (const subscriptionRow of subscriptionRows) {
    const subscriptionId = normalizeText(subscriptionRow.id, "");
    const subscriptionStatusValue = normalizeSubscriptionStatus(subscriptionRow.status);
    const periodEndIso = normalizeText(subscriptionRow.current_period_end, "");
    const periodEndMs = periodEndIso ? new Date(periodEndIso).getTime() : 0;

    if (
      !subscriptionId ||
      subscriptionStatusValue === "pending" ||
      subscriptionStatusValue === "expired" ||
      subscriptionStatusValue === "canceled" ||
      !Number.isFinite(periodEndMs) ||
      periodEndMs > nowMs
    ) {
      continue;
    }

    await executeQuery(
      input.db
        .from("user_subscriptions")
        .update({
          status: "expired",
          updated_at: nowIso,
        })
        .eq("id", subscriptionId),
      "同步已过期订阅状态失败",
    );
  }

  const activeQuotaAccounts = [...quotaAccountRows]
    .filter((item) => normalizeText(item.status, "") === "active")
    .sort((left, right) => compareByDateDesc(left.cycle_end_date, right.cycle_end_date));
  const activeQuotaAccount = activeQuotaAccounts[0];
  const activeQuotaPlanCode = normalizeText(activeQuotaAccount?.plan_code, "free").toLowerCase();
  const nextResetAtMs = activeQuotaAccount?.next_reset_at
    ? new Date(activeQuotaAccount.next_reset_at).getTime()
    : 0;
  const cycleEndMs = activeQuotaAccount?.cycle_end_date
    ? new Date(activeQuotaAccount.cycle_end_date).getTime()
    : 0;
  const shouldResetQuotaAccount =
    !activeQuotaAccount?.id ||
    activeQuotaAccounts.length !== 1 ||
    activeQuotaPlanCode !== effectivePlanCode ||
    (Number.isFinite(nextResetAtMs) && nextResetAtMs > 0
      ? nextResetAtMs <= nowMs
      : Number.isFinite(cycleEndMs) && cycleEndMs > 0
        ? cycleEndMs <= nowMs
        : false);

  if (shouldResetQuotaAccount) {
    const seedPlan = await readQuotaSeedDefinitionByCode({
      db: input.db,
      planCode: effectivePlanCode,
    });

    await syncQuotaAccount({
      db: input.db,
      userId: input.userId,
      plan: seedPlan,
      now,
    });
  }

  await ensureAddonQuotaBalances({
    db: input.db,
    userId: input.userId,
    now,
  });
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
    const effectiveStatus =
      normalizeText(rawExtraJson.subscription_effective_status, "active") === "pending"
        ? "pending"
        : "active";
    const visiblePlanExpiresAt =
      normalizeText(rawExtraJson.subscription_visible_plan_expires_at, "") ||
      normalizeText(rawExtraJson.subscription_period_end, "") ||
      null;
    return {
      alreadyPaid: true,
      planCode,
      planExpiresAt: visiblePlanExpiresAt,
      paidAt,
      effectiveStatus,
      effectiveAt: normalizeText(rawExtraJson.subscription_effective_at, "") || null,
    };
  }

  const now = new Date();
  const nowIso = toDomesticDateTime(now);
  const paidAtIso =
    paymentStatus === "paid" && normalizeText(input.order.paid_at, "")
      ? normalizeText(input.order.paid_at, "")
      : nowIso;
  const configuredDurationDays = toSafeInt(rawExtraJson.subscription_duration_days, 0);
  const effectiveDurationDays =
    configuredDurationDays > 0
      ? configuredDurationDays
      : getDomesticDurationDays(billingPeriod);
  const defaultPlanExpiresAt = addDays(now, effectiveDurationDays);
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
    const orderSubscriptionRows = await queryRows<UserSubscriptionRow>(
      input.db
        .from("user_subscriptions")
        .select(
          "id,user_id,plan_code,billing_period,status,latest_order_id,current_period_start,current_period_end",
        )
        .eq("user_id", userId)
        .eq("source", DOMESTIC_SOURCE)
        .limit(20),
      "读取订阅幂等状态失败",
    );
    const matchedSubscriptionRow =
      orderSubscriptionRows.find(
        (row) => normalizeText(row.latest_order_id, "") === orderId,
      ) ||
      orderSubscriptionRows.find(
        (row) =>
          resolveDomesticPlanCode(row.plan_code) ===
            (resolveDomesticPlanCode(existedApplyLog.to_plan_code) || planCode) &&
          normalizeText(row.current_period_end, "") ===
            normalizeText(existedApplyLog.to_period_end, ""),
      ) ||
      null;
    const activeSubscriptionRow = [...orderSubscriptionRows]
      .filter((row) => normalizeSubscriptionStatus(row.status) !== "pending")
      .sort((left, right) =>
        compareByDateDesc(left.current_period_end, right.current_period_end),
      )[0];
    const stablePlanCode =
      resolveDomesticPlanCode(existedApplyLog.to_plan_code) || planCode;
    const stablePeriodEnd =
      normalizeText(matchedSubscriptionRow?.current_period_end, "") ||
      normalizeText(existedApplyLog.to_period_end, "") ||
      defaultPlanExpiresAtIso;
    const stableAction =
      normalizeText(existedApplyLog.action, "") || "activate";
    const effectiveStatus =
      normalizeSubscriptionStatus(matchedSubscriptionRow?.status) === "pending"
        ? "pending"
        : "active";
    const effectiveAtIso =
      normalizeText(matchedSubscriptionRow?.current_period_start, "") ||
      (effectiveStatus === "pending"
        ? normalizeText(activeSubscriptionRow?.current_period_end, "") || nowIso
        : nowIso);
    const visiblePlanExpiresAtIso =
      effectiveStatus === "pending"
        ? normalizeText(activeSubscriptionRow?.current_period_end, "") || effectiveAtIso
        : stablePeriodEnd;
    const shouldSyncQuotaNow =
      effectiveStatus === "active" && stableAction !== "renew";

    if (effectiveStatus === "active") {
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
            subscription_effective_status: effectiveStatus,
            subscription_effective_at: effectiveAtIso,
            subscription_period_end: stablePeriodEnd,
            subscription_visible_plan_expires_at: visiblePlanExpiresAtIso,
          }),
        })
        .eq("id", orderId),
      "补写订单订阅应用标记失败",
    );

    return {
      alreadyPaid: true,
      planCode: stablePlanCode,
      planExpiresAt: visiblePlanExpiresAtIso,
      paidAt: paidAtIso,
      effectiveStatus,
      effectiveAt: effectiveAtIso,
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

  if (subscriptionResult.effectiveStatus === "active") {
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
            subscription_effective_status: subscriptionResult.effectiveStatus,
            subscription_effective_at: subscriptionResult.effectiveAtIso,
            subscription_period_start: subscriptionResult.periodStartIso,
            subscription_period_end: subscriptionResult.periodEndIso,
            subscription_visible_plan_expires_at:
              subscriptionResult.visiblePlanExpiresAtIso,
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
        : subscriptionResult.action === "downgrade"
          ? "subscription_downgrade_scheduled"
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
      effective_status: subscriptionResult.effectiveStatus,
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
    planExpiresAt: subscriptionResult.visiblePlanExpiresAtIso,
    paidAt: paidAtIso,
    effectiveStatus: subscriptionResult.effectiveStatus,
    effectiveAt: subscriptionResult.effectiveAtIso,
  };
}

export async function settleDomesticAddonPayment(input: {
  db: RoutedAdminDbClient;
  order: DomesticOrderRow;
  provider: DomesticPaymentProvider;
  providerOrderId: string;
  providerTransactionId?: string | null;
  providerPayload?: unknown;
}) {
  const orderId = normalizeText(input.order.id, "");
  const userId = normalizeText(input.order.user_id, "");
  const rawExtraJson = parseJsonRecord(input.order.extra_json);
  const addonCode =
    resolveDomesticAddonCode(input.order.product_code) ||
    resolveDomesticAddonCode(rawExtraJson.addon_code);

  if (!orderId || !userId || !addonCode) {
    throw new DomesticPaymentError("加油包订单缺少必要字段，无法确认支付。", 400);
  }

  const paymentStatus = normalizeText(input.order.payment_status, "pending").toLowerCase();
  const hasAppliedMarker = rawExtraJson.addon_applied === true;
  const paidAtIso =
    paymentStatus === "paid" && normalizeText(input.order.paid_at, "")
      ? normalizeText(input.order.paid_at, "")
      : toDomesticDateTime(new Date());

  const addon = await readDomesticAddonPricing({
    db: input.db,
    addonCode,
  });
  const grants: Array<{ type: string; amount: number }> = [
    { type: "document", amount: addon.documentQuota },
    { type: "image", amount: addon.imageQuota },
    { type: "video", amount: addon.videoQuota },
    { type: "audio", amount: addon.audioQuota },
  ];
  const expectedGrantTypes = grants
    .filter((grant) => grant.amount > 0)
    .map((grant) => grant.type);

  const readPurchaseRow = async () =>
    (
      await queryRows<UserAddonPurchaseRow>(
        input.db
          .from("user_addon_purchases")
          .select("id,addon_code,status,granted_at,updated_at")
          .eq("order_id", orderId)
          .limit(2),
        "读取加油包购买记录失败",
      )
    )[0] || null;

  const writeAddonAppliedMarker = async (grantedAtIso: string) => {
    await executeQuery(
      input.db
        .from("orders")
        .update({
          updated_at: grantedAtIso,
          extra_json: stringifyCloudbaseJson({
            ...rawExtraJson,
            addon_code: addonCode,
            provider_payload: input.providerPayload || null,
            addon_applied: true,
            addon_applied_at: grantedAtIso,
            addon_grants: {
              document: addon.documentQuota,
              image: addon.imageQuota,
              video: addon.videoQuota,
              audio: addon.audioQuota,
            },
          }),
        })
        .eq("id", orderId),
      "写入加油包到账标记失败",
    );
  };

  const markPurchasePaid = async (purchaseId: string, grantedAtIso: string) => {
    await executeQuery(
      input.db
        .from("user_addon_purchases")
        .update({
          addon_code: addonCode,
          status: "paid",
          granted_at: grantedAtIso,
          expires_at: null,
          updated_at: grantedAtIso,
        })
        .eq("id", purchaseId),
      "更新加油包购买记录失败",
    );
  };

  if (paymentStatus === "paid" && hasAppliedMarker) {
    return {
      alreadyPaid: true,
      addonCode,
      grantedAt: normalizeText(input.order.paid_at, "") || paidAtIso,
    };
  }

  await executeQuery(
    input.db
      .from("orders")
      .update({
        payment_status: "paid",
        paid_at: paidAtIso,
        provider_transaction_id: input.providerTransactionId || null,
        updated_at: paidAtIso,
        notes: null,
        extra_json: stringifyCloudbaseJson({
          ...rawExtraJson,
          provider_payload: input.providerPayload || null,
        }),
      })
      .eq("id", orderId),
    "更新加油包订单支付状态失败",
  );

  const txRows = await queryRows<PaymentTxRow>(
    input.db
      .from("payment_transactions")
      .select("id,order_id,provider,provider_order_id")
      .eq("order_id", orderId)
      .eq("provider", input.provider)
      .eq("provider_order_id", input.providerOrderId)
      .limit(5),
    "读取加油包支付流水失败",
  );

  if (txRows[0]?.id) {
    await executeQuery(
      input.db
        .from("payment_transactions")
        .update({
          status: "success",
          provider_transaction_id: input.providerTransactionId || null,
          response_payload_json: stringifyCloudbaseJson(input.providerPayload || null),
          processed_at: paidAtIso,
          updated_at: paidAtIso,
        })
        .eq("id", txRows[0].id),
      "更新加油包支付流水失败",
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
        amount: toSafeAmount(input.order.amount, addon.amount),
        currency: DOMESTIC_CURRENCY,
        status: "success",
        provider_order_id: input.providerOrderId,
        provider_transaction_id: input.providerTransactionId || null,
        response_payload_json: stringifyCloudbaseJson(input.providerPayload || null),
        processed_at: paidAtIso,
        created_at: paidAtIso,
        updated_at: paidAtIso,
      }),
      "创建加油包支付流水失败",
    );
  }

  let purchaseRow = await readPurchaseRow();
  if (normalizeText(purchaseRow?.status, "").toLowerCase() === "paid") {
    const grantedAt = normalizeText(purchaseRow?.granted_at, "") || paidAtIso;
    await writeAddonAppliedMarker(grantedAt);
    return {
      alreadyPaid: true,
      addonCode,
      grantedAt,
    };
  }

  let createdPendingPurchase = false;
  if (!purchaseRow?.id) {
    try {
      await executeQuery(
        input.db.from("user_addon_purchases").insert({
          id: createTextId("addon_purchase"),
          user_id: userId,
          source: DOMESTIC_SOURCE,
          addon_code: addonCode,
          order_id: orderId,
          status: "pending",
          granted_at: null,
          expires_at: null,
          created_at: paidAtIso,
          updated_at: paidAtIso,
        }),
        "创建加油包购买记录失败",
      );
      createdPendingPurchase = true;
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    purchaseRow = await readPurchaseRow();
  }

  if (!purchaseRow?.id) {
    throw new DomesticPaymentError("加油包购买记录不存在，无法确认支付。", 503);
  }
  const purchaseId = normalizeText(purchaseRow.id, "");
  if (!purchaseId) {
    throw new DomesticPaymentError("加油包购买记录缺少主键，无法确认支付。", 503);
  }

  if (!createdPendingPurchase) {
    for (let attempt = 0; attempt < ADDON_SETTLEMENT_POLL_ATTEMPTS; attempt += 1) {
      if (normalizeText(purchaseRow?.status, "").toLowerCase() === "paid") {
        const grantedAt = normalizeText(purchaseRow?.granted_at, "") || paidAtIso;
        await writeAddonAppliedMarker(grantedAt);
        return {
          alreadyPaid: true,
          addonCode,
          grantedAt,
        };
      }

      await sleep(ADDON_SETTLEMENT_POLL_MS);
      purchaseRow = await readPurchaseRow();
      if (!purchaseRow?.id) {
        break;
      }
    }
  }

  if (normalizeText(purchaseRow?.status, "").toLowerCase() === "paid") {
    const grantedAt = normalizeText(purchaseRow?.granted_at, "") || paidAtIso;
    await writeAddonAppliedMarker(grantedAt);
    return {
      alreadyPaid: true,
      addonCode,
      grantedAt,
    };
  }

  const appliedGrantRows = await queryRows<{ quota_type?: string | null }>(
    input.db
      .from("user_quota_change_logs")
      .select("quota_type")
      .eq("user_id", userId)
      .eq("source", DOMESTIC_SOURCE)
      .eq("reference_type", "addon_purchase")
      .eq("reference_id", orderId)
      .eq("change_kind", "addon_grant")
      .limit(10),
    "读取加油包额度日志失败",
  );
  const appliedGrantTypes = new Set(
    appliedGrantRows
      .map((row) => normalizeText(row.quota_type, ""))
      .filter((quotaType) => Boolean(quotaType)),
  );

  if (
    expectedGrantTypes.length > 0 &&
    expectedGrantTypes.every((quotaType) => appliedGrantTypes.has(quotaType))
  ) {
    const grantedAt = normalizeText(purchaseRow?.granted_at, "") || paidAtIso;
    await markPurchasePaid(purchaseId, grantedAt);
    await writeAddonAppliedMarker(grantedAt);
    return {
      alreadyPaid: true,
      addonCode,
      grantedAt,
    };
  }

  const balanceRows = await ensureAddonQuotaBalances({
    db: input.db,
    userId,
    now: new Date(paidAtIso),
  });

  const balanceMap = new Map<string, UserQuotaBalanceRow>();
  for (const row of balanceRows) {
    const quotaType = normalizeText(row.quota_type, "");
    if (!quotaType) {
      continue;
    }
    balanceMap.set(quotaType, row);
  }

  for (const grant of grants) {
    if (grant.amount <= 0 || appliedGrantTypes.has(grant.type)) {
      continue;
    }

    const balance = balanceMap.get(grant.type);
    const balanceId = normalizeText(balance?.id, "");
    if (!balanceId) {
      throw new DomesticPaymentError(`加油包额度余额缺失: ${grant.type}`, 503);
    }

    const currentBaseLimit = toSafeInt(balance?.base_limit, 0);
    const currentAddonLimit = toSafeInt(balance?.addon_limit, 0);
    const currentAdminAdjustment = toSafeInt(balance?.admin_adjustment, 0);
    const currentUsedAmount = toSafeInt(balance?.used_amount, 0);
    const currentTotalLimit = Math.max(
      0,
      currentBaseLimit + currentAddonLimit + currentAdminAdjustment,
    );
    const currentRemaining =
      balance?.remaining_amount === null || balance?.remaining_amount === undefined
        ? Math.max(0, currentTotalLimit - currentUsedAmount)
        : toSafeInt(
            balance.remaining_amount,
            Math.max(0, currentTotalLimit - currentUsedAmount),
          );
    const nextAddonLimit = currentAddonLimit + grant.amount;
    const nextRemaining = currentRemaining + grant.amount;

    await executeQuery(
      input.db
        .from("user_quota_balances")
        .update({
          addon_limit: nextAddonLimit,
          remaining_amount: nextRemaining,
          updated_at: paidAtIso,
        })
        .eq("id", balanceId),
      "更新加油包额度余额失败",
    );

    await executeQuery(
      input.db.from("user_quota_change_logs").insert({
        id: createTextId("quota_log"),
        user_id: userId,
        source: DOMESTIC_SOURCE,
        quota_type: grant.type,
        change_kind: "addon_grant",
        delta_amount: grant.amount,
        before_amount: currentRemaining,
        after_amount: nextRemaining,
        reference_type: "addon_purchase",
        reference_id: orderId,
        operator_type: "webhook",
        operator_id: null,
        note: `addon_${addonCode}_${grant.type}`,
        created_at: paidAtIso,
      }),
      "写入加油包额度变更日志失败",
    );
  }

  await markPurchasePaid(purchaseId, paidAtIso);
  await writeAddonAppliedMarker(paidAtIso);

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: "payment_success",
    eventName: `${input.provider}_payment_success`,
    relatedOrderId: orderId,
    eventValue: toSafeAmount(input.order.amount, addon.amount),
    eventData: {
      provider: input.provider,
      provider_order_id: input.providerOrderId,
      provider_transaction_id: input.providerTransactionId || null,
      addon_code: addonCode,
      currency: DOMESTIC_CURRENCY,
      product_type: "addon",
    },
    ensureSession: true,
  });

  void trackDomesticAnalyticsEvent({
    userId,
    eventType: "addon_purchased",
    eventName: `addon_${addonCode}_purchased`,
    relatedOrderId: orderId,
    eventValue: toSafeAmount(input.order.amount, addon.amount),
    eventData: {
      provider: input.provider,
      addon_code: addonCode,
      document_quota: addon.documentQuota,
      image_quota: addon.imageQuota,
      video_quota: addon.videoQuota,
      audio_quota: addon.audioQuota,
    },
    ensureSession: true,
  });

  return {
    alreadyPaid: false,
    addonCode,
    grantedAt: paidAtIso,
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
