"use server";

import { requireAdminContext } from "@/actions/admin-common";
import { AdminSourceScope, normalizeSource } from "@/lib/admin/source-scope";

export type DashboardStats = {
  users: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
    dau: number;
    wau: number;
    mau: number;
  };
  revenue: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  revenueCny: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  subscriptions: {
    total: number;
    byPlan: Record<string, number>;
    pending: number;
    pendingByPlan: Record<string, number>;
  };
  orders: {
    total: number;
    today: number;
    paid: number;
    pending: number;
    failed: number;
  };
  devices: {
    byOs: Record<string, number>;
    byDeviceType: Record<string, number>;
  };
  analytics: {
    sessionsToday: number;
    sessionsThisMonth: number;
    eventsToday: number;
    eventsThisMonth: number;
    keyEventsThisMonth: {
      register: number;
      sessionStart: number;
      passwordResetRequest: number;
      passwordReset: number;
      generateStart: number;
      generateSuccess: number;
      generateFailed: number;
      paymentSuccess: number;
    };
  };
};

export type DailyUserStat = {
  date: string;
  activeUsers: number;
  newUsers: number;
  generations: number;
};

export type DailyRevenueStat = {
  date: string;
  amount: number;
  amountCny: number;
  orderCount: number;
  payingUsers: number;
};

export type DailyStats = DailyUserStat;
export type RevenueStats = DailyRevenueStat;
type AnalyticsKeyEventCounts = DashboardStats["analytics"]["keyEventsThisMonth"];

type StatsUserRow = {
  source?: string | null;
  id?: string | null;
  created_at?: string | null;
  current_plan_code?: string | null;
  subscription_status?: string | null;
  plan_expires_at?: string | null;
};

type StatsOrderRow = {
  source?: string | null;
  user_id?: string | null;
  amount?: number | string | null;
  payment_status?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  currency?: string | null;
};

type StatsSubscriptionRow = {
  source?: string | null;
  user_id?: string | null;
  plan_code?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

type StatsSessionRow = {
  source?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  os?: string | null;
  device_type?: string | null;
  started_at?: string | null;
};

type StatsEventRow = {
  source?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  event_type?: string | null;
  created_at?: string | null;
  device_type?: string | null;
  os?: string | null;
};

function getDateThresholds() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  return {
    todayMs: todayStart.getTime(),
    weekMs: weekStart.getTime(),
    monthMs: monthStart.getTime(),
  };
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

function toSourceQueryDateTime(date: Date, sourceScope: AdminSourceScope) {
  return sourceScope === "cn"
    ? formatUtcDateTimeForSql(date)
    : date.toISOString();
}

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized);
  const sqlLikeMatch = normalized.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/,
  );

  const parsed = sqlLikeMatch && !hasTimezone
    ? Date.parse(
        `${sqlLikeMatch[1]}T${sqlLikeMatch[2]}${sqlLikeMatch[3] || ""}Z`,
      )
    : Date.parse(normalized);

  return Number.isNaN(parsed) ? null : parsed;
}

function isOnOrAfter(value: string | null | undefined, thresholdMs: number) {
  const timestampMs = toTimestampMs(value);
  return timestampMs !== null && timestampMs >= thresholdMs;
}

function toDateKey(value: string | null | undefined) {
  const timestampMs = toTimestampMs(value);
  if (timestampMs === null) {
    return null;
  }
  return ymd(new Date(timestampMs));
}

function normalizeLowerText(value: string | null | undefined, fallback = "") {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || fallback;
}

