import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  getRoutedRuntimeDbClient,
  resolveBackendFromLanguage,
} from "@/lib/server/database-routing";

export type AnalyticsSource = "cn" | "global";

export type AnalyticsRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  referrer?: string | null;
  appVersion?: string | null;
  deviceType?: string | null;
  os?: string | null;
  browser?: string | null;
};

type TrackSessionInput = {
  source?: AnalyticsSource;
  userId?: string | null;
  sessionId?: string | null;
  startedAt?: string | null;
  meta?: AnalyticsRequestMeta;
};

type TrackEventInput = {
  source?: AnalyticsSource;
  userId?: string | null;
  sessionId?: string | null;
  eventType: string;
  eventName?: string | null;
  pagePath?: string | null;
  relatedTaskId?: string | null;
  relatedOrderId?: string | null;
  eventValue?: number | null;
  eventData?: Record<string, unknown> | null;
  createdAt?: string | null;
  meta?: AnalyticsRequestMeta;
};

type TrackSessionEventInput = TrackEventInput & {
  ensureSession?: boolean;
};

const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  process.env.APP_VERSION?.trim() ||
  null;

function formatUtcDateTimeForSql(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toSourceDateTime(value: string | null | undefined, source: AnalyticsSource) {
  const normalized = normalizeText(value, 64);
  if (source !== "cn") {
    return normalized || new Date().toISOString();
  }

  const parsed = normalized ? new Date(normalized) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return formatUtcDateTimeForSql(new Date());
  }

  return formatUtcDateTimeForSql(parsed);
}

function normalizeText(input: unknown, maxLength: number) {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeOptionalNumber(input: unknown) {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function getQueryErrorMessage(result: unknown) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const error =
    "error" in result ? (result as { error?: unknown }).error : null;
  if (!error) {
    return null;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    const details = (error as { details?: unknown }).details;
    if (typeof details === "string" && details.trim()) {
      return details.trim();
    }
  }

  return "unknown";
}

function isDuplicateKeyError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("duplicate") ||
    normalized.includes("already exists") ||
    normalized.includes("unique constraint") ||
    normalized.includes("duplicate key") ||
    normalized.includes("23505")
  );
}

function isUserIdForeignKeyError(message: string) {
  const normalized = message.toLowerCase();
  const hasUserId = normalized.includes("user_id");
  if (!hasUserId) {
    return false;
  }
  return (
    normalized.includes("foreign key constraint fails") ||
    normalized.includes("cannot add or update a child row") ||
    normalized.includes("1452") ||
    normalized.includes("ibfk")
  );
}

async function insertRow(tableName: string, row: Record<string, unknown>) {
  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    return;
  }

  const preparedRow =
    db.backend === "cloudbase"
      ? Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            if (value === null || value === undefined) {
              return [key, value];
            }
            if (typeof value === "object") {
              try {
                return [key, JSON.stringify(value)];
              } catch {
                return [key, String(value)];
              }
            }
            return [key, value];
          }),
        )
      : row;

  const result = await db.from(tableName).insert(preparedRow);
  let errorMessage = getQueryErrorMessage(result);

  const userIdValue = preparedRow.user_id;
  const hasUserId =
    userIdValue !== null &&
    userIdValue !== undefined &&
    String(userIdValue).trim().length > 0;
  const canRetryWithoutUserId =
    db.backend === "cloudbase" &&
    hasUserId &&
    Boolean(errorMessage) &&
    isUserIdForeignKeyError(errorMessage!);

  if (canRetryWithoutUserId) {
    const retryResult = await db
      .from(tableName)
      .insert({ ...preparedRow, user_id: null });
    errorMessage = getQueryErrorMessage(retryResult);
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }
}

function readClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstIp = forwardedFor
    .split(",")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  const realIp = request.headers.get("x-real-ip")?.trim();
  const fallbackHeaders = [
    "x-client-ip",
    "cf-connecting-ip",
    "true-client-ip",
  ] as const;

  if (realIp) {
    return realIp;
  }
  if (firstIp) {
    return firstIp;
  }

  for (const header of fallbackHeaders) {
    const value = request.headers.get(header)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function parseUserAgent(userAgent?: string | null) {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) {
    return {
      deviceType: null,
      os: null,
      browser: null,
    };
  }

  const deviceType = /ipad|tablet/.test(ua)
    ? "tablet"
    : /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)
      ? "mobile"
      : "desktop";

  const os = /windows/.test(ua)
    ? "Windows"
    : /macintosh|mac os x/.test(ua)
      ? "macOS"
      : /iphone|ipad|ipod/.test(ua)
        ? "iOS"
        : /android/.test(ua)
          ? "Android"
          : /linux/.test(ua)
            ? "Linux"
            : null;

  const browser = /edg\//.test(ua)
    ? "Edge"
    : /chrome\//.test(ua)
      ? "Chrome"
      : /safari\//.test(ua)
        ? "Safari"
        : /firefox\//.test(ua)
          ? "Firefox"
          : /opera|opr\//.test(ua)
            ? "Opera"
            : null;

  return {
    deviceType,
    os,
    browser,
  };
}

export function resolveAnalyticsSource(source?: AnalyticsSource): AnalyticsSource {
  const runtimeSource =
    resolveBackendFromLanguage() === "cloudbase" ? "cn" : "global";
  if (!source) {
    return runtimeSource;
  }
  return source === runtimeSource ? source : runtimeSource;
}

