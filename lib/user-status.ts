export type UserPlan = "free" | "basic" | "pro" | "enterprise";

export type QuotaType = "document" | "image" | "video" | "audio";

const QUOTA_TYPES: QuotaType[] = ["document", "image", "video", "audio"];

export type SubscriptionPlanView = {
  planCode: UserPlan;
  displayNameCn: string;
  displayNameEn: string;
  monthlyDocumentLimit: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  monthlyAudioLimit: number;
};

export type QuotaBalanceView = {
  quotaType: QuotaType;
  baseLimit: number;
  addonLimit: number;
  adminAdjustment: number;
  usedAmount: number;
  totalLimit: number;
  remainingAmount: number;
  addonRemaining: number;
};

export type QuotaSummary = Record<QuotaType, QuotaBalanceView>;

type SubscriptionPlanRow = {
  plan_code?: string | null;
  display_name_cn?: string | null;
  display_name_en?: string | null;
  monthly_document_limit?: number | string | null;
  monthly_image_limit?: number | string | null;
  monthly_video_limit?: number | string | null;
  monthly_audio_limit?: number | string | null;
};

type UserQuotaBalanceRow = {
  quota_type?: string | null;
  base_limit?: number | string | null;
  addon_limit?: number | string | null;
  admin_adjustment?: number | string | null;
  used_amount?: number | string | null;
  remaining_amount?: number | string | null;
};

const FALLBACK_PLAN_DEFINITIONS: Record<UserPlan, SubscriptionPlanView> = {
  free: {
    planCode: "free",
    displayNameCn: "免费版",
    displayNameEn: "Free",
    monthlyDocumentLimit: 120,
    monthlyImageLimit: 4,
    monthlyVideoLimit: 1,
    monthlyAudioLimit: 6,
  },
  basic: {
    planCode: "basic",
    displayNameCn: "基础版",
    displayNameEn: "Basic",
    monthlyDocumentLimit: 600,
    monthlyImageLimit: 16,
    monthlyVideoLimit: 4,
    monthlyAudioLimit: 24,
  },
  pro: {
    planCode: "pro",
    displayNameCn: "专业版",
    displayNameEn: "Pro",
    monthlyDocumentLimit: 2000,
    monthlyImageLimit: 60,
    monthlyVideoLimit: 10,
    monthlyAudioLimit: 60,
  },
  enterprise: {
    planCode: "enterprise",
    displayNameCn: "企业版",
    displayNameEn: "Enterprise",
    monthlyDocumentLimit: 8000,
    monthlyImageLimit: 250,
    monthlyVideoLimit: 25,
    monthlyAudioLimit: 250,
  },
};

function toNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function mapPlanCodeToUserPlan(planCode: unknown): UserPlan {
  if (typeof planCode !== "string") {
    return "free";
  }
  const normalized = planCode.trim().toLowerCase();
  if (normalized === "enterprise") return "enterprise";
  if (normalized === "pro") return "pro";
  if (normalized === "basic") return "basic";
  return "free";
}

export function resolveEffectivePlan(rawPlan: UserPlan, planExp: string | null) {
  const planExpDate = planExp ? new Date(planExp) : null;
  const isPlanActive = planExpDate ? planExpDate.getTime() > Date.now() : true;
  return {
    isPlanActive,
    effectivePlan: isPlanActive ? rawPlan : "free",
  } as const;
}

function toPlanView(row: SubscriptionPlanRow): SubscriptionPlanView {
  const planCode = mapPlanCodeToUserPlan(row.plan_code);
  const fallback = FALLBACK_PLAN_DEFINITIONS[planCode];
  return {
    planCode,
    displayNameCn: String(row.display_name_cn || fallback.displayNameCn),
    displayNameEn: String(row.display_name_en || fallback.displayNameEn),
    monthlyDocumentLimit: Math.max(
      0,
      toNumber(row.monthly_document_limit, fallback.monthlyDocumentLimit),
    ),
    monthlyImageLimit: Math.max(
      0,
      toNumber(row.monthly_image_limit, fallback.monthlyImageLimit),
    ),
    monthlyVideoLimit: Math.max(
      0,
      toNumber(row.monthly_video_limit, fallback.monthlyVideoLimit),
    ),
    monthlyAudioLimit: Math.max(
      0,
      toNumber(row.monthly_audio_limit, fallback.monthlyAudioLimit),
    ),
  };
}

