"use server";

import { requireAdminContext, writeAdminAuditLog } from "@/actions/admin-common";

export type AdminOrder = {
  id: string;
  order_no: string;
  user_id: string | null;
  user_email?: string | null;
  source: string;
  order_type: string;
  product_name: string;
  plan_code: string | null;
  billing_period: string | null;
  amount: number;
  currency: string;
  original_amount: number | null;
  discount_amount: number | null;
  payment_provider: string | null;
  payment_method: string | null;
  payment_status: string;
  paid_at: string | null;
  provider_order_id: string | null;
  provider_transaction_id: string | null;
  risk_score: number;
  risk_level: string;
  risk_factors_json: unknown;
  ip_address: string | null;
  device_fingerprint: string | null;
  user_agent: string | null;
  country_code: string | null;
  region_name: string | null;
  city: string | null;
  refund_status: string | null;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderFilters = {
  source?: string;
  payment_status?: string;
  risk_level?: string;
  payment_provider?: string;
  payment_method?: string;
  search?: string;
  page?: number;
  limit?: number;
  start_date?: string;
  end_date?: string;
};

export type OrdersResult = {
  orders: AdminOrder[];
  total: number;
  page: number;
  limit: number;
};

export type Order = {
  id: string;
  order_no: string;
  user_id?: string;
  user_email?: string;
  product_name: string;
  product_type: string;
  plan?: string;
  period?: string;
  amount: number;
  currency: string;
  original_amount?: number;
  discount_amount?: number;
  payment_method?: string;
  payment_status: string;
  paid_at?: string;
  provider_order_id?: string;
  provider_transaction_id?: string;
  risk_score: number;
  risk_level: string;
  risk_factors?: unknown[];
  ip_address?: string;
  device_fingerprint?: string;
  user_agent?: string;
  country?: string;
  region_name?: string;
  city?: string;
  source: "global" | "cn";
  refund_status?: string;
  refund_amount?: number;
  refund_reason?: string;
  refunded_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

const EMPTY_ORDER_STATS = {
  total: 0,
  paid: 0,
  pending: 0,
  failed: 0,
  totalAmount: 0,
  highRisk: 0,
};

function normalizeSource(source: string | null | undefined): "global" | "cn" {
  return source === "cn" ? "cn" : "global";
}

function mapPaymentMethod(
  paymentProvider: string | null | undefined,
  paymentMethod: string | null | undefined,
) {
  const provider = String(paymentProvider || "").toLowerCase();
  if (provider === "wechat_pay") return "wechat";
  if (provider === "alipay") return "alipay";
  if (provider === "stripe") return "stripe";
  if (provider === "paypal") return "paypal";

  const method = String(paymentMethod || "").toLowerCase();
  if (method === "wechat_pay") return "wechat";
  return paymentMethod || paymentProvider || undefined;
}

function mapAdminOrder(
  order: AdminOrder,
  emailByUserId: Map<string, string>,
): Order {
  const uid = order.user_id || undefined;
  const source = normalizeSource(order.source);
  return {
    id: order.id,
    order_no: order.order_no,
    user_id: uid,
    user_email: order.user_email || (uid ? emailByUserId.get(uid) : undefined),
    product_name: order.product_name,
    product_type: order.order_type,
    plan: order.plan_code || undefined,
    period: order.billing_period || undefined,
    amount: Number(order.amount || 0),
    currency: order.currency || "USD",
    original_amount: order.original_amount ?? undefined,
    discount_amount: order.discount_amount ?? undefined,
    payment_method: mapPaymentMethod(order.payment_provider, order.payment_method),
    payment_status: order.payment_status,
    paid_at: order.paid_at || undefined,
    provider_order_id: order.provider_order_id || undefined,
    provider_transaction_id: order.provider_transaction_id || undefined,
    risk_score: Number(order.risk_score || 0),
    risk_level: order.risk_level || "low",
    risk_factors: Array.isArray(order.risk_factors_json) ? order.risk_factors_json : undefined,
    ip_address: order.ip_address || undefined,
    device_fingerprint: order.device_fingerprint || undefined,
    user_agent: order.user_agent || undefined,
    country: order.country_code || undefined,
    region_name: order.region_name || undefined,
    city: order.city || undefined,
    source,
    refund_status: order.refund_status || undefined,
    refund_amount: order.refund_amount ?? undefined,
    refund_reason: order.refund_reason || undefined,
    refunded_at: order.refunded_at || undefined,
    notes: order.notes || undefined,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

export async function getAdminOrders(filters: OrderFilters = {}): Promise<OrdersResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { orders: [], total: 0, page: 1, limit: 20 };
  }

  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 20)));
  const offset = (page - 1) * limit;

  let query = db
    .from("orders")
    .select("*", { count: "exact" })
    .eq("source", sourceScope)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.payment_status && filters.payment_status !== "all") {
    query = query.eq("payment_status", filters.payment_status);
  }
  if (filters.risk_level && filters.risk_level !== "all") {
    query = query.eq("risk_level", filters.risk_level);
  }
  const paymentProviderFilter = (filters.payment_provider || filters.payment_method || "").trim();
  if (paymentProviderFilter && paymentProviderFilter !== "all") {
    const normalized = paymentProviderFilter === "wechat" ? "wechat_pay" : paymentProviderFilter;
    query = query.eq("payment_provider", normalized);
  }
  if (filters.start_date) {
    query = query.gte("created_at", filters.start_date);
  }
  if (filters.end_date) {
    query = query.lte("created_at", filters.end_date);
  }
  if (filters.search) {
    const s = filters.search.trim();
    if (s) {
      const { data: matchedUsers } = await db
        .from("app_users")
        .select("id")
        .eq("source", sourceScope)
        .or(`email.ilike.%${s}%,display_name.ilike.%${s}%`)
        .limit(200);

      const searchParts = [
        `order_no.ilike.%${s}%`,
        `product_name.ilike.%${s}%`,
        `provider_order_id.ilike.%${s}%`,
        `provider_transaction_id.ilike.%${s}%`,
        `user_id.ilike.%${s}%`,
      ];
      const matchedUserIds = ((matchedUsers || []) as Array<{ id?: string | null }>)
        .map((user) => user.id)
        .filter(Boolean);
      if (matchedUserIds.length > 0) {
        searchParts.push(`user_id.in.(${matchedUserIds.join(",")})`);
      }
      query = query.or(
        searchParts.join(","),
      );
    }
  }

  const { data, error, count } = await query;
  if (error) {
    return { orders: [], total: 0, page, limit };
  }

  return {
    orders: (data || []) as AdminOrder[],
    total: count || 0,
    page,
    limit,
  };
}

