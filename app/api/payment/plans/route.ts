import {
  getRoutedRuntimeDbClient,
  resolveBackendFromLanguage,
} from "@/lib/server/database-routing";

export const dynamic = "force-dynamic";

type PlanCode = "free" | "pro" | "enterprise";
type BillingPeriod = "monthly" | "yearly";
type AddonCode = "light" | "standard" | "premium";
type RuntimeSource = "cn" | "global";

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

type PlanPriceRow = {
  source?: string | null;
  plan_code?: string | null;
  billing_period?: string | null;
  currency?: string | null;
  amount?: number | string | null;
  original_amount?: number | string | null;
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

type PlanResponseItem = {
  planCode: PlanCode;
  displayNameCn: string;
  displayNameEn: string;
  planLevel: number;
  quotas: {
    monthlyDocumentLimit: number;
    monthlyImageLimit: number;
    monthlyVideoLimit: number;
    monthlyAudioLimit: number;
  };
  prices: {
    monthly: number;
    yearly: number;
    monthlyOriginal: number | null;
    yearlyOriginal: number | null;
  };
};

type AddonResponseItem = {
  addonCode: AddonCode;
  displayNameCn: string;
  displayNameEn: string;
  quotas: {
    documentQuota: number;
    imageQuota: number;
    videoQuota: number;
    audioQuota: number;
  };
  price: number;
};

type PlansApiPayload = {
  source: RuntimeSource;
  currency: "CNY" | "USD";
  fallback: boolean;
  plans: PlanResponseItem[];
  addons: AddonResponseItem[];
  fetchedAt: string;
};

const PLAN_ORDER: PlanCode[] = ["free", "pro", "enterprise"];
const ADDON_ORDER: AddonCode[] = ["light", "standard", "premium"];

const FALLBACK_DATA: Record<
  RuntimeSource,
  {
    currency: "CNY" | "USD";
    plans: PlanResponseItem[];
    addons: AddonResponseItem[];
  }
> = {
  cn: {
    currency: "CNY",
    plans: [
      {
        planCode: "free",
        displayNameCn: "免费版",
        displayNameEn: "Free",
        planLevel: 0,
        quotas: {
          monthlyDocumentLimit: 120,
          monthlyImageLimit: 4,
          monthlyVideoLimit: 1,
          monthlyAudioLimit: 6,
        },
        prices: {
          monthly: 0,
          yearly: 0,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
      {
        planCode: "pro",
        displayNameCn: "专业版",
        displayNameEn: "Pro",
        planLevel: 1,
        quotas: {
          monthlyDocumentLimit: 2000,
          monthlyImageLimit: 60,
          monthlyVideoLimit: 10,
          monthlyAudioLimit: 60,
        },
        prices: {
          monthly: 99,
          yearly: 699,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
      {
        planCode: "enterprise",
        displayNameCn: "企业版",
        displayNameEn: "Enterprise",
        planLevel: 2,
        quotas: {
          monthlyDocumentLimit: 8000,
          monthlyImageLimit: 250,
          monthlyVideoLimit: 25,
          monthlyAudioLimit: 250,
        },
        prices: {
          monthly: 299,
          yearly: 2099,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
    ],
    addons: [
      {
        addonCode: "light",
        displayNameCn: "轻量加油包",
        displayNameEn: "Light Pack",
        quotas: {
          documentQuota: 1200,
          imageQuota: 25,
          videoQuota: 4,
          audioQuota: 25,
        },
        price: 19.9,
      },
      {
        addonCode: "standard",
        displayNameCn: "标准加油包",
        displayNameEn: "Standard Pack",
        quotas: {
          documentQuota: 3500,
          imageQuota: 70,
          videoQuota: 10,
          audioQuota: 70,
        },
        price: 49.9,
      },
      {
        addonCode: "premium",
        displayNameCn: "旗舰加油包",
        displayNameEn: "Premium Pack",
        quotas: {
          documentQuota: 8000,
          imageQuota: 180,
          videoQuota: 25,
          audioQuota: 180,
        },
        price: 99.9,
      },
    ],
  },
  global: {
    currency: "USD",
    plans: [
      {
        planCode: "free",
        displayNameCn: "免费版",
        displayNameEn: "Free",
        planLevel: 0,
        quotas: {
          monthlyDocumentLimit: 120,
          monthlyImageLimit: 4,
          monthlyVideoLimit: 1,
          monthlyAudioLimit: 6,
        },
        prices: {
          monthly: 0,
          yearly: 0,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
      {
        planCode: "pro",
        displayNameCn: "专业版",
        displayNameEn: "Pro",
        planLevel: 1,
        quotas: {
          monthlyDocumentLimit: 2000,
          monthlyImageLimit: 60,
          monthlyVideoLimit: 10,
          monthlyAudioLimit: 60,
        },
        prices: {
          monthly: 29,
          yearly: 209,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
      {
        planCode: "enterprise",
        displayNameCn: "企业版",
        displayNameEn: "Enterprise",
        planLevel: 2,
        quotas: {
          monthlyDocumentLimit: 8000,
          monthlyImageLimit: 250,
          monthlyVideoLimit: 25,
          monthlyAudioLimit: 250,
        },
        prices: {
          monthly: 99,
          yearly: 699,
          monthlyOriginal: null,
          yearlyOriginal: null,
        },
      },
    ],
    addons: [
      {
        addonCode: "light",
        displayNameCn: "轻量加油包",
        displayNameEn: "Light Pack",
        quotas: {
          documentQuota: 1200,
          imageQuota: 25,
          videoQuota: 4,
          audioQuota: 25,
        },
        price: 2.99,
      },
      {
        addonCode: "standard",
        displayNameCn: "标准加油包",
        displayNameEn: "Standard Pack",
        quotas: {
          documentQuota: 3500,
          imageQuota: 70,
          videoQuota: 10,
          audioQuota: 70,
        },
        price: 6.99,
      },
      {
        addonCode: "premium",
        displayNameCn: "旗舰加油包",
        displayNameEn: "Premium Pack",
        quotas: {
          documentQuota: 8000,
          imageQuota: 180,
          videoQuota: 25,
          audioQuota: 180,
        },
        price: 13.99,
      },
    ],
  },
};

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

function toQueryRows<T>(result: unknown) {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return [] as T[];
  }
  const data = (result as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function normalizePlanCode(input: unknown): PlanCode | null {
  if (typeof input !== "string") {
    return null;
  }
  const code = input.trim().toLowerCase();
  if (code === "basic") {
    return "free";
  }
  return PLAN_ORDER.includes(code as PlanCode) ? (code as PlanCode) : null;
}

function normalizeAddonCode(input: unknown): AddonCode | null {
  if (typeof input !== "string") {
    return null;
  }
  const code = input.trim().toLowerCase();
  return ADDON_ORDER.includes(code as AddonCode) ? (code as AddonCode) : null;
}

function normalizeBillingPeriod(input: unknown): BillingPeriod | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.trim().toLowerCase();
  return normalized === "monthly" || normalized === "yearly"
    ? normalized
    : null;
}

function getRuntimeSource(): RuntimeSource {
  return resolveBackendFromLanguage() === "cloudbase" ? "cn" : "global";
}

function buildFallbackPayload(source: RuntimeSource): PlansApiPayload {
  const fallback = FALLBACK_DATA[source];
  return {
    source,
    currency: fallback.currency,
    fallback: true,
    plans: fallback.plans,
    addons: fallback.addons,
    fetchedAt: new Date().toISOString(),
  };
}

function buildMergedPayload(input: {
  source: RuntimeSource;
  plans: SubscriptionPlanRow[];
  prices: PlanPriceRow[];
  addons: AddonPackageRow[];
  addonPrices: AddonPackagePriceRow[];
}): PlansApiPayload {
  const fallback = FALLBACK_DATA[input.source];
  const currency = fallback.currency;

  const planRowMap = new Map<PlanCode, SubscriptionPlanRow>();
  for (const row of input.plans) {
    if (row?.is_active === false) {
      continue;
    }
    const planCode = normalizePlanCode(row.plan_code);
    if (!planCode) {
      continue;
    }
    planRowMap.set(planCode, row);
  }

  const priceRowMap = new Map<string, PlanPriceRow>();
  for (const row of input.prices) {
    if (row?.is_active === false) {
      continue;
    }
    if ((row.source || "").trim().toLowerCase() !== input.source) {
      continue;
    }
    if ((row.currency || "").trim().toUpperCase() !== currency) {
      continue;
    }

    const planCode = normalizePlanCode(row.plan_code);
    const billingPeriod = normalizeBillingPeriod(row.billing_period);
    if (!planCode || !billingPeriod) {
      continue;
    }
    priceRowMap.set(`${planCode}:${billingPeriod}`, row);
  }

  const addonRowMap = new Map<AddonCode, AddonPackageRow>();
  for (const row of input.addons) {
    if (row?.is_active === false) {
      continue;
    }
    const addonCode = normalizeAddonCode(row.addon_code);
    if (!addonCode) {
      continue;
    }
    addonRowMap.set(addonCode, row);
  }

  const addonPriceMap = new Map<AddonCode, AddonPackagePriceRow>();
  for (const row of input.addonPrices) {
    if (row?.is_active === false) {
      continue;
    }
    if ((row.source || "").trim().toLowerCase() !== input.source) {
      continue;
    }
    if ((row.currency || "").trim().toUpperCase() !== currency) {
      continue;
    }
    const addonCode = normalizeAddonCode(row.addon_code);
    if (!addonCode) {
      continue;
    }
    addonPriceMap.set(addonCode, row);
  }

  const plans: PlanResponseItem[] = PLAN_ORDER.map((planCode) => {
    const fallbackPlan = fallback.plans.find((item) => item.planCode === planCode);
    const rawPlan = planRowMap.get(planCode);
    const monthlyRow = priceRowMap.get(`${planCode}:monthly`);
    const yearlyRow = priceRowMap.get(`${planCode}:yearly`);

    return {
      planCode,
      displayNameCn:
        String(rawPlan?.display_name_cn || fallbackPlan?.displayNameCn || "").trim() ||
        fallbackPlan?.displayNameCn ||
        planCode,
      displayNameEn:
        String(rawPlan?.display_name_en || fallbackPlan?.displayNameEn || "").trim() ||
        fallbackPlan?.displayNameEn ||
        planCode,
      planLevel: toSafeInt(rawPlan?.plan_level, fallbackPlan?.planLevel || 0),
      quotas: {
        monthlyDocumentLimit: toSafeInt(
          rawPlan?.monthly_document_limit,
          fallbackPlan?.quotas.monthlyDocumentLimit || 0,
        ),
        monthlyImageLimit: toSafeInt(
          rawPlan?.monthly_image_limit,
          fallbackPlan?.quotas.monthlyImageLimit || 0,
        ),
        monthlyVideoLimit: toSafeInt(
          rawPlan?.monthly_video_limit,
          fallbackPlan?.quotas.monthlyVideoLimit || 0,
        ),
        monthlyAudioLimit: toSafeInt(
          rawPlan?.monthly_audio_limit,
          fallbackPlan?.quotas.monthlyAudioLimit || 0,
        ),
      },
      prices: {
        monthly: toSafeAmount(monthlyRow?.amount, fallbackPlan?.prices.monthly || 0),
        yearly: toSafeAmount(yearlyRow?.amount, fallbackPlan?.prices.yearly || 0),
        monthlyOriginal:
          monthlyRow?.original_amount === null || monthlyRow?.original_amount === undefined
            ? fallbackPlan?.prices.monthlyOriginal || null
            : toSafeAmount(
                monthlyRow.original_amount,
                fallbackPlan?.prices.monthlyOriginal || 0,
              ),
        yearlyOriginal:
          yearlyRow?.original_amount === null || yearlyRow?.original_amount === undefined
            ? fallbackPlan?.prices.yearlyOriginal || null
            : toSafeAmount(
                yearlyRow.original_amount,
                fallbackPlan?.prices.yearlyOriginal || 0,
              ),
      },
    };
  });

  const addons: AddonResponseItem[] = ADDON_ORDER.map((addonCode) => {
    const fallbackAddon = fallback.addons.find((item) => item.addonCode === addonCode);
    const rawAddon = addonRowMap.get(addonCode);
    const rawPrice = addonPriceMap.get(addonCode);

    return {
      addonCode,
      displayNameCn:
        String(rawAddon?.display_name_cn || fallbackAddon?.displayNameCn || "").trim() ||
        fallbackAddon?.displayNameCn ||
        addonCode,
      displayNameEn:
        String(rawAddon?.display_name_en || fallbackAddon?.displayNameEn || "").trim() ||
        fallbackAddon?.displayNameEn ||
        addonCode,
      quotas: {
        documentQuota: toSafeInt(
          rawAddon?.document_quota,
          fallbackAddon?.quotas.documentQuota || 0,
        ),
        imageQuota: toSafeInt(rawAddon?.image_quota, fallbackAddon?.quotas.imageQuota || 0),
        videoQuota: toSafeInt(rawAddon?.video_quota, fallbackAddon?.quotas.videoQuota || 0),
        audioQuota: toSafeInt(rawAddon?.audio_quota, fallbackAddon?.quotas.audioQuota || 0),
      },
      price: toSafeAmount(rawPrice?.amount, fallbackAddon?.price || 0),
    };
  });

  return {
    source: input.source,
    currency,
    fallback: false,
    plans,
    addons,
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const source = getRuntimeSource();
  const fallbackPayload = buildFallbackPayload(source);

  try {
    const db = await getRoutedRuntimeDbClient();
    if (!db) {
      return Response.json(fallbackPayload);
    }

    const currency = source === "cn" ? "CNY" : "USD";
    const [plansResult, pricesResult, addonsResult, addonPricesResult] = await Promise.all([
      db
        .from("subscription_plans")
        .select(
          "plan_code,display_name_cn,display_name_en,plan_level,monthly_document_limit,monthly_image_limit,monthly_video_limit,monthly_audio_limit,is_active",
        )
        .limit(20),
      db
        .from("plan_prices")
        .select(
          "source,plan_code,billing_period,currency,amount,original_amount,is_active",
        )
        .eq("source", source)
        .eq("currency", currency)
        .limit(20),
      db
        .from("addon_packages")
        .select(
          "addon_code,display_name_cn,display_name_en,document_quota,image_quota,video_quota,audio_quota,is_active",
        )
        .limit(20),
      db
        .from("addon_package_prices")
        .select("source,addon_code,currency,amount,is_active")
        .eq("source", source)
        .eq("currency", currency)
        .limit(20),
    ]);

    const plansError = toQueryErrorMessage(plansResult);
    const pricesError = toQueryErrorMessage(pricesResult);
    const addonsError = toQueryErrorMessage(addonsResult);
    const addonPricesError = toQueryErrorMessage(addonPricesResult);

    if (plansError || pricesError || addonsError || addonPricesError) {
      console.error("[PaymentPlans] 查询商品配置失败:", {
        source,
        plansError,
        pricesError,
        addonsError,
        addonPricesError,
      });
      return Response.json(fallbackPayload);
    }

    const payload = buildMergedPayload({
      source,
      plans: toQueryRows<SubscriptionPlanRow>(plansResult),
      prices: toQueryRows<PlanPriceRow>(pricesResult),
      addons: toQueryRows<AddonPackageRow>(addonsResult),
      addonPrices: toQueryRows<AddonPackagePriceRow>(addonPricesResult),
    });

    return Response.json(payload);
  } catch (error) {
    console.error("[PaymentPlans] 加载商品配置异常:", error);
    return Response.json(fallbackPayload);
  }
}
