"use server";

import { revalidatePath } from "next/cache";
import {
  AdminActionResult,
  createTextId,
  parseDecimalOr,
  parseIntOr,
  requireAdminContext,
  writeAdminAuditLog,
} from "@/actions/admin-common";
import { getRoutedAdminDbClient } from "@/lib/server/database-routing";

const QUOTA_TYPES = ["document", "image", "video", "audio"] as const;
type QuotaType = (typeof QUOTA_TYPES)[number];

export type SubscriptionPlanRow = {
  plan_code: string;
  display_name_cn: string;
  display_name_en: string;
  plan_level: number;
  monthly_document_limit: number;
  monthly_image_limit: number;
  monthly_video_limit: number;
  monthly_audio_limit: number;
  is_active: boolean;
  admin_adjustable: boolean;
  updated_at: string;
};

export type PlanPriceRow = {
  id: string;
  source: "cn" | "global";
  plan_code: string;
  billing_period: "monthly" | "yearly";
  currency: "CNY" | "USD" | string;
  amount: number;
  original_amount: number | null;
  is_active: boolean;
  updated_at: string;
};

export type AddonPackageRow = {
  addon_code: string;
  display_name_cn: string;
  display_name_en: string;
  document_quota: number;
  image_quota: number;
  video_quota: number;
  audio_quota: number;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
};

export type UserQuotaListItem = {
  accountId: string;
  userId: string;
  source: string;
  planCode: string;
  status: string;
  cycleStartDate: string;
  cycleEndDate: string;
  nextResetAt: string | null;
  userEmail: string | null;
  userName: string | null;
  balances: Array<{
    id: string;
    quotaType: string;
    baseLimit: number;
    addonLimit: number;
    adminAdjustment: number;
    usedAmount: number;
    remainingAmount: number | null;
    updatedAt: string;
  }>;
};

export type UserQuotaListResult = {
  rows: UserQuotaListItem[];
  total: number;
  page: number;
  limit: number;
};

export type QuotaChangeLogRow = {
  id: string;
  user_id: string;
  source: string;
  quota_type: string;
  change_kind: string;
  delta_amount: number;
  before_amount: number;
  after_amount: number;
  operator_type: string;
  operator_id: string | null;
  note: string | null;
  created_at: string;
};

async function readPlanPricesBySource(source: "cn" | "global") {
  const db = await getRoutedAdminDbClient(source);
  if (!db) {
    console.error("[AdminQuota] 读取套餐价格失败: 数据库未连接", { source });
    return [] as PlanPriceRow[];
  }

  const currency = source === "cn" ? "CNY" : "USD";
  const { data, error } = await db
    .from("plan_prices")
    .select("*")
    .eq("source", source)
    .eq("currency", currency)
    .order("plan_code", { ascending: true })
    .order("billing_period", { ascending: true });

  if (error) {
    console.error("[AdminQuota] 读取套餐价格失败:", {
      source,
      message: error.message,
    });
    return [] as PlanPriceRow[];
  }

  return (data || []) as PlanPriceRow[];
}

function isQuotaType(input: string): input is QuotaType {
  return QUOTA_TYPES.includes(input as QuotaType);
}

export async function getQuotaConfig() {
  const { session, db } = await requireAdminContext();
  if (!session || !db) {
    return {
      plans: [] as SubscriptionPlanRow[],
      addons: [] as AddonPackageRow[],
      prices: [] as PlanPriceRow[],
    };
  }

  const [{ data: plans }, { data: addons }, cnPrices, globalPrices] = await Promise.all([
    db
      .from("subscription_plans")
      .select("*")
      .order("plan_level", { ascending: true }),
    db
      .from("addon_packages")
      .select("*")
      .order("sort_order", { ascending: true }),
    readPlanPricesBySource("cn"),
    readPlanPricesBySource("global"),
  ]);

  const mergedPrices = [...cnPrices, ...globalPrices];
  const filteredPrices = mergedPrices.filter(
    (item) =>
      (item.plan_code === "pro" || item.plan_code === "enterprise") &&
      (item.source === "cn" || item.source === "global") &&
      (item.billing_period === "monthly" || item.billing_period === "yearly"),
  );

  return {
    plans: (plans || []) as SubscriptionPlanRow[],
    addons: (addons || []) as AddonPackageRow[],
    prices: filteredPrices,
  };
}

