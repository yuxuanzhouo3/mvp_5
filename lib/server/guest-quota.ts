import { getServerRuntimeLanguage } from "@/config/runtime";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { getCloudBaseAdminDb } from "@/lib/server/cloudbase-connector";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GUEST_VISITOR_COOKIE_NAME = "mg_guest_vid";

const GUEST_VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const GUEST_QUOTA_LIMIT_FALLBACK = 0;
const CLOUDBASE_GUEST_QUOTA_COLLECTION = "guest_generation_quotas_cn";
const CLOUDBASE_CONSUME_MAX_RETRIES = 3;

type GuestQuotaBackend = "cloudbase" | "supabase";

export type GuestQuotaSnapshot = {
  monthKey: string;
  limit: number;
  used: number;
  remaining: number;
};

type GuestQuotaContext = {
  monthKey: string;
  visitorKeyHash: string;
  setCookieHeader?: string;
};

export type GuestQuotaReservation = {
  backend: GuestQuotaBackend;
  monthKey: string;
  visitorKeyHash: string;
};

export type ConsumeGuestQuotaResult = {
  allowed: boolean;
  snapshot: GuestQuotaSnapshot;
  reservation?: GuestQuotaReservation;
  setCookieHeader?: string;
};

type ConsumeGuestQuotaRow = {
  allowed?: boolean | null;
  used_count?: number | null;
  limit_count?: number | null;
  remaining_count?: number | null;
};

type ReleaseGuestQuotaRow = {
  used_count?: number | null;
  limit_count?: number | null;
  remaining_count?: number | null;
};

type GuestQuotaRow = {
  used_count?: number | null;
};

type CloudBaseGuestQuotaDoc = {
  _id?: string;
  month_key?: string;
  visitor_key_hash?: string;
  used_count?: number;
  limit_count?: number;
  last_request_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

let cloudbaseCollectionReady = false;
let cloudbaseCollectionInitPromise: Promise<void> | null = null;

function toSafeInt(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function resolveGuestQuotaBackend(): GuestQuotaBackend {
  return getServerRuntimeLanguage().startsWith("zh") ? "cloudbase" : "supabase";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "未知错误";
}

export function getGuestMonthlyLimit() {
  const parsed = toSafeInt(
    process.env.NEXT_PUBLIC_GUEST_MONTHLY_LIMIT,
    GUEST_QUOTA_LIMIT_FALLBACK,
  );
  return Math.max(0, parsed);
}

function getMonthKey(now: Date = new Date()) {
  return now.toISOString().slice(0, 7);
}

function parseCookieMap(cookieHeader: string | null) {
  const cookieMap = new Map<string, string>();
  if (!cookieHeader) {
    return cookieMap;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    cookieMap.set(key, decodeURIComponent(value));
  }

  return cookieMap;
}

function serializeCookie(name: string, value: string) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${GUEST_VISITOR_COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getClientIp(request: Request) {
  const headers = request.headers;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = headers.get("x-forwarded-for")?.trim();
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    if (first) {
      return first;
    }
  }

  const fallbackHeaders = [
    "x-client-ip",
    "cf-connecting-ip",
    "true-client-ip",
    "x-forwarded",
  ];

  for (const headerName of fallbackHeaders) {
    const value = headers.get(headerName)?.trim();
    if (value) {
      return value;
    }
  }

  return "0.0.0.0";
}

function getVisitorSecret() {
  const configuredSecret = process.env.GUEST_QUOTA_VISITOR_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const cloudbaseSecret = process.env.CLOUDBASE_SECRET_KEY?.trim();
  if (cloudbaseSecret) {
    return cloudbaseSecret;
  }

  const supabaseSecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (supabaseSecret) {
    return supabaseSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "生产环境缺少游客额度签名密钥：请配置 GUEST_QUOTA_VISITOR_SECRET。",
    );
  }

  return "mvp5-guest-quota-dev-secret";
}

function buildVisitorKeyHash(input: {
  visitorId: string;
  clientIp: string;
  userAgent: string;
}) {
  const payload =
    input.clientIp && input.clientIp !== "0.0.0.0"
      ? `${input.clientIp}|${input.userAgent}`
      : `${input.visitorId}|${input.userAgent}`;
  return createHmac("sha256", getVisitorSecret()).update(payload).digest("hex");
}

function resolveGuestQuotaContext(request: Request): GuestQuotaContext {
  const cookieMap = parseCookieMap(request.headers.get("cookie"));
  const existingVisitorId = cookieMap.get(GUEST_VISITOR_COOKIE_NAME)?.trim();
  const visitorId = existingVisitorId || randomUUID().replace(/-/g, "");

  const setCookieHeader = existingVisitorId
    ? undefined
    : serializeCookie(GUEST_VISITOR_COOKIE_NAME, visitorId);

  const monthKey = getMonthKey();
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.trim() || "unknown";

  return {
    monthKey,
    visitorKeyHash: buildVisitorKeyHash({
      visitorId,
      clientIp,
      userAgent,
    }),
    setCookieHeader,
  };
}

function ensureSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error("Supabase 管理客户端未配置，无法执行游客额度校验。");
  }

  return supabaseAdmin;
}