function normalizeKeyText(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function buildActorKey(userId?: string | null, sessionId?: string | null) {
  const normalizedUserId = normalizeKeyText(userId);
  if (normalizedUserId) {
    return `user:${normalizedUserId}`;
  }

  const normalizedSessionId = normalizeKeyText(sessionId);
  if (normalizedSessionId) {
    return `session:${normalizedSessionId}`;
  }

  return null;
}

function createEmptyAnalyticsKeyEventCounts(): AnalyticsKeyEventCounts {
  return {
    register: 0,
    sessionStart: 0,
    passwordResetRequest: 0,
    passwordReset: 0,
    generateStart: 0,
    generateSuccess: 0,
    generateFailed: 0,
    paymentSuccess: 0,
  };
}

function accumulateAnalyticsKeyEvent(
  counts: AnalyticsKeyEventCounts,
  eventType: string | null | undefined,
) {
  switch (normalizeLowerText(eventType)) {
    case "register":
      counts.register += 1;
      break;
    case "session_start":
      counts.sessionStart += 1;
      break;
    case "auth_password_reset_request":
      counts.passwordResetRequest += 1;
      break;
    case "auth_password_reset":
      counts.passwordReset += 1;
      break;
    case "generate_start":
      counts.generateStart += 1;
      break;
    case "generate_success":
      counts.generateSuccess += 1;
      break;
    case "generate_failed":
      counts.generateFailed += 1;
      break;
    case "payment_success":
      counts.paymentSuccess += 1;
      break;
    default:
      break;
  }
}

function buildDeviceDistribution(
  sessions: StatsSessionRow[],
  events: StatsEventRow[],
) {
  const snapshots = new Map<
    string,
    { timestampMs: number; os: string | null; deviceType: string | null }
  >();

  const upsertSnapshot = (input: {
    userId?: string | null;
    sessionId?: string | null;
    timestamp?: string | null;
    os?: string | null;
    deviceType?: string | null;
  }) => {
    const actorKey = buildActorKey(input.userId, input.sessionId);
    if (!actorKey) {
      return;
    }

    const timestampMs = toTimestampMs(input.timestamp) ?? 0;
    const nextOs = normalizeKeyText(input.os);
    const nextDeviceType = normalizeKeyText(input.deviceType);
    const current = snapshots.get(actorKey);

    if (!current) {
      snapshots.set(actorKey, {
        timestampMs,
        os: nextOs,
        deviceType: nextDeviceType,
      });
      return;
    }

    const isNewer = timestampMs >= current.timestampMs;
    snapshots.set(actorKey, {
      timestampMs: Math.max(timestampMs, current.timestampMs),
      os: isNewer ? nextOs || current.os : current.os || nextOs,
      deviceType: isNewer
        ? nextDeviceType || current.deviceType
        : current.deviceType || nextDeviceType,
    });
  };

  for (const row of sessions) {
    upsertSnapshot({
      userId: row.user_id,
      sessionId: row.session_id,
      timestamp: row.started_at,
      os: row.os,
      deviceType: row.device_type,
    });
  }

  for (const row of events) {
    upsertSnapshot({
      userId: row.user_id,
      sessionId: row.session_id,
      timestamp: row.created_at,
      os: row.os,
      deviceType: row.device_type,
    });
  }

  const byOs: Record<string, number> = {};
  const byDeviceType: Record<string, number> = {};

  snapshots.forEach((snapshot) => {
    const os = snapshot.os || "unknown";
    const deviceType = normalizeLowerText(snapshot.deviceType, "unknown");
    byOs[os] = (byOs[os] || 0) + 1;
    byDeviceType[deviceType] = (byDeviceType[deviceType] || 0) + 1;
  });

  return {
    byOs,
    byDeviceType,
  };
}

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDateRange<T extends { date: string }>(
  rows: T[],
  days: number,
  factory: (date: string) => T,
) {
  const map = new Map(rows.map((item) => [item.date, item]));
  const list: T[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = ymd(d);
    list.push(map.get(key) || factory(key));
  }

  return list;
}

function withinSourceScope<T extends { source?: string | null }>(
  rows: T[],
  sourceScope: AdminSourceScope,
) {
  return rows.filter((row) => normalizeSource(row.source) === sourceScope);
}

export async function getDashboardStats(
  _source: "all" | "global" | "cn" = "all",
): Promise<DashboardStats | null> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return null;
  }

  const { todayMs, weekMs, monthMs } = getDateThresholds();

  const [usersRows, ordersRows, subsRows, sessionsRows, eventsRows] =
    await Promise.all([
    db
      .from("app_users")
      .select(
        "id, source, current_plan_code, subscription_status, plan_expires_at, created_at",
        { count: "exact" },
      ),
    db
      .from("orders")
      .select("id, source, amount, payment_status, created_at, paid_at, currency"),
    db
      .from("user_subscriptions")
      .select("id, source, user_id, plan_code, status, current_period_end"),
    db
      .from("analytics_sessions")
      .select("source, user_id, session_id, os, device_type, started_at"),
    db
      .from("analytics_events")
      .select("source, user_id, session_id, event_type, created_at, device_type, os"),
    ]);

  if (
    usersRows.error ||
    ordersRows.error ||
    subsRows.error ||
    sessionsRows.error ||
    eventsRows.error
  ) {
    return null;
  }

  const users = withinSourceScope((usersRows.data || []) as StatsUserRow[], sourceScope);
  const orders = withinSourceScope((ordersRows.data || []) as StatsOrderRow[], sourceScope);
  const subscriptions = withinSourceScope(
    (subsRows.data || []) as StatsSubscriptionRow[],
    sourceScope,
  );
  const sessions = withinSourceScope((sessionsRows.data || []) as StatsSessionRow[], sourceScope);
  const events = withinSourceScope((eventsRows.data || []) as StatsEventRow[], sourceScope);

  const userToday = users.filter((u) => isOnOrAfter(u.created_at, todayMs)).length;
  const userWeek = users.filter((u) => isOnOrAfter(u.created_at, weekMs)).length;
  const userMonth = users.filter((u) => isOnOrAfter(u.created_at, monthMs)).length;

  const sessionsMonth = sessions.filter((s) => isOnOrAfter(s.started_at, monthMs));
  const sessionsWeek = sessions.filter((s) => isOnOrAfter(s.started_at, weekMs));
  const sessionsToday = sessions.filter((s) => isOnOrAfter(s.started_at, todayMs));
  const eventsMonth = events.filter((event) => isOnOrAfter(event.created_at, monthMs));
  const eventsWeek = events.filter((event) => isOnOrAfter(event.created_at, weekMs));
  const eventsToday = events.filter((event) => isOnOrAfter(event.created_at, todayMs));

  const activityTodayUsers = new Set<string>();
  const activityWeekUsers = new Set<string>();
  const activityMonthUsers = new Set<string>();

  for (const row of sessionsToday) {
    if (row.user_id) activityTodayUsers.add(row.user_id);
  }
  for (const row of eventsToday) {
    if (row.user_id) activityTodayUsers.add(row.user_id);
  }
  for (const row of sessionsWeek) {
    if (row.user_id) activityWeekUsers.add(row.user_id);
  }
  for (const row of eventsWeek) {
    if (row.user_id) activityWeekUsers.add(row.user_id);
  }
  for (const row of sessionsMonth) {
    if (row.user_id) activityMonthUsers.add(row.user_id);
  }
  for (const row of eventsMonth) {
    if (row.user_id) activityMonthUsers.add(row.user_id);
  }

  const dau = activityTodayUsers.size;
  const wau = activityWeekUsers.size;
  const mau = activityMonthUsers.size;

  const paidOrders = orders.filter((o) => o.payment_status === "paid");
  const revenueRawTotal = paidOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawToday = paidOrders
    .filter((o) => isOnOrAfter(o.paid_at || o.created_at, todayMs))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawWeek = paidOrders
    .filter((o) => isOnOrAfter(o.paid_at || o.created_at, weekMs))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawMonth = paidOrders
    .filter((o) => isOnOrAfter(o.paid_at || o.created_at, monthMs))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const usdRevenue =
    sourceScope === "global"
      ? {
          total: revenueRawTotal,
          today: revenueRawToday,
          thisWeek: revenueRawWeek,
          thisMonth: revenueRawMonth,
        }
      : { total: 0, today: 0, thisWeek: 0, thisMonth: 0 };

  const cnyRevenue =
    sourceScope === "cn"
      ? {
          total: revenueRawTotal,
          today: revenueRawToday,
          thisWeek: revenueRawWeek,
          thisMonth: revenueRawMonth,
        }
      : { total: 0, today: 0, thisWeek: 0, thisMonth: 0 };

  const nowMs = Date.now();
  const currentSubscribedUsers = users.filter((item) => {
    const planCode = normalizeLowerText(item.current_plan_code, "free");
    if (!planCode || planCode === "free") {
      return false;
    }

    const planExpiresMs = toTimestampMs(item.plan_expires_at);
    if (planExpiresMs !== null) {
      return planExpiresMs >= nowMs;
    }

    const subscriptionStatus = normalizeLowerText(item.subscription_status);
    return subscriptionStatus === "active" || subscriptionStatus === "trialing";
  });
  const byPlan: Record<string, number> = {};
  for (const item of currentSubscribedUsers) {
    const plan = normalizeLowerText(item.current_plan_code, "free");
    byPlan[plan] = (byPlan[plan] || 0) + 1;
  }

  const pendingUserIds = new Set<string>();
  const pendingByPlan: Record<string, number> = {};
  const pendingPlanKeys = new Set<string>();
  for (const item of subscriptions) {
    if (normalizeLowerText(item.status) !== "pending") {
      continue;
    }

    const pendingPlan = normalizeLowerText(item.plan_code, "free");
    const pendingUserId = (item.user_id || "").trim();
    if (pendingUserId) {
      pendingUserIds.add(pendingUserId);
    }

    const pendingKey = `${pendingUserId || "unknown"}:${pendingPlan}`;
    if (pendingPlanKeys.has(pendingKey)) {
      continue;
    }
    pendingPlanKeys.add(pendingKey);
    pendingByPlan[pendingPlan] = (pendingByPlan[pendingPlan] || 0) + 1;
  }

  const analyticsKeyEvents = createEmptyAnalyticsKeyEventCounts();
  for (const item of eventsMonth) {
    accumulateAnalyticsKeyEvent(analyticsKeyEvents, item.event_type);
  }

  const devices = buildDeviceDistribution(sessionsMonth, eventsMonth);

  return {
    users: {
      total: users.length,
      today: userToday,
      thisWeek: userWeek,
      thisMonth: userMonth,
      dau,
      wau,
      mau,
    },
    revenue: {
      total: usdRevenue.total,
      today: usdRevenue.today,
      thisWeek: usdRevenue.thisWeek,
      thisMonth: usdRevenue.thisMonth,
    },
    revenueCny: {
      total: cnyRevenue.total,
      today: cnyRevenue.today,
      thisWeek: cnyRevenue.thisWeek,
      thisMonth: cnyRevenue.thisMonth,
    },
    subscriptions: {
      total: currentSubscribedUsers.length,
      byPlan,
      pending: pendingUserIds.size,
      pendingByPlan,
    },
    orders: {
      total: orders.length,
      today: orders.filter((o) => isOnOrAfter(o.created_at, todayMs)).length,
      paid: orders.filter((o) => o.payment_status === "paid").length,
      pending: orders.filter((o) => o.payment_status === "pending").length,
      failed: orders.filter((o) => ["failed", "canceled", "cancelled"].includes(o.payment_status || "")).length,
    },
    devices,
    analytics: {
      sessionsToday: sessionsToday.length,
      sessionsThisMonth: sessionsMonth.length,
      eventsToday: eventsToday.length,
      eventsThisMonth: eventsMonth.length,
      keyEventsThisMonth: analyticsKeyEvents,
    },
  };
}