export async function updateSubscriptionPlanLimits(
  formData: FormData,
): Promise<AdminActionResult> {
  const { session, db } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const planCode = String(formData.get("plan_code") || "").trim();
  if (!planCode) {
    return { success: false, error: "缺少套餐编码" };
  }

  const updates = {
    monthly_document_limit: parseIntOr(formData.get("monthly_document_limit") as string, 0),
    monthly_image_limit: parseIntOr(formData.get("monthly_image_limit") as string, 0),
    monthly_video_limit: parseIntOr(formData.get("monthly_video_limit") as string, 0),
    monthly_audio_limit: parseIntOr(formData.get("monthly_audio_limit") as string, 0),
    updated_at: new Date().toISOString(),
  };

  const { data: before } = await db
    .from("subscription_plans")
    .select("*")
    .eq("plan_code", planCode)
    .maybeSingle();

  const { error } = await db
    .from("subscription_plans")
    .update(updates)
    .eq("plan_code", planCode);

  if (error) {
    return { success: false, error: "更新套餐额度失败" };
  }

  await writeAdminAuditLog({
    action: "update_plan_quota",
    targetType: "subscription_plans",
    targetId: planCode,
    afterJson: updates,
    beforeJson: before || null,
  });

  revalidatePath("/admin/quota");
  return { success: true };
}

export async function updateAddonPackageLimits(
  formData: FormData,
): Promise<AdminActionResult> {
  const { session, db } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const addonCode = String(formData.get("addon_code") || "").trim();
  if (!addonCode) {
    return { success: false, error: "缺少加油包编码" };
  }

  const updates = {
    document_quota: parseIntOr(formData.get("document_quota") as string, 0),
    image_quota: parseIntOr(formData.get("image_quota") as string, 0),
    video_quota: parseIntOr(formData.get("video_quota") as string, 0),
    audio_quota: parseIntOr(formData.get("audio_quota") as string, 0),
    updated_at: new Date().toISOString(),
  };

  const { data: before } = await db
    .from("addon_packages")
    .select("*")
    .eq("addon_code", addonCode)
    .maybeSingle();

  const { error } = await db
    .from("addon_packages")
    .update(updates)
    .eq("addon_code", addonCode);

  if (error) {
    return { success: false, error: "更新加油包额度失败" };
  }

  await writeAdminAuditLog({
    action: "update_addon_quota",
    targetType: "addon_packages",
    targetId: addonCode,
    afterJson: updates,
    beforeJson: before || null,
  });

  revalidatePath("/admin/quota");
  return { success: true };
}

function buildPlanPriceId(input: {
  source: "cn" | "global";
  planCode: "pro" | "enterprise";
  billingPeriod: "monthly" | "yearly";
}) {
  const planAlias = input.planCode === "enterprise" ? "ent" : input.planCode;
  return `price_${input.source}_${planAlias}_${input.billingPeriod}`;
}