export function pickPlanDefinition(
  planRows: SubscriptionPlanRow[],
  planCode: UserPlan,
): SubscriptionPlanView {
  const normalizedRows = (planRows || []).map(toPlanView);
  const preferred = normalizedRows.find((item) => item.planCode === planCode);
  if (preferred) {
    return preferred;
  }
  return FALLBACK_PLAN_DEFINITIONS[planCode];
}

function buildQuotaFallback(plan: SubscriptionPlanView): QuotaSummary {
  return {
    document: {
      quotaType: "document",
      baseLimit: plan.monthlyDocumentLimit,
      addonLimit: 0,
      adminAdjustment: 0,
      usedAmount: 0,
      totalLimit: plan.monthlyDocumentLimit,
      remainingAmount: plan.monthlyDocumentLimit,
      addonRemaining: 0,
    },
    image: {
      quotaType: "image",
      baseLimit: plan.monthlyImageLimit,
      addonLimit: 0,
      adminAdjustment: 0,
      usedAmount: 0,
      totalLimit: plan.monthlyImageLimit,
      remainingAmount: plan.monthlyImageLimit,
      addonRemaining: 0,
    },
    video: {
      quotaType: "video",
      baseLimit: plan.monthlyVideoLimit,
      addonLimit: 0,
      adminAdjustment: 0,
      usedAmount: 0,
      totalLimit: plan.monthlyVideoLimit,
      remainingAmount: plan.monthlyVideoLimit,
      addonRemaining: 0,
    },
    audio: {
      quotaType: "audio",
      baseLimit: plan.monthlyAudioLimit,
      addonLimit: 0,
      adminAdjustment: 0,
      usedAmount: 0,
      totalLimit: plan.monthlyAudioLimit,
      remainingAmount: plan.monthlyAudioLimit,
      addonRemaining: 0,
    },
  };
}

export function buildQuotaSummary(
  plan: SubscriptionPlanView,
  balanceRows: UserQuotaBalanceRow[],
): QuotaSummary {
  const fallback = buildQuotaFallback(plan);
  const rowMap = new Map<QuotaType, UserQuotaBalanceRow>();

  for (const row of balanceRows || []) {
    const quotaType =
      typeof row.quota_type === "string"
        ? row.quota_type.trim().toLowerCase()
        : "";
    if (!QUOTA_TYPES.includes(quotaType as QuotaType)) {
      continue;
    }
    rowMap.set(quotaType as QuotaType, row);
  }

  const nextSummary = { ...fallback };

  for (const quotaType of QUOTA_TYPES) {
    const row = rowMap.get(quotaType);
    if (!row) {
      continue;
    }

    const quotaFallback = fallback[quotaType];
    const baseLimit = Math.max(0, toNumber(row.base_limit, quotaFallback.baseLimit));
    const addonLimit = Math.max(0, toNumber(row.addon_limit, 0));
    const adminAdjustment = toNumber(row.admin_adjustment, 0);
    const usedAmount = Math.max(0, toNumber(row.used_amount, 0));
    const totalLimit = Math.max(0, baseLimit + addonLimit + adminAdjustment);
    const remainingFromUsage = Math.max(0, totalLimit - usedAmount);
    const remainingAmount =
      row.remaining_amount === null || row.remaining_amount === undefined
        ? remainingFromUsage
        : Math.max(0, toNumber(row.remaining_amount, remainingFromUsage));

    const baseCapacity = Math.max(0, baseLimit + adminAdjustment);
    const overflowUsed = Math.max(0, usedAmount - baseCapacity);
    const addonRemaining = Math.min(
      remainingAmount,
      Math.max(0, addonLimit - overflowUsed),
    );

    nextSummary[quotaType] = {
      quotaType,
      baseLimit,
      addonLimit,
      adminAdjustment,
      usedAmount,
      totalLimit,
      remainingAmount,
      addonRemaining,
    };
  }

  return nextSummary;
}
