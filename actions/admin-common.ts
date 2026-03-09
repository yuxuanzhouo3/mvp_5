import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin/session";
import { getAdminSourceScope } from "@/lib/admin/source-scope";

export type AdminActionResult<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
};

export async function requireAdminContext() {
  const session = await getAdminSession();
  const sourceScope = getAdminSourceScope();
  if (!session) {
    return { session: null, db: null, sourceScope };
  }
  if (!supabaseAdmin) {
    return { session, db: null, sourceScope };
  }
  return { session, db: supabaseAdmin, sourceScope };
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

export async function writeAdminAuditLog(params: {
  action: string;
  targetType: string;
  targetId?: string | null;
  source?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
}) {
  const { session, db } = await requireAdminContext();
  if (!session || !db) {
    return;
  }

  await db.from("admin_audit_logs").insert({
    id: createTextId("audit"),
    admin_user_id: session.userId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId || null,
    source: params.source || null,
    before_json: params.beforeJson ?? null,
    after_json: params.afterJson ?? null,
    created_at: new Date().toISOString(),
  });
}