export async function updateSubscriptionPlanPricing(
  formData: FormData,
): Promise<AdminActionResult> {
  const { session } = await requireAdminContext();
  if (!session) {
    return { success: false, error: "未授权访问" };
  }

  const source = String(formData.get("source") || "").trim() as "cn" | "global";
  const planCode = String(formData.get("plan_code") || "").trim() as
    | "pro"
    | "enterprise";

  if (source !== "cn" && source !== "global") {
    return { success: false, error: "定价来源无效" };
  }
  if (planCode !== "pro" && planCode !== "enterprise") {
    return { success: false, error: "仅支持专业版与企业版定价" };
  }

  const db = await getRoutedAdminDbClient(source);
  if (!db) {
    return {
      success: false,
      error: source === "cn" ? "国内版数据库不可用" : "国际版数据库不可用",
    };
  }

  const monthlyAmount = Math.max(
    0,
    parseDecimalOr(formData.get("monthly_amount") as string, NaN),
  );
  const yearlyAmount = Math.max(
    0,
    parseDecimalOr(formData.get("yearly_amount") as string, NaN),
  );

  if (!Number.isFinite(monthlyAmount) || !Number.isFinite(yearlyAmount)) {
    return { success: false, error: "请输入有效的价格" };
  }

  const normalizedMonthly = Number(monthlyAmount.toFixed(2));
  const normalizedYearly = Number(yearlyAmount.toFixed(2));
  const currency = source === "cn" ? "CNY" : "USD";

  const { data: existingRows } = await db
    .from("plan_prices")
    .select("*")
    .eq("source", source)
    .eq("plan_code", planCode)
    .eq("currency", currency);

  const beforeRows = ((existingRows || []) as PlanPriceRow[]).filter(
    (item) =>
      item.billing_period === "monthly" || item.billing_period === "yearly",
  );

  const targetRows: Array<{ billingPeriod: "monthly" | "yearly"; amount: number }> = [
    { billingPeriod: "monthly", amount: normalizedMonthly },
    { billingPeriod: "yearly", amount: normalizedYearly },
  ];

  for (const target of targetRows) {
    const existed = beforeRows.find(
      (item) => item.billing_period === target.billingPeriod,
    );

    if (existed?.id) {
      const { error } = await db
        .from("plan_prices")
        .update({
          currency,
          amount: target.amount,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existed.id);

      if (error) {
        return { success: false, error: "更新套餐定价失败" };
      }
      continue;
    }

    const { error } = await db.from("plan_prices").insert({
      id: createTextId(
        buildPlanPriceId({
          source,
          planCode,
          billingPeriod: target.billingPeriod,
        }),
      ),
      source,
      plan_code: planCode,
      billing_period: target.billingPeriod,
      currency,
      amount: target.amount,
      original_amount: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      return { success: false, error: "创建套餐定价失败" };
    }
  }

  try {
    await db.from("admin_audit_logs").insert({
      id: createTextId("audit"),
      admin_user_id: session.userId,
      action: "update_plan_pricing",
      target_type: "plan_prices",
      target_id: `${source}:${planCode}`,
      source,
      before_json: beforeRows,
      after_json: {
        source,
        plan_code: planCode,
        currency,
        monthly_amount: normalizedMonthly,
        yearly_amount: normalizedYearly,
      },
      created_at: new Date().toISOString(),
    });
  } catch (auditError) {
    console.warn("[AdminQuota] 写入套餐定价审计日志失败:", auditError);
  }

  revalidatePath("/admin/quota");
  return { success: true };
}

export async function getUserQuotaList(params?: {
  source?: "all" | "global" | "cn";
  search?: string;
  page?: number;
  limit?: number;
  status?: string;
}) {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { rows: [], total: 0, page: 1, limit: 20 } as UserQuotaListResult;
  }

  const status = params?.status || "all";
  const page = Math.max(1, Number(params?.page || 1));
  const limit = Math.max(1, Math.min(200, Number(params?.limit || 20)));
  const search = (params?.search || "").trim().toLowerCase();

  let query = db.from("user_quota_accounts").select(
    `
      id,
      user_id,
      source,
      plan_code,
      status,
      cycle_start_date,
      cycle_end_date,
      next_reset_at,
      app_users:user_id(id, email, display_name),
      user_quota_balances(
        id,
        quota_type,
        base_limit,
        addon_limit,
        admin_adjustment,
        used_amount,
        remaining_amount,
        updated_at
      )
    `,
  );

  query = query.eq("source", sourceScope);
  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("cycle_end_date", { ascending: false });
  if (error) {
    return { rows: [], total: 0, page, limit } as UserQuotaListResult;
  }

  let rows = (data || []) as Array<{
    id: string;
    user_id: string;
    source: string;
    plan_code: string;
    status: string;
    cycle_start_date: string;
    cycle_end_date: string;
    next_reset_at: string | null;
    app_users: Array<{ id: string; email: string | null; display_name: string | null }> | null;
    user_quota_balances: Array<{
      id: string;
      quota_type: string;
      base_limit: number;
      addon_limit: number;
      admin_adjustment: number;
      used_amount: number;
      remaining_amount: number | null;
      updated_at: string;
    }>;
  }>;

  if (search) {
    rows = rows.filter((item) => {
      const userInfo = item.app_users?.[0];
      const email = (userInfo?.email || "").toLowerCase();
      const name = (userInfo?.display_name || "").toLowerCase();
      const userId = (item.user_id || "").toLowerCase();
      return email.includes(search) || name.includes(search) || userId.includes(search);
    });
  }

  const total = rows.length;
  const start = (page - 1) * limit;
  const pagedRows = rows.slice(start, start + limit);

  return {
    rows: pagedRows.map((item) => {
      const userInfo = item.app_users?.[0];
      return {
        accountId: item.id,
        userId: item.user_id,
        source: item.source,
        planCode: item.plan_code,
        status: item.status,
        cycleStartDate: item.cycle_start_date,
        cycleEndDate: item.cycle_end_date,
        nextResetAt: item.next_reset_at,
        userEmail: userInfo?.email || null,
        userName: userInfo?.display_name || null,
        balances: (item.user_quota_balances || []).map((balance) => ({
          id: balance.id,
          quotaType: balance.quota_type,
          baseLimit: Number(balance.base_limit || 0),
          addonLimit: Number(balance.addon_limit || 0),
          adminAdjustment: Number(balance.admin_adjustment || 0),
          usedAmount: Number(balance.used_amount || 0),
          remainingAmount:
            balance.remaining_amount === null ? null : Number(balance.remaining_amount || 0),
          updatedAt: balance.updated_at,
        })),
      };
    }),
    total,
    page,
    limit,
  } as UserQuotaListResult;
}

export async function getQuotaChangeLogs(params?: {
  source?: "all" | "global" | "cn";
  limit?: number;
}) {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [] as QuotaChangeLogRow[];
  }

  const limit = Math.max(1, Math.min(500, Number(params?.limit || 100)));

  let query = db
    .from("user_quota_change_logs")
    .select("*")
    .eq("source", sourceScope)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    return [] as QuotaChangeLogRow[];
  }

  return (data || []) as QuotaChangeLogRow[];
}

