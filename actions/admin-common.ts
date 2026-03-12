import { randomUUID } from "node:crypto";
import { type AdminSession, getAdminSession } from "@/lib/admin/session";
import { getAdminSourceScope } from "@/lib/admin/source-scope";
import { getRoutedAdminDbClient } from "@/lib/server/database-routing";

export type AdminActionResult<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
};

export async function requireAdminContext() {
  const session = await getAdminSession();
  const sourceScope = getAdminSourceScope();
  const db = await getRoutedAdminDbClient(sourceScope);
  if (!session) {
    return { session: null, db: null, sourceScope };
  }
  if (!db) {
    return { session, db: null, sourceScope };
  }
  return { session, db, sourceScope };
}

export function createTextId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function parseIntOr(input: string | number | null | undefined, fallback: number) {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isFinite(value) ? value : fallback;
}

export function parseDecimalOr(input: string | number | null | undefined, fallback: number) {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isFinite(value) ? value : fallback;
}

async function findAdminUserId(
  db: any,
  field: "id" | "username",
  value: string | null | undefined,
) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  try {
    const { data, error } = await db
      .from("admin_users")
      .select("id")
      .eq(field, normalizedValue)
      .maybeSingle();

    if (error) {
      console.warn(`[AdminAudit] 查询管理员记录失败（${field}=${normalizedValue}）:`, error);
      return null;
    }

    return typeof data?.id === "string" && data.id.trim() ? data.id : null;
  } catch (error) {
    console.warn(`[AdminAudit] 查询管理员记录异常（${field}=${normalizedValue}）:`, error);
    return null;
  }
}

async function resolveAdminAuditUserId(db: any, session: AdminSession) {
  const byId = await findAdminUserId(db, "id", session.userId);
  if (byId) {
    return byId;
  }

  const byUsername = await findAdminUserId(db, "username", session.username);
  if (byUsername) {
    return byUsername;
  }

  console.warn("[AdminAudit] 当前管理员未在后台库中找到对应记录，将降级为匿名审计日志写入。", {
    sessionUserId: session.userId,
    sessionUsername: session.username,
  });
  return null;
}

export async function writeAdminAuditLog(params: {
  action: string;
  targetType: string;
  targetId?: string | null;
  source?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
}) {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return;
  }

  try {
    const adminUserId = await resolveAdminAuditUserId(db, session);
    const { error } = await db.from("admin_audit_logs").insert({
      id: createTextId("audit"),
      admin_user_id: adminUserId,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId || null,
      source: params.source || sourceScope,
      before_json: params.beforeJson ?? null,
      after_json: params.afterJson ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[AdminAudit] 写入审计日志失败，已跳过，不影响主流程。", {
      sourceScope,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId || null,
      error,
    });
  }
}