export async function getDailyActiveUsers(
  _source: "all" | "global" | "cn" = "all",
  days = 30,
): Promise<DailyUserStat[]> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [];
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const startMs = start.getTime();
  const startQuery = toSourceQueryDateTime(start, sourceScope);

  const [sessionsResult, usersResult, eventsResult] =
    await Promise.all([
    db
      .from("analytics_sessions")
      .select("source, user_id, started_at")
      .gte("started_at", startQuery),
    db
      .from("app_users")
      .select("source, created_at")
      .gte("created_at", startQuery),
    db
      .from("analytics_events")
      .select("source, user_id, event_type, created_at")
      .gte("created_at", startQuery),
    ]);

  if (
    sessionsResult.error ||
    usersResult.error ||
    eventsResult.error
  ) {
    return [];
  }

  const sessionRows = withinSourceScope(
    (sessionsResult.data || []) as StatsSessionRow[],
    sourceScope,
  );
  const eventRows = withinSourceScope((eventsResult.data || []) as StatsEventRow[], sourceScope);
  const dateMap = new Map<string, { activeUsers: Set<string>; generationCount: number }>();

  for (const row of sessionRows) {
    if (!isOnOrAfter(row.started_at, startMs)) continue;
    const key = toDateKey(row.started_at);
    if (!key) continue;
    if (!dateMap.has(key)) {
      dateMap.set(key, { activeUsers: new Set<string>(), generationCount: 0 });
    }
    const item = dateMap.get(key)!;
    if (row.user_id) {
      item.activeUsers.add(row.user_id);
    }
  }

  for (const row of eventRows) {
    if (!isOnOrAfter(row.created_at, startMs)) continue;
    const key = toDateKey(row.created_at);
    if (!key) continue;
    if (!dateMap.has(key)) {
      dateMap.set(key, { activeUsers: new Set<string>(), generationCount: 0 });
    }
    const item = dateMap.get(key)!;
    if (row.user_id) {
      item.activeUsers.add(row.user_id);
    }

    if ((row.event_type || "").toLowerCase() === "generate_success") {
      item.generationCount += 1;
    }
  }

  const userRows = withinSourceScope((usersResult.data || []) as StatsUserRow[], sourceScope);
  const newUserCountByDate = new Map<string, number>();
  for (const row of userRows) {
    if (!isOnOrAfter(row.created_at, startMs)) continue;
    const key = toDateKey(row.created_at);
    if (!key) continue;
    newUserCountByDate.set(key, (newUserCountByDate.get(key) || 0) + 1);
  }

  const mapped = Array.from(dateMap.entries()).map(([date, dataItem]) => ({
    date,
    activeUsers: dataItem.activeUsers.size,
    newUsers: newUserCountByDate.get(date) || 0,
    generations: dataItem.generationCount,
  }));

  return ensureDateRange(mapped, days, (date) => ({
    date,
    activeUsers: 0,
    newUsers: newUserCountByDate.get(date) || 0,
    generations: 0,
  }));
}