export async function getAdminOrderStats(source: "all" | "global" | "cn" = "all") {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return {
      total: 0,
      paid: 0,
      pending: 0,
      failed: 0,
      refunded: 0,
      totalAmount: 0,
      highRisk: 0,
    };
  }

  const query = db
    .from("orders")
    .select("source, payment_status, amount, risk_level")
    .eq("source", sourceScope);

  const { data, error } = await query;
  if (error) {
    return {
      total: 0,
      paid: 0,
      pending: 0,
      failed: 0,
      refunded: 0,
      totalAmount: 0,
      highRisk: 0,
    };
  }

  const rows = (data || []) as Array<{
    payment_status?: string | null;
    amount?: number | string | null;
    risk_level?: string | null;
  }>;
  return {
    total: rows.length,
    paid: rows.filter((row) => row.payment_status === "paid").length,
    pending: rows.filter((row) => row.payment_status === "pending").length,
    failed: rows.filter((row) =>
      ["failed", "canceled", "cancelled"].includes(row.payment_status || ""),
    ).length,
    refunded: rows.filter((row) => row.payment_status === "refunded").length,
    totalAmount: rows
      .filter((row) => row.payment_status === "paid")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    highRisk: rows.filter((row) => ["high", "blocked"].includes(row.risk_level || "")).length,
  };
}

export async function updateAdminOrderNotes(orderId: string, notes: string) {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("orders")
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "更新备注失败" };
  }

  await writeAdminAuditLog({
    action: "update_order_notes",
    targetType: "orders",
    targetId: orderId,
    source: sourceScope,
    afterJson: { notes: notes.trim() || null },
  });

  return { success: true };
}

export async function updateAdminOrderRisk(
  orderId: string,
  riskLevel: string,
  riskScore?: number,
) {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const payload: Record<string, unknown> = {
    risk_level: riskLevel,
    updated_at: new Date().toISOString(),
  };
  if (typeof riskScore === "number" && Number.isFinite(riskScore)) {
    payload.risk_score = riskScore;
  }

  const { error } = await db
    .from("orders")
    .update(payload)
    .eq("id", orderId)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "更新风控失败" };
  }

  await writeAdminAuditLog({
    action: "update_order_risk",
    targetType: "orders",
    targetId: orderId,
    source: sourceScope,
    afterJson: payload,
  });

  return { success: true };
}

export async function getOrders(filters: OrderFilters = {}): Promise<{
  orders: Order[];
  total: number;
  page: number;
  limit: number;
}> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { orders: [], total: 0, page: 1, limit: Number(filters.limit || 20) || 20 };
  }

  if (filters.source && filters.source !== "all" && filters.source !== sourceScope) {
    return {
      orders: [],
      total: 0,
      page: Math.max(1, Number(filters.page || 1)),
      limit: Math.max(1, Number(filters.limit || 20)),
    };
  }

  const result = await getAdminOrders({
    ...filters,
    source: sourceScope,
  });

  const userIds = Array.from(
    new Set(
      result.orders
        .map((order) => order.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await db
      .from("app_users")
      .select("id,email,source")
      .in("id", userIds)
      .eq("source", sourceScope);
    for (const row of data || []) {
      if (row?.id && row?.email) {
        emailByUserId.set(row.id, row.email);
      }
    }
  }

  return {
    orders: result.orders.map((order) => mapAdminOrder(order, emailByUserId)),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}

export async function getOrderStats(source: string = "all") {
  const { sourceScope } = await requireAdminContext();
  if (source !== "all" && source !== sourceScope) {
    return EMPTY_ORDER_STATS;
  }
  return getAdminOrderStats(sourceScope as "global" | "cn");
}

export async function updateOrderNotes(
  id: string,
  notes: string,
  source?: string,
): Promise<{ success: boolean; error?: string }> {
  const { sourceScope } = await requireAdminContext();
  if (source && source !== sourceScope) {
    return { success: false, error: "当前环境禁止跨源操作" };
  }
  const result = await updateAdminOrderNotes(id, notes);
  return {
    success: result.success,
    error: result.error,
  };
}

export async function updateOrderRiskLevel(
  id: string,
  risk_level: string,
  risk_score?: number,
  source?: string,
): Promise<{ success: boolean; error?: string }> {
  const { sourceScope } = await requireAdminContext();
  if (source && source !== sourceScope) {
    return { success: false, error: "当前环境禁止跨源操作" };
  }
  const result = await updateAdminOrderRisk(id, risk_level, risk_score);
  return {
    success: result.success,
    error: result.error,
  };
}