function buildSnapshot(input: {
  monthKey: string;
  used: number;
  limit: number;
  remaining?: number;
}): GuestQuotaSnapshot {
  const limit = Math.max(0, input.limit);
  const used = Math.max(0, input.used);
  const remaining =
    input.remaining === undefined
      ? Math.max(0, limit - used)
      : Math.max(0, input.remaining);

  return {
    monthKey: input.monthKey,
    limit,
    used,
    remaining,
  };
}

function buildCloudBaseQuotaDocId(monthKey: string, visitorKeyHash: string) {
  return `gq_${createHash("sha256")
    .update(`${monthKey}:${visitorKeyHash}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function normalizeCloudBaseDoc(data: unknown): CloudBaseGuestQuotaDoc | null {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object") {
      return first as CloudBaseGuestQuotaDoc;
    }
    return null;
  }

  if (data && typeof data === "object") {
    return data as CloudBaseGuestQuotaDoc;
  }

  return null;
}

function getCloudBaseUpdatedCount(result: unknown) {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const payload = result as Record<string, unknown>;
  const direct = toSafeInt(payload.updated, 0);
  if (direct > 0) {
    return direct;
  }

  const stats =
    payload.stats && typeof payload.stats === "object"
      ? (payload.stats as Record<string, unknown>)
      : null;
  if (stats) {
    const updated = toSafeInt(stats.updated, 0);
    if (updated > 0) {
      return updated;
    }
  }

  const innerResult =
    payload.result && typeof payload.result === "object"
      ? (payload.result as Record<string, unknown>)
      : null;
  if (innerResult) {
    const updated = toSafeInt(innerResult.updated, 0);
    if (updated > 0) {
      return updated;
    }
  }

  return 0;
}

function isCloudBaseCollectionMissingError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("collection_not_exist") ||
    message.includes("db or table not exist") ||
    message.includes("database_collection_not_exist")
  );
}

function isCloudBaseDuplicateKeyError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("duplicate key");
}

async function ensureCloudBaseQuotaCollection(db: any) {
  if (cloudbaseCollectionReady) {
    return;
  }

  if (cloudbaseCollectionInitPromise) {
    await cloudbaseCollectionInitPromise;
    return;
  }

  cloudbaseCollectionInitPromise = (async () => {
    try {
      await db.collection(CLOUDBASE_GUEST_QUOTA_COLLECTION).limit(1).get();
    } catch (error) {
      if (!isCloudBaseCollectionMissingError(error)) {
        throw error;
      }

      if (typeof db.createCollection !== "function") {
        throw new Error(
          "CloudBase 不支持自动建集合，请手动创建 guest_generation_quotas_cn。",
        );
      }

      await db.createCollection(CLOUDBASE_GUEST_QUOTA_COLLECTION);
    }

    cloudbaseCollectionReady = true;
  })();

  try {
    await cloudbaseCollectionInitPromise;
  } finally {
    cloudbaseCollectionInitPromise = null;
  }
}

async function readCloudBaseQuotaDoc(db: any, docId: string) {
  await ensureCloudBaseQuotaCollection(db);
  const result = await db.collection(CLOUDBASE_GUEST_QUOTA_COLLECTION).doc(docId).get();
  return normalizeCloudBaseDoc(result?.data);
}

async function readGuestQuotaFromCloudBase(request: Request) {
  const db = await getCloudBaseAdminDb();
  const context = resolveGuestQuotaContext(request);
  const currentLimit = getGuestMonthlyLimit();
  const docId = buildCloudBaseQuotaDocId(context.monthKey, context.visitorKeyHash);

  const row = await readCloudBaseQuotaDoc(db, docId);
  const used = Math.max(0, toSafeInt(row?.used_count, 0));

  return {
    snapshot: buildSnapshot({
      monthKey: context.monthKey,
      used,
      limit: currentLimit,
    }),
    setCookieHeader: context.setCookieHeader,
  };
}

