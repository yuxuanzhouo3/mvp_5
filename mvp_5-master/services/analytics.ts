/**
 * 用户分析服务 - 统一支持国内版 (CloudBase) 和国际版 (Supabase)
 * 用于记录用户行为、登录、注册等事件
 */

import { IS_DOMESTIC_VERSION } from "@/config";
import { CloudBaseConnector } from "@/lib/cloudbase/connector";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { trackAnalyticsSessionEvent } from "@/lib/analytics/tracker";

export type AnalyticsEventType =
  | "session_start"
  | "session_end"
  | "register"
  | "page_view"
  | "feature_use"
  | "payment"
  | "subscription"
  | "error";

export interface AnalyticsEventParams {
  userId: string;
  eventType: AnalyticsEventType;
  source?: "global" | "cn";
  deviceType?: string;
  os?: string;
  browser?: string;
  appVersion?: string;
  screenResolution?: string;
  language?: string;
  country?: string;
  region?: string;
  city?: string;
  eventData?: Record<string, unknown>;
  sessionId?: string;
  referrer?: string;
}

export interface TrackResult {
  success: boolean;
  error?: string;
}

export function parseUserAgent(userAgent?: string): {
  deviceType: string;
  os: string;
  browser: string;
} {
  if (!userAgent) {
    return { deviceType: "unknown", os: "unknown", browser: "unknown" };
  }

  const ua = userAgent.toLowerCase();

  let deviceType = "desktop";
  if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    deviceType = /ipad|tablet/i.test(ua) ? "tablet" : "mobile";
  }

  let os = "unknown";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "unknown";
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/opera|opr/i.test(ua)) browser = "Opera";

  return { deviceType, os, browser };
}

export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function trackUnifiedAnalyticsEvent(params: AnalyticsEventParams): Promise<TrackResult> {
  try {
    await trackAnalyticsSessionEvent({
      source: params.source || (IS_DOMESTIC_VERSION ? "cn" : "global"),
      userId: params.userId,
      sessionId: params.sessionId || undefined,
      ensureSession: params.eventType === "session_start",
      eventType: params.eventType,
      eventData: params.eventData,
      meta: {
        deviceType: params.deviceType,
        os: params.os,
        browser: params.browser,
        appVersion: params.appVersion,
        countryCode: params.country,
        region: params.region,
        city: params.city,
        referrer: params.referrer,
      },
    });

    return { success: true };
  } catch (error) {
    console.warn("[analytics] unified track error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unified analytics tracking failed",
    };
  }
}

export async function trackAnalyticsEvent(params: AnalyticsEventParams): Promise<TrackResult> {
  const normalizedParams: AnalyticsEventParams = {
    ...params,
    source: params.source || (IS_DOMESTIC_VERSION ? "cn" : "global"),
  };

  const legacyResult = IS_DOMESTIC_VERSION
    ? await trackCloudBaseEvent(normalizedParams)
    : await trackSupabaseEvent(normalizedParams);
  const unifiedResult = await trackUnifiedAnalyticsEvent(normalizedParams);

  if (legacyResult.success || unifiedResult.success) {
    return { success: true };
  }

  return {
    success: false,
    error: unifiedResult.error || legacyResult.error || "Analytics tracking failed",
  };
}

async function trackSupabaseEvent(params: AnalyticsEventParams): Promise<TrackResult> {
  if (!supabaseAdmin) {
    return { success: false, error: "supabaseAdmin not available" };
  }

  try {
    const { error } = await supabaseAdmin.from("user_analytics").insert({
      user_id: params.userId,
      source: params.source || "global",
      event_type: params.eventType,
      device_type: params.deviceType || null,
      os: params.os || null,
      browser: params.browser || null,
      app_version: params.appVersion || null,
      screen_resolution: params.screenResolution || null,
      language: params.language || null,
      country: params.country || null,
      region: params.region || null,
      city: params.city || null,
      event_data: params.eventData || {},
      session_id: params.sessionId || null,
      referrer: params.referrer || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[analytics] Supabase insert error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    console.error("[analytics] Supabase track error:", error);
    return { success: false, error: error instanceof Error ? error.message : "记录事件失败" };
  }
}

async function trackCloudBaseEvent(params: AnalyticsEventParams): Promise<TrackResult> {
  try {
    const connector = new CloudBaseConnector();
    await connector.initialize();
    const db = connector.getClient();

    await db.collection("user_analytics").add({
      user_id: params.userId,
      source: params.source || "cn",
      event_type: params.eventType,
      device_type: params.deviceType || null,
      os: params.os || null,
      browser: params.browser || null,
      app_version: params.appVersion || null,
      screen_resolution: params.screenResolution || null,
      language: params.language || null,
      country: params.country || null,
      region: params.region || null,
      city: params.city || null,
      event_data: params.eventData || {},
      session_id: params.sessionId || null,
      referrer: params.referrer || null,
      created_at: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    console.error("[analytics] CloudBase track error:", error);
    return { success: false, error: error instanceof Error ? error.message : "记录事件失败" };
  }
}

export async function trackLoginEvent(
  userId: string,
  options?: {
    userAgent?: string;
    language?: string;
    referrer?: string;
  }
): Promise<TrackResult> {
  const deviceInfo = parseUserAgent(options?.userAgent);

  return trackAnalyticsEvent({
    userId,
    eventType: "session_start",
    ...deviceInfo,
    language: options?.language,
    referrer: options?.referrer,
    sessionId: generateSessionId(),
    eventData: {
      loginMethod: "email",
    },
  });
}

export async function trackRegisterEvent(
  userId: string,
  options?: {
    userAgent?: string;
    language?: string;
    referrer?: string;
    registerMethod?: string;
  }
): Promise<TrackResult> {
  const deviceInfo = parseUserAgent(options?.userAgent);

  return trackAnalyticsEvent({
    userId,
    eventType: "register",
    ...deviceInfo,
    language: options?.language,
    referrer: options?.referrer,
    sessionId: generateSessionId(),
    eventData: {
      registerMethod: options?.registerMethod || "email",
    },
  });
}
