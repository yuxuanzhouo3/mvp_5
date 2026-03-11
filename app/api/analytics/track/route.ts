import { NextRequest, NextResponse } from "next/server";
import {
  extractRequestAnalyticsMeta,
  resolveAnalyticsSource,
  trackAnalyticsSessionEvent,
  type AnalyticsSource,
} from "@/lib/analytics/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const MAX_EVENT_DATA_SIZE = 10 * 1024;
const requestRateMap = new Map<string, { count: number; resetAt: number }>();

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

function normalizeSource(input: unknown): AnalyticsSource | undefined {
  const value = normalizeText(input, 16)?.toLowerCase();
  if (value === "cn" || value === "global") {
    return value;
  }
  return undefined;
}

function normalizeEventData(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  try {
    const serialized = JSON.stringify(input);
    if (serialized.length > MAX_EVENT_DATA_SIZE) {
      return null;
    }
    return input as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeEventValue(input: unknown) {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function readClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstIp = forwardedFor
    .split(",")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || firstIp || "0.0.0.0";
}

function isRateLimited(clientIp: string) {
  const now = Date.now();
  const current = requestRateMap.get(clientIp);
  if (!current || now >= current.resetAt) {
    requestRateMap.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(request: NextRequest) {
  const clientIp = readClientIp(request);
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { message: "Too many requests" },
      { status: 429 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const eventType = normalizeText(payload.eventType, 64);
  if (!eventType) {
    return NextResponse.json(
      { message: "eventType is required" },
      { status: 400 },
    );
  }

  const requestedSource = normalizeSource(payload.source);
  const runtimeSource = resolveAnalyticsSource();
  if (requestedSource && requestedSource !== runtimeSource) {
    return NextResponse.json(
      { message: "source 与当前运行版本不一致" },
      { status: 403 },
    );
  }
  const source = runtimeSource;
  const eventData = normalizeEventData(payload.eventData);
  if (payload.eventData && !eventData) {
    return NextResponse.json(
      { message: "eventData must be an object with <=10KB serialized size" },
      { status: 400 },
    );
  }

  const userId = normalizeText(payload.userId, 64);
  const sessionId = normalizeText(payload.sessionId, 128);
  const ensureSession =
    typeof payload.ensureSession === "boolean" ? payload.ensureSession : true;

  try {
    const meta = extractRequestAnalyticsMeta(request);
    const resolvedSessionId = await trackAnalyticsSessionEvent({
      source,
      userId,
      sessionId,
      ensureSession,
      eventType,
      eventName: normalizeText(payload.eventName, 128),
      pagePath: normalizeText(payload.pagePath, 255),
      relatedTaskId: normalizeText(payload.relatedTaskId, 64),
      relatedOrderId: normalizeText(payload.relatedOrderId, 64),
      eventValue: normalizeEventValue(payload.eventValue),
      eventData: eventData || undefined,
      meta,
    });

    return NextResponse.json({
      success: true,
      source,
      sessionId: resolvedSessionId,
    });
  } catch (error) {
    console.error("[api/analytics/track] write failed:", error);
    return NextResponse.json(
      { message: "Track event failed" },
      { status: 500 },
    );
  }
}