async function consumeGuestQuotaFromCloudBase(
  request: Request,
): Promise<ConsumeGuestQuotaResult> {
  const db = await getCloudBaseAdminDb();
  const context = resolveGuestQuotaContext(request);
  const currentLimit = getGuestMonthlyLimit();
  const docId = buildCloudBaseQuotaDocId(context.monthKey, context.visitorKeyHash);
  const nowIso = new Date().toISOString();

  if (currentLimit <= 0) {
    return {
      allowed: false,
      snapshot: buildSnapshot({
        monthKey: context.monthKey,
        used: 0,
        limit: currentLimit,
      }),
      setCookieHeader: context.setCookieHeader,
    };
  }

  await ensureCloudBaseQuotaCollection(db);
  const collection = db.collection(CLOUDBASE_GUEST_QUOTA_COLLECTION);
  const command = db.command;

  for (let attempt = 0; attempt < CLOUDBASE_CONSUME_MAX_RETRIES; attempt += 1) {
    const updateResult = await collection
      .where({
        _id: docId,
        used_count: command.lt(currentLimit),
      })
      .update({
        month_key: context.monthKey,
        visitor_key_hash: context.visitorKeyHash,
        limit_count: currentLimit,
        used_count: command.inc(1),
        last_request_at: nowIso,
        updated_at: nowIso,
      });

    if (getCloudBaseUpdatedCount(updateResult) > 0) {
      const updatedRow = await readCloudBaseQuotaDoc(db, docId);
      const used = Math.max(0, toSafeInt(updatedRow?.used_count, 1));
      const remaining = Math.max(0, currentLimit - used);
      return {
        allowed: used <= currentLimit,
        snapshot: buildSnapshot({
          monthKey: context.monthKey,
          used,
          limit: currentLimit,
          remaining,
        }),
        reservation: {
          backend: "cloudbase",
          monthKey: context.monthKey,
          visitorKeyHash: context.visitorKeyHash,
        },
        setCookieHeader: context.setCookieHeader,
      };
    }

    const existingRow = await readCloudBaseQuotaDoc(db, docId);
    if (existingRow) {
      const used = Math.max(0, toSafeInt(existingRow.used_count, 0));
      if (used >= currentLimit) {
        return {
          allowed: false,
          snapshot: buildSnapshot({
            monthKey: context.monthKey,
            used,
            limit: currentLimit,
          }),
          setCookieHeader: context.setCookieHeader,
        };
      }
    } else {
      try {
        await collection.add({
          _id: docId,
          month_key: context.monthKey,
          visitor_key_hash: context.visitorKeyHash,
          used_count: 1,
          limit_count: currentLimit,
          last_request_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });

        return {
          allowed: true,
          snapshot: buildSnapshot({
            monthKey: context.monthKey,
            used: 1,
            limit: currentLimit,
            remaining: Math.max(0, currentLimit - 1),
          }),
          reservation: {
            backend: "cloudbase",
            monthKey: context.monthKey,
            visitorKeyHash: context.visitorKeyHash,
          },
          setCookieHeader: context.setCookieHeader,
        };
      } catch (error) {
        if (!isCloudBaseDuplicateKeyError(error)) {
          throw new Error(`扣减游客额度失败: ${getErrorMessage(error)}`);
        }
      }
    }
  }

  throw new Error("扣减游客额度失败: CloudBase 并发重试超限。");
}

async function releaseGuestQuotaFromCloudBase(
  reservation: GuestQuotaReservation,
) {
  const db = await getCloudBaseAdminDb();
  await ensureCloudBaseQuotaCollection(db);

  const currentLimit = getGuestMonthlyLimit();
  const docId = buildCloudBaseQuotaDocId(
    reservation.monthKey,
    reservation.visitorKeyHash,
  );
  const nowIso = new Date().toISOString();
  const command = db.command;

  await db
    .collection(CLOUDBASE_GUEST_QUOTA_COLLECTION)
    .where({
      _id: docId,
      used_count: command.gt(0),
    })
    .update({
      limit_count: currentLimit,
      used_count: command.inc(-1),
      updated_at: nowIso,
    });

  const row = await readCloudBaseQuotaDoc(db, docId);
  if (!row) {
    return null;
  }

  const used = Math.max(0, toSafeInt(row.used_count, 0));
  return buildSnapshot({
    monthKey: reservation.monthKey,
    used,
    limit: currentLimit,
  });
}