export async function adjustUserQuota(formData: FormData): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const userId = String(formData.get("user_id") || "").trim();
  const quotaType = String(formData.get("quota_type") || "").trim();
  const delta = parseIntOr(formData.get("delta_amount") as string, NaN);
  const note = String(formData.get("note") || "").trim() || null;

  if (!userId || !quotaType || Number.isNaN(delta) || delta === 0) {
    return { success: false, error: "请填写完整且有效的调整信息" };
  }
  if (!isQuotaType(quotaType)) {
    return { success: false, error: "额度类型不合法" };
  }

  const { data: account, error: accountError } = await db
    .from("user_quota_accounts")
    .select("id, user_id, source, status")
    .eq("user_id", userId)
    .eq("source", sourceScope)
    .eq("status", "active")
    .order("cycle_end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError || !account) {
    return { success: false, error: "未找到用户当前有效额度账户" };
  }

  const { data: existingBalance, error: balanceError } = await db
    .from("user_quota_balances")
    .select("*")
    .eq("quota_account_id", account.id)
    .eq("quota_type", quotaType)
    .maybeSingle();

  if (balanceError) {
    return { success: false, error: "读取用户额度失败" };
  }

  const nowIso = new Date().toISOString();
  const balance = existingBalance || {
    id: createTextId("quota_balance"),
    quota_account_id: account.id,
    quota_type: quotaType,
    base_limit: 0,
    addon_limit: 0,
    admin_adjustment: 0,
    used_amount: 0,
    remaining_amount: 0,
    updated_at: nowIso,
  };

  const baseLimit = Number(balance.base_limit || 0);
  const addonLimit = Number(balance.addon_limit || 0);
  const adminAdjustment = Number(balance.admin_adjustment || 0);
  const usedAmount = Number(balance.used_amount || 0);
  const totalBefore = baseLimit + addonLimit + adminAdjustment;
  const totalAfter = totalBefore + delta;
  if (totalAfter < usedAmount) {
    return { success: false, error: "调整后总额度不能小于已使用额度" };
  }

  const beforeAmount =
    balance.remaining_amount === null || balance.remaining_amount === undefined
      ? totalBefore - usedAmount
      : Number(balance.remaining_amount);
  const afterAmount = totalAfter - usedAmount;
  const nextAdminAdjustment = adminAdjustment + delta;

  if (existingBalance) {
    const { error: updateError } = await db
      .from("user_quota_balances")
      .update({
        admin_adjustment: nextAdminAdjustment,
        remaining_amount: afterAmount,
        updated_at: nowIso,
      })
      .eq("id", existingBalance.id);

    if (updateError) {
      return { success: false, error: "更新用户额度失败" };
    }
  } else {
    const { error: insertBalanceError } = await db.from("user_quota_balances").insert({
      id: balance.id,
      quota_account_id: account.id,
      quota_type: quotaType,
      base_limit: baseLimit,
      addon_limit: addonLimit,
      admin_adjustment: nextAdminAdjustment,
      used_amount: usedAmount,
      remaining_amount: afterAmount,
      updated_at: nowIso,
    });

    if (insertBalanceError) {
      return { success: false, error: "创建用户额度失败" };
    }
  }

  const { error: insertLogError } = await db.from("user_quota_change_logs").insert({
    id: createTextId("quota_log"),
    user_id: userId,
    source: sourceScope,
    quota_type: quotaType,
    change_kind: "admin_adjust",
    delta_amount: delta,
    before_amount: beforeAmount,
    after_amount: afterAmount,
    reference_type: "admin_console",
    reference_id: account.id,
    operator_type: "admin",
    operator_id: session.userId,
    note,
    created_at: nowIso,
  });

  if (insertLogError) {
    return { success: false, error: "写入额度变更日志失败" };
  }

  await writeAdminAuditLog({
    action: "update_user_quota",
    targetType: "user_quota_balances",
    targetId: account.id,
    source: sourceScope,
    beforeJson: {
      quota_type: quotaType,
      before_amount: beforeAmount,
      admin_adjustment: adminAdjustment,
    },
    afterJson: {
      quota_type: quotaType,
      after_amount: afterAmount,
      admin_adjustment: nextAdminAdjustment,
      delta,
      note,
    },
  });

  revalidatePath("/admin/quota");
  return { success: true };
}
