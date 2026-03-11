import { randomUUID } from "node:crypto";
import {
  getRoutedRuntimeDbClient,
  resolveBackendFromLanguage,
} from "@/lib/server/database-routing";

export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = new Set([
  "signup_verification_email_request",
  "signup_verification_email_resend",
  "signup_verification_email_confirmed",
  "password_reset_email_request",
]);

type DeliveryStatus = "accepted" | "failed";

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  const email = normalizeOptionalText(value, 320);
  return email ? email.toLowerCase() : null;
}

function readClientIp(request: Request) {
  const raw =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

function createSecurityEventId() {
  return `security_event_${randomUUID().replace(/-/g, "")}`;
}

function mapRuntimeSource() {
  return resolveBackendFromLanguage() === "cloudbase" ? "cn" : "global";
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

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const action = normalizeOptionalText(payload.action, 64);
    const status = normalizeOptionalText(payload.status, 16) as DeliveryStatus | null;

    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return Response.json({ message: "无效的日志动作。" }, { status: 400 });
    }
    if (status !== "accepted" && status !== "failed") {
      return Response.json({ message: "无效的日志状态。" }, { status: 400 });
    }

    const db = await getRoutedRuntimeDbClient();
    if (!db) {
      return Response.json(
        { message: "日志服务未就绪。", logged: false },
        { status: 202 },
      );
    }

    const email = normalizeEmail(payload.email);
    const userId = normalizeOptionalText(payload.userId, 64);
    const requestId = normalizeOptionalText(payload.requestId, 64);
    const detail = normalizeOptionalText(payload.detail, 800);
    const source = mapRuntimeSource();
    const createdAt =
      source === "cn"
        ? formatUtcDateTimeForSql(new Date())
        : new Date().toISOString();

    await db.from("user_security_events").insert({
      id: createSecurityEventId(),
      user_id: userId || null,
      source,
      event_type: action,
      provider: "supabase_email",
      success: status === "accepted",
      ip_address: readClientIp(req),
      user_agent: req.headers.get("user-agent") || null,
      detail_json: {
        status,
        email,
        request_id: requestId,
        detail,
      },
      created_at: createdAt,
    });

    return Response.json({ logged: true });
  } catch (error) {
    console.error("[EmailDeliveryLog] 写入失败:", error);
    return Response.json(
      { message: "写入投递日志失败。", logged: false },
      { status: 500 },
    );
  }
}