export async function getDailyRevenue(
  _source: "all" | "global" | "cn" = "all",
  days = 30,
): Promise<DailyRevenueStat[]> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [];
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const startMs = start.getTime();

  const { data, error } = await db
    .from("orders")
    .select("source, user_id, amount, payment_status, paid_at, created_at")
    .eq("payment_status", "paid");

  if (error) {
    return [];
  }

  const rows = withinSourceScope((data || []) as StatsOrderRow[], sourceScope);
  const dateMap = new Map<
    string,
    { amount: number; orderCount: number; payingUsers: Set<string> }
  >();

  for (const row of rows) {
    const dateRaw = row.paid_at || row.created_at;
    if (!dateRaw) continue;
    const dateMs = toTimestampMs(dateRaw);
    if (dateMs === null || dateMs < startMs) continue;
    const key = toDateKey(dateRaw);
    if (!key) continue;
    if (!dateMap.has(key)) {
      dateMap.set(key, { amount: 0, orderCount: 0, payingUsers: new Set<string>() });
    }
    const item = dateMap.get(key)!;
    item.amount += Number(row.amount || 0);
    item.orderCount += 1;
    if (row.user_id) {
      item.payingUsers.add(row.user_id);
    }
  }

  const mapped = Array.from(dateMap.entries()).map(([date, item]) => ({
    date,
    amount: sourceScope === "global" ? item.amount : 0,
    amountCny: sourceScope === "cn" ? item.amount : 0,
    orderCount: item.orderCount,
    payingUsers: item.payingUsers.size,
  }));

  return ensureDateRange(mapped, days, (date) => ({
    date,
    amount: 0,
    amountCny: 0,
    orderCount: 0,
    payingUsers: 0,
  }));
}
