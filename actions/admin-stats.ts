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
};

export type DailyUserStat = {
  date: string;
  activeUsers: number;
  newUsers: number;
  sessions: number;
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

function getDateThresholds() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  return {
    todayIso: todayStart.toISOString(),
    weekIso: weekStart.toISOString(),
    monthIso: monthStart.toISOString(),
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

  const { todayIso, weekIso, monthIso } = getDateThresholds();

  const [usersRows, ordersRows, subsRows, sessionsRows, tasksRows] = await Promise.all([
    db
      .from("app_users")
      .select("id, source, current_plan_code, created_at", { count: "exact" }),
    db
      .from("orders")
      .select("id, source, amount, payment_status, created_at, paid_at, currency"),
    db
      .from("user_subscriptions")
      .select("id, source, plan_code, status, current_period_end"),
    db
      .from("analytics_sessions")
      .select("source, user_id, os, device_type, started_at"),
    db
      .from("ai_tasks")
      .select("source, user_id, created_at"),
  ]);

  if (usersRows.error || ordersRows.error || subsRows.error || sessionsRows.error || tasksRows.error) {
    return null;
  }

  const users = withinSourceScope(usersRows.data || [], sourceScope);
  const orders = withinSourceScope(ordersRows.data || [], sourceScope);
  const subscriptions = withinSourceScope(subsRows.data || [], sourceScope);
  const sessions = withinSourceScope(sessionsRows.data || [], sourceScope);
  const tasks = withinSourceScope(tasksRows.data || [], sourceScope);

  const userToday = users.filter((u) => (u.created_at || "") >= todayIso).length;
  const userWeek = users.filter((u) => (u.created_at || "") >= weekIso).length;
  const userMonth = users.filter((u) => (u.created_at || "") >= monthIso).length;

  const sessionsMonth = sessions.filter((s) => (s.started_at || "") >= monthIso);
  const sessionsWeek = sessions.filter((s) => (s.started_at || "") >= weekIso);
  const sessionsToday = sessions.filter((s) => (s.started_at || "") >= todayIso);
  const tasksMonth = tasks.filter((t) => (t.created_at || "") >= monthIso);
  const tasksWeek = tasks.filter((t) => (t.created_at || "") >= weekIso);
  const tasksToday = tasks.filter((t) => (t.created_at || "") >= todayIso);

  const activityTodayUsers = new Set<string>();
  const activityWeekUsers = new Set<string>();
  const activityMonthUsers = new Set<string>();

  for (const row of sessionsToday) {
    if (row.user_id) activityTodayUsers.add(row.user_id);
  }
  for (const row of tasksToday) {
    if (row.user_id) activityTodayUsers.add(row.user_id);
  }
  for (const row of sessionsWeek) {
    if (row.user_id) activityWeekUsers.add(row.user_id);
  }
  for (const row of tasksWeek) {
    if (row.user_id) activityWeekUsers.add(row.user_id);
  }
  for (const row of sessionsMonth) {
    if (row.user_id) activityMonthUsers.add(row.user_id);
  }
  for (const row of tasksMonth) {
    if (row.user_id) activityMonthUsers.add(row.user_id);
  }

  const dau = activityTodayUsers.size;
  const wau = activityWeekUsers.size;
  const mau = activityMonthUsers.size;

  const paidOrders = orders.filter((o) => o.payment_status === "paid");
  const revenueRawTotal = paidOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawToday = paidOrders
    .filter((o) => (o.paid_at || o.created_at || "") >= todayIso)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawWeek = paidOrders
    .filter((o) => (o.paid_at || o.created_at || "") >= weekIso)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const revenueRawMonth = paidOrders
    .filter((o) => (o.paid_at || o.created_at || "") >= monthIso)
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

  const now = new Date().toISOString();
  const activeSubscriptions = subscriptions.filter((item) => {
    if (!["active", "trialing"].includes(item.status || "")) {
      return false;
    }
    if (!item.current_period_end) {
      return true;
    }
    return item.current_period_end >= now;
  });
  const byPlan: Record<string, number> = {};
  for (const item of activeSubscriptions) {
    const plan = item.plan_code || "free";
    byPlan[plan] = (byPlan[plan] || 0) + 1;
  }

  const byOs: Record<string, number> = {};
  const byDeviceType: Record<string, number> = {};
  for (const item of sessionsMonth) {
    const os = item.os || "unknown";
    const deviceType = item.device_type || "unknown";
    byOs[os] = (byOs[os] || 0) + 1;
    byDeviceType[deviceType] = (byDeviceType[deviceType] || 0) + 1;
  }

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
      total: activeSubscriptions.length,
      byPlan,
    },
    orders: {
      total: orders.length,
      today: orders.filter((o) => (o.created_at || "") >= todayIso).length,
      paid: orders.filter((o) => o.payment_status === "paid").length,
      pending: orders.filter((o) => o.payment_status === "pending").length,
      failed: orders.filter((o) => ["failed", "canceled", "cancelled"].includes(o.payment_status || "")).length,
    },
    devices: {
      byOs,
      byDeviceType,
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

  const [sessionsResult, usersResult, tasksResult] = await Promise.all([
    db
      .from("analytics_sessions")
      .select("source, user_id, started_at")
      .gte("started_at", start.toISOString()),
    db
      .from("app_users")
      .select("source, created_at")
      .gte("created_at", start.toISOString()),
    db
      .from("ai_tasks")
      .select("source, user_id, created_at")
      .gte("created_at", start.toISOString()),
  ]);

  if (sessionsResult.error || usersResult.error || tasksResult.error) {
    return [];
  }

  const sessionRows = withinSourceScope(sessionsResult.data || [], sourceScope);
  const taskRows = withinSourceScope(tasksResult.data || [], sourceScope);
  const dateMap = new Map<string, { activeUsers: Set<string>; taskCount: number }>();

  for (const row of sessionRows) {
    if (!row.started_at) continue;
    const key = ymd(new Date(row.started_at));
    if (!dateMap.has(key)) {
      dateMap.set(key, { activeUsers: new Set<string>(), taskCount: 0 });
    }
    const item = dateMap.get(key)!;
    if (row.user_id) {
      item.activeUsers.add(row.user_id);
    }
  }

  for (const row of taskRows) {
    if (!row.created_at) continue;
    const key = ymd(new Date(row.created_at));
    if (!dateMap.has(key)) {
      dateMap.set(key, { activeUsers: new Set<string>(), taskCount: 0 });
    }
    const item = dateMap.get(key)!;
    if (row.user_id) {
      item.activeUsers.add(row.user_id);
    }
    item.taskCount += 1;
  }

  const userRows = withinSourceScope(usersResult.data || [], sourceScope);
  const newUserCountByDate = new Map<string, number>();
  for (const row of userRows) {
    if (!row.created_at) continue;
    const key = ymd(new Date(row.created_at));
    newUserCountByDate.set(key, (newUserCountByDate.get(key) || 0) + 1);
  }

  const mapped = Array.from(dateMap.entries()).map(([date, dataItem]) => ({
    date,
    activeUsers: dataItem.activeUsers.size,
    newUsers: newUserCountByDate.get(date) || 0,
    sessions: dataItem.taskCount,
  }));

  return ensureDateRange(mapped, days, (date) => ({
    date,
    activeUsers: 0,
    newUsers: newUserCountByDate.get(date) || 0,
    sessions: 0,
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

  const { data, error } = await db
    .from("orders")
    .select("source, user_id, amount, payment_status, paid_at, created_at")
    .eq("payment_status", "paid");

  if (error) {
    return [];
  }

  const rows = withinSourceScope(data || [], sourceScope);
  const dateMap = new Map<
    string,
    { amount: number; orderCount: number; payingUsers: Set<string> }
  >();

  for (const row of rows) {
    const dateRaw = row.paid_at || row.created_at;
    if (!dateRaw) continue;
    const dateObj = new Date(dateRaw);
    if (dateObj < start) continue;
    const key = ymd(dateObj);
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
