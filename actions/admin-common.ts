import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { type AdminSession, getAdminSession } from "@/lib/admin/session";
import { getAdminSourceScope } from "@/lib/admin/source-scope";
import { getRoutedAdminDbClient } from "@/lib/server/database-routing";

export type AdminActionResult<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
};

type AdminAuditLogPayload = {
  action: string;
  targetType: string;
  targetId?: string | null;
  source?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
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

function normalizeAuditText(value: string | null | undefined, maxLength: number) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function readAdminAuditRequestMeta() {
  try {
    const requestHeaders = headers();
    const forwardedFor = requestHeaders.get("x-forwarded-for") || "";
    const firstForwardedIp = forwardedFor
      .split(",")
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    return {
      ipAddress: normalizeAuditText(
        requestHeaders.get("x-real-ip") || firstForwardedIp || null,
        64,
      ),
      userAgent: normalizeAuditText(requestHeaders.get("user-agent"), 1000),
    };
  } catch {
    return {
      ipAddress: null,
      userAgent: null,
    };
  }
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

async function insertAdminAuditLog(input: {
  db: any;
  adminUserId?: string | null;
  source: string | null;
} & AdminAuditLogPayload) {
  const { error } = await input.db.from("admin_audit_logs").insert({
    id: createTextId("audit"),
    admin_user_id: input.adminUserId || null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId || null,
    source: input.source,
    before_json: input.beforeJson ?? null,
    after_json: input.afterJson ?? null,
    ip_address: input.ipAddress || null,
    user_agent: input.userAgent || null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

export async function writeAdminAuditLogWithContext(params: {
  db: any;
  session?: AdminSession | null;
  adminUserId?: string | null;
  sourceScope?: string | null;
} & AdminAuditLogPayload) {
  if (!params.db) {
    return;
  }

  try {
    const adminUserId =
      params.adminUserId !== undefined
        ? params.adminUserId
        : params.session
          ? await resolveAdminAuditUserId(params.db, params.session)
          : null;
    const requestMeta = readAdminAuditRequestMeta();

    await insertAdminAuditLog({
      db: params.db,
      adminUserId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      source: params.source || params.sourceScope || null,
      beforeJson: params.beforeJson,
      afterJson: params.afterJson,
      ipAddress: params.ipAddress ?? requestMeta.ipAddress,
      userAgent: params.userAgent ?? requestMeta.userAgent,
    });
  } catch (error) {
    console.warn("[AdminAudit] 写入审计日志失败，已跳过，不影响主流程。", {
      sourceScope: params.sourceScope || null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId || null,
      error,
    });
  }
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

  await writeAdminAuditLogWithContext({
    db,
    session,
    sourceScope,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    source: params.source,
    beforeJson: params.beforeJson,
    afterJson: params.afterJson,
  });
}
