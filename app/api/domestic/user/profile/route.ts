export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  buildQuotaSummary,
  mapPlanCodeToUserPlan,
  parseDateTimeMs,
  pickPlanDefinition,
  resolveEffectivePlan,
} from "@/lib/user-status";
import {
  ensureDomesticAppUser,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
} from "@/lib/payment/domestic-payment";

type QueryResult<T> = {
  data?: T[] | T | null;
  error?: { message?: string | null } | null;
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

type SubscriptionPlanRow = {
  plan_code?: string | null;
  display_name_cn?: string | null;
  display_name_en?: string | null;
  monthly_document_limit?: number | string | null;
  monthly_image_limit?: number | string | null;
  monthly_video_limit?: number | string | null;
  monthly_audio_limit?: number | string | null;
};

type UserQuotaAccountRow = {
  id?: string | null;
  cycle_end_date?: string | null;
};

type UserQuotaBalanceRow = {
  quota_type?: string | null;
  base_limit?: number | string | null;
  addon_limit?: number | string | null;
  admin_adjustment?: number | string | null;
  used_amount?: number | string | null;
  remaining_amount?: number | string | null;
};

function normalizeText(input: unknown, fallback = "") {
  if (typeof input !== "string") {
    return fallback;
  }
  const trimmed = input.trim();
  return trimmed || fallback;
}

function toRows<T>(result: QueryResult<T>): T[] {
  if (Array.isArray(result.data)) {
    return result.data as T[];
  }
  if (result.data && typeof result.data === "object") {
    return [result.data as T];
  }
  return [];
}

async function queryRows<T>(query: Promise<QueryResult<T>>, context: string) {
  const result = await query;
  const message = normalizeText(result?.error?.message, "");
  if (message) {
    throw new Error(`${context}: ${message}`);
  }
  return toRows(result);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    await ensureDomesticAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    let appUserRow =
      (
        await queryRows<AppUserRow>(
          db
            .from("app_users")
            .select("id,source,email,email_normalized,display_name,current_plan_code,plan_expires_at")
            .eq("id", user.userId)
            .eq("source", "cn")
            .limit(1),
          "读取用户信息失败",
        )
      )[0] || null;

    const normalizedEmail = normalizeText(user.email, "").toLowerCase();
    if (!appUserRow && normalizedEmail) {
      appUserRow =
        (
          await queryRows<AppUserRow>(
            db
              .from("app_users")
              .select("id,source,email,email_normalized,display_name,current_plan_code,plan_expires_at")
              .eq("source", "cn")
              .eq("email_normalized", normalizedEmail)
              .limit(1),
            "按邮箱读取用户信息失败",
          )
        )[0] || null;
    }

    const resolvedUserId = normalizeText(appUserRow?.id, user.userId);

    const [planRows, quotaAccountRows] = await Promise.all([
      queryRows<SubscriptionPlanRow>(
        db
          .from("subscription_plans")
          .select(
            "plan_code,display_name_cn,display_name_en,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit",
          )
          .limit(20),
        "读取套餐定义失败",
      ),
      queryRows<UserQuotaAccountRow>(
        db
          .from("user_quota_accounts")
          .select("id,cycle_end_date")
          .eq("user_id", resolvedUserId)
          .eq("source", "cn")
          .eq("status", "active")
          .limit(20),
        "读取额度账户失败",
      ),
    ]);

    const latestQuotaAccount = quotaAccountRows
      .map((item) => ({
        id: normalizeText(item.id, ""),
        cycleEndDate: normalizeText(item.cycle_end_date, ""),
      }))
      .filter((item) => item.id)
      .sort(
        (left, right) =>
          (parseDateTimeMs(right.cycleEndDate) || 0) -
          (parseDateTimeMs(left.cycleEndDate) || 0),
      )[0];

    let quotaBalanceRows: UserQuotaBalanceRow[] = [];
    if (latestQuotaAccount?.id) {
      quotaBalanceRows = await queryRows<UserQuotaBalanceRow>(
        db
          .from("user_quota_balances")
          .select("quota_type,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
          .eq("quota_account_id", latestQuotaAccount.id)
          .limit(20),
        "读取额度余额失败",
      );
    }

    const rawPlan = mapPlanCodeToUserPlan(appUserRow?.current_plan_code);
    const planExp = normalizeText(appUserRow?.plan_expires_at, "") || null;
    const { effectivePlan, isPlanActive } = resolveEffectivePlan(rawPlan, planExp);
    const planDefinition = pickPlanDefinition(planRows, effectivePlan);
    const quotaSummary = buildQuotaSummary(planDefinition, quotaBalanceRows);

    const email =
      normalizeText(appUserRow?.email, "").toLowerCase() ||
      normalizedEmail ||
      null;
    const displayName =
      normalizeText(appUserRow?.display_name, "") ||
      (email ? email.split("@")[0] : "用户");

    return NextResponse.json({
      success: true,
      user: {
        id: resolvedUserId,
        source: "cn",
        email,
        display_name: displayName,
        raw_plan: rawPlan,
        effective_plan: effectivePlan,
        plan_expires_at: planExp,
        is_plan_active: isPlanActive,
        plan_display_name_cn: planDefinition.displayNameCn,
        plan_display_name_en: planDefinition.displayNameEn,
        quota_summary: quotaSummary,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "读取用户信息失败";
    return NextResponse.json({ success: false, error: message }, { status: 401 });
  }
}