async function readGuestQuotaFromSupabase(request: Request) {
  const admin = ensureSupabaseAdmin();
  const context = resolveGuestQuotaContext(request);
  const currentLimit = getGuestMonthlyLimit();

  const { data, error } = await admin
    .from("guest_generation_quotas")
    .select("used_count")
    .eq("month_key", context.monthKey)
    .eq("visitor_key_hash", context.visitorKeyHash)
    .maybeSingle();

  if (error) {
    throw new Error(`读取游客额度失败: ${error.message}`);
  }

  const row = data as GuestQuotaRow | null;
  const used = Math.max(0, toSafeInt(row?.used_count, 0));

  return {
    snapshot: buildSnapshot({
      monthKey: context.monthKey,
      used,
      limit: currentLimit,
    }),
    setCookieHeader: context.setCookieHeader,
  };
}

async function consumeGuestQuotaFromSupabase(
  request: Request,
): Promise<ConsumeGuestQuotaResult> {
  const admin = ensureSupabaseAdmin();
  const context = resolveGuestQuotaContext(request);
  const currentLimit = getGuestMonthlyLimit();

  const { data, error } = await admin.rpc("consume_guest_generation_quota", {
    p_month_key: context.monthKey,
    p_visitor_key_hash: context.visitorKeyHash,
    p_limit_count: currentLimit,
  });

  if (error) {
    throw new Error(`扣减游客额度失败: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | ConsumeGuestQuotaRow
    | undefined;

  if (!row) {
    throw new Error("扣减游客额度失败: 返回结果为空。");
  }

  const used = Math.max(0, toSafeInt(row.used_count, 0));
  const limit = Math.max(0, toSafeInt(row.limit_count, currentLimit));
  const remaining = Math.max(0, toSafeInt(row.remaining_count, limit - used));
  const allowed =
    typeof row.allowed === "boolean" ? row.allowed : limit > 0 && used <= limit;

  return {
    allowed,
    snapshot: buildSnapshot({
      monthKey: context.monthKey,
      used,
      limit,
      remaining,
    }),
    reservation: allowed
      ? {
          backend: "supabase",
          monthKey: context.monthKey,
          visitorKeyHash: context.visitorKeyHash,
        }
      : undefined,
    setCookieHeader: context.setCookieHeader,
  };
}

async function releaseGuestQuotaFromSupabase(
  reservation: GuestQuotaReservation,
) {
  const admin = ensureSupabaseAdmin();

  const { data, error } = await admin.rpc("release_guest_generation_quota", {
    p_month_key: reservation.monthKey,
    p_visitor_key_hash: reservation.visitorKeyHash,
    p_decrement: 1,
  });

  if (error) {
    throw new Error(`回滚游客额度失败: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | ReleaseGuestQuotaRow
    | undefined;

  if (!row) {
    return null;
  }

  const used = Math.max(0, toSafeInt(row.used_count, 0));
  const limit = Math.max(0, toSafeInt(row.limit_count, getGuestMonthlyLimit()));
  const remaining = Math.max(0, toSafeInt(row.remaining_count, limit - used));

  return buildSnapshot({
    monthKey: reservation.monthKey,
    used,
    limit,
    remaining,
  });
}

export async function readGuestGenerationQuota(request: Request) {
  const backend = resolveGuestQuotaBackend();
  if (backend === "cloudbase") {
    return readGuestQuotaFromCloudBase(request);
  }
  return readGuestQuotaFromSupabase(request);
}

export async function consumeGuestGenerationQuota(
  request: Request,
): Promise<ConsumeGuestQuotaResult> {
  const backend = resolveGuestQuotaBackend();
  if (backend === "cloudbase") {
    return consumeGuestQuotaFromCloudBase(request);
  }
  return consumeGuestQuotaFromSupabase(request);
}

export async function releaseGuestGenerationQuota(
  reservation: GuestQuotaReservation,
) {
  if (reservation.backend === "cloudbase") {
    return releaseGuestQuotaFromCloudBase(reservation);
  }
  return releaseGuestQuotaFromSupabase(reservation);
}