export function extractRequestAnalyticsMeta(
  request: Request,
  extra?: Partial<AnalyticsRequestMeta>,
): AnalyticsRequestMeta {
  const userAgent = normalizeText(
    extra?.userAgent || request.headers.get("user-agent"),
    1000,
  );
  const parsed = parseUserAgent(userAgent);

  return {
    ipAddress: normalizeText(extra?.ipAddress || readClientIp(request), 64),
    userAgent,
    countryCode: normalizeText(
      extra?.countryCode ||
        request.headers.get("x-vercel-ip-country") ||
        request.headers.get("cf-ipcountry"),
      16,
    ),
    region: normalizeText(extra?.region, 64),
    city: normalizeText(extra?.city, 64),
    referrer: normalizeText(
      extra?.referrer || request.headers.get("referer"),
      255,
    ),
    appVersion: normalizeText(extra?.appVersion || APP_VERSION, 32),
    deviceType: normalizeText(extra?.deviceType || parsed.deviceType, 32),
    os: normalizeText(extra?.os || parsed.os, 32),
    browser: normalizeText(extra?.browser || parsed.browser, 32),
  };
}

export function buildDailySessionId(input: {
  source?: AnalyticsSource;
  userId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  now?: Date;
}) {
  const source = resolveAnalyticsSource(input.source);
  const date = (input.now || new Date()).toISOString().slice(0, 10);
  const seed = [
    source,
    input.userId || "guest",
    date,
    input.userAgent || "",
    input.ipAddress || "",
  ].join("|");
  const fingerprint = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `sess_${date.replace(/-/g, "")}_${fingerprint}`;
}

export async function trackAnalyticsSession(input: TrackSessionInput) {
  const source = resolveAnalyticsSource(input.source);
  const sessionId = normalizeText(input.sessionId, 128);
  if (!sessionId) {
    return null;
  }

  const startedAt = toSourceDateTime(input.startedAt, source);
  const meta = input.meta || {};

  const row: Record<string, unknown> = {
    id: `analytics_session_${randomUUID().replace(/-/g, "")}`,
    user_id: normalizeText(input.userId, 64),
    source,
    session_id: sessionId,
    started_at: startedAt,
    device_type: normalizeText(meta.deviceType, 32),
    os: normalizeText(meta.os, 32),
    browser: normalizeText(meta.browser, 32),
    app_version: normalizeText(meta.appVersion, 32),
    country_code: normalizeText(meta.countryCode, 16),
    region: normalizeText(meta.region, 64),
    city: normalizeText(meta.city, 64),
    ip_address: normalizeText(meta.ipAddress, 64),
    user_agent: normalizeText(meta.userAgent, 1000),
    referrer: normalizeText(meta.referrer, 255),
    created_at: startedAt,
  };

  try {
    await insertRow("analytics_sessions", row);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "track session failed";
    if (!isDuplicateKeyError(message)) {
      throw error;
    }
  }

  return sessionId;
}

export async function trackAnalyticsEvent(input: TrackEventInput) {
  const source = resolveAnalyticsSource(input.source);
  const eventType = normalizeText(input.eventType, 64);
  if (!eventType) {
    return false;
  }

  const createdAt = toSourceDateTime(input.createdAt, source);
  const meta = input.meta || {};

  const row: Record<string, unknown> = {
    id: `analytics_event_${randomUUID().replace(/-/g, "")}`,
    user_id: normalizeText(input.userId, 64),
    source,
    session_id: normalizeText(input.sessionId, 128),
    event_type: eventType,
    event_name: normalizeText(input.eventName, 128),
    page_path: normalizeText(input.pagePath, 255),
    related_task_id: normalizeText(input.relatedTaskId, 64),
    related_order_id: normalizeText(input.relatedOrderId, 64),
    event_value: normalizeOptionalNumber(input.eventValue),
    event_data_json:
      input.eventData && typeof input.eventData === "object"
        ? input.eventData
        : null,
    device_type: normalizeText(meta.deviceType, 32),
    os: normalizeText(meta.os, 32),
    browser: normalizeText(meta.browser, 32),
    app_version: normalizeText(meta.appVersion, 32),
    country_code: normalizeText(meta.countryCode, 16),
    region: normalizeText(meta.region, 64),
    city: normalizeText(meta.city, 64),
    created_at: createdAt,
  };

  await insertRow("analytics_events", row);
  return true;
}

export async function trackAnalyticsSessionEvent(input: TrackSessionEventInput) {
  const source = resolveAnalyticsSource(input.source);
  const eventMeta = input.meta || {};
  const ensureSession = Boolean(input.ensureSession);

  const resolvedSessionId =
    normalizeText(input.sessionId, 128) ||
    (ensureSession
      ? buildDailySessionId({
          source,
          userId: input.userId,
          userAgent: eventMeta.userAgent,
          ipAddress: eventMeta.ipAddress,
        })
      : null);

  if (ensureSession && resolvedSessionId) {
    await trackAnalyticsSession({
      source,
      userId: input.userId,
      sessionId: resolvedSessionId,
      startedAt: input.createdAt,
      meta: eventMeta,
    });
  }

  await trackAnalyticsEvent({
    ...input,
    source,
    sessionId: resolvedSessionId,
  });

  return resolvedSessionId;
}
