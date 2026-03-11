"use client";

type AnalyticsSource = "cn" | "global";

export type TrackAnalyticsClientInput = {
  source?: AnalyticsSource;
  userId?: string | null;
  eventType: string;
  eventName?: string;
  pagePath?: string;
  relatedTaskId?: string;
  relatedOrderId?: string;
  eventValue?: number;
  eventData?: Record<string, unknown>;
  ensureSession?: boolean;
  sessionScope?: string;
};

const STORAGE_KEY_PREFIX = "mvp5_analytics_session";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sess_client_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `sess_client_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeScope(scope?: string) {
  const normalized = (scope || "default").trim();
  return normalized || "default";
}

function safeReadStorage(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

export function getOrCreateAnalyticsSessionId(scope?: string, userId?: string | null) {
  if (typeof window === "undefined") {
    return null;
  }

  const scopeKey = normalizeScope(scope);
  const storageKey = `${STORAGE_KEY_PREFIX}:${scopeKey}`;
  const today = getTodayKey();
  const normalizedUserId = (userId || "").trim() || null;

  const cached = safeReadStorage(storageKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as {
        sessionId?: string;
        date?: string;
        userId?: string | null;
      };

      const cachedId = typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";
      const cachedDate = typeof parsed.date === "string" ? parsed.date.trim() : "";
      const cachedUserId =
        typeof parsed.userId === "string" && parsed.userId.trim()
          ? parsed.userId.trim()
          : null;

      if (
        cachedId &&
        cachedDate === today &&
        cachedUserId === normalizedUserId
      ) {
        return cachedId;
      }
    } catch {
      // ignore invalid payload and regenerate
    }
  }

  const sessionId = createRandomId();
  safeWriteStorage(
    storageKey,
    JSON.stringify({
      sessionId,
      date: today,
      userId: normalizedUserId,
    }),
  );
  return sessionId;
}

export async function trackAnalyticsClient(input: TrackAnalyticsClientInput) {
  if (typeof window === "undefined") {
    return;
  }

  const ensureSession =
    typeof input.ensureSession === "boolean" ? input.ensureSession : true;
  const sessionId = ensureSession
    ? getOrCreateAnalyticsSessionId(input.sessionScope, input.userId)
    : null;

  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      cache: "no-store",
      body: JSON.stringify({
        source: input.source,
        userId: input.userId || null,
        sessionId,
        ensureSession,
        eventType: input.eventType,
        eventName: input.eventName,
        pagePath: input.pagePath || window.location.pathname,
        relatedTaskId: input.relatedTaskId,
        relatedOrderId: input.relatedOrderId,
        eventValue: input.eventValue,
        eventData: input.eventData || null,
      }),
    });
  } catch (error) {
    console.warn("[analytics-client] track failed:", error);
  }
}
