"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getDashboardStats,
  getDailyActiveUsers,
  getDailyRevenue,
  type DashboardStats,
  type DailyStats,
  type RevenueStats,
} from "@/actions/admin-stats";
import {
  Loader2,
  RefreshCw,
  Users,
  DollarSign,
  Activity,
  CreditCard,
  Calendar,
  Globe,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

type TabKey = "users" | "revenue" | "devices" | "plans";

function toNumericValue(value: unknown) {
  if (Array.isArray(value)) {
    return Number(value[0] || 0);
  }
  return Number(value || 0);
}

function getFixedSource(): "global" | "cn" {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en").toLowerCase();
  return language.startsWith("zh") ? "cn" : "global";
}

export default function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source] = useState<"all" | "global" | "cn">(getFixedSource());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [dailyUsers, setDailyUsers] = useState<DailyStats[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<RevenueStats[]>([]);
  const [timeRange, setTimeRange] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<TabKey>("users");

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsResult, usersResult, revenueResult] = await Promise.all([
        getDashboardStats(source),
        getDailyActiveUsers(source, timeRange),
        getDailyRevenue(source, timeRange),
      ]);

      if (statsResult) {
        setStats(statsResult);
      } else {
        setError("获取统计数据失败");
      }
      setDailyUsers(usersResult);
      setDailyRevenue(revenueResult);
    } catch {
      setError("加载统计数据失败");
    } finally {
      setLoading(false);
    }
  }, [source, timeRange]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const sourceLabel = source === "cn" ? "国内版" : "国际版";

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const deviceData = useMemo(() => {
    if (!stats?.devices.byDeviceType) return [];
    return Object.entries(stats.devices.byDeviceType).map(([name, value]) => ({
      name:
        name === "desktop" ? "桌面" : name === "mobile" ? "手机" : name === "tablet" ? "平板" : name,
      value,
    }));
  }, [stats]);

  const osData = useMemo(() => {
    if (!stats?.devices.byOs) return [];
    return Object.entries(stats.devices.byOs).map(([name, value]) => ({ name, value }));
  }, [stats]);

  const planData = useMemo(() => {
    if (!stats?.subscriptions.byPlan) return [];
    return Object.entries(stats.subscriptions.byPlan).map(([name, value]) => ({ name, value }));
  }, [stats]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">用户数据统计</h1>
          <p className="mt-1 text-sm text-slate-500">查看用户、付费、设备等统计数据</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <select
              value={source}
              disabled
              className="h-10 rounded-md border border-slate-300 bg-slate-100 pl-9 pr-8 text-sm text-slate-700"
            >
              <option value={source}>{sourceLabel}</option>
            </select>
          </div>

          <button
            type="button"
            onClick={loadStats}
            disabled={loading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {loading && !stats ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h3 className="text-sm font-medium text-slate-500">总用户数</h3>
                <Users className="h-4 w-4 text-slate-400" />
              </div>
              <div className="px-4 pb-4">
                <div className="text-2xl font-bold text-slate-900">{formatNumber(stats.users.total)}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <div className="flex flex-col">
                    <span className="text-slate-500">今日</span>
                    <span className="font-semibold text-green-600">+{formatNumber(stats.users.today)}</span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="flex flex-col">
                    <span className="text-slate-500">本周</span>
                    <span className="font-semibold text-blue-600">+{formatNumber(stats.users.thisWeek)}</span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="flex flex-col">
                    <span className="text-slate-500">本月</span>
                    <span className="font-semibold text-purple-600">+{formatNumber(stats.users.thisMonth)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h3 className="text-sm font-medium text-slate-500">日活跃用户</h3>
                <Activity className="h-4 w-4 text-slate-400" />
              </div>
              <div className="px-4 pb-4">
                <div className="text-2xl font-bold text-slate-900">{formatNumber(stats.users.dau)}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <div className="flex flex-col">
                    <span className="text-slate-500">周活</span>
                    <span className="font-semibold text-green-600">{formatNumber(stats.users.wau)}</span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="flex flex-col">
                    <span className="text-slate-500">月活</span>
                    <span className="font-semibold text-purple-600">{formatNumber(stats.users.mau)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h3 className="text-sm font-medium text-slate-500">总收入</h3>
                <DollarSign className="h-4 w-4 text-slate-400" />
              </div>
              <div className="px-4 pb-4">
                {source === "cn" ? (
                  <>
                    <div className="text-2xl font-bold text-slate-900">¥{stats.revenueCny.total.toFixed(2)}</div>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <div className="flex flex-col">
                        <span className="text-slate-500">今日</span>
                        <span className="font-semibold text-green-600">+¥{stats.revenueCny.today.toFixed(2)}</span>
                      </div>
                      <div className="h-6 w-px bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500">本周</span>
                        <span className="font-semibold text-blue-600">+¥{stats.revenueCny.thisWeek.toFixed(2)}</span>
                      </div>
                      <div className="h-6 w-px bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500">本月</span>
                        <span className="font-semibold text-purple-600">+¥{stats.revenueCny.thisMonth.toFixed(2)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-slate-900">${stats.revenue.total.toFixed(2)}</div>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <div className="flex flex-col">
                        <span className="text-slate-500">今日</span>
                        <span className="font-semibold text-green-600">+${stats.revenue.today.toFixed(2)}</span>
                      </div>
                      <div className="h-6 w-px bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500">本周</span>
                        <span className="font-semibold text-blue-600">+${stats.revenue.thisWeek.toFixed(2)}</span>
                      </div>
                      <div className="h-6 w-px bg-slate-200" />
                      <div className="flex flex-col">
                        <span className="text-slate-500">本月</span>
                        <span className="font-semibold text-purple-600">+${stats.revenue.thisMonth.toFixed(2)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h3 className="text-sm font-medium text-slate-500">订阅用户</h3>
                <CreditCard className="h-4 w-4 text-slate-400" />
              </div>
              <div className="px-4 pb-4">
                <div className="text-2xl font-bold text-slate-900">{formatNumber(stats.subscriptions.total)}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <div className="flex flex-col">
                    <span className="text-slate-500">转化率</span>
                    <span className="font-semibold text-green-600">
                      {stats.users.total > 0
                        ? ((stats.subscriptions.total / stats.users.total) * 100).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="flex flex-col">
                    <span className="text-slate-500">已付款</span>
                    <span className="font-semibold text-blue-600">{formatNumber(stats.orders.paid)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="scrollbar-hide -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-1">
                  <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>
                    用户趋势
                  </TabButton>
                  <TabButton active={activeTab === "revenue"} onClick={() => setActiveTab("revenue")}>
                    收入趋势
                  </TabButton>
                  <TabButton active={activeTab === "devices"} onClick={() => setActiveTab("devices")}>
                    设备分布
                  </TabButton>
                  <TabButton active={activeTab === "plans"} onClick={() => setActiveTab("plans")}>
                    订阅分布
                  </TabButton>
                </div>
              </div>

              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <select
                  value={timeRange.toString()}
                  onChange={(e) => setTimeRange(Number(e.target.value))}
                  className="h-10 w-full rounded-md border border-slate-300 pl-9 pr-8 text-sm text-slate-700 sm:w-[150px]"
                >
                  <option value="7">最近 7 天</option>
                  <option value="14">最近 14 天</option>
                  <option value="30">最近 30 天</option>
                </select>
              </div>
            </div>

            {activeTab === "users" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                  <h3 className="text-base font-semibold text-slate-900 sm:text-lg">活跃用户趋势</h3>
                </div>
                <div className="px-2 pb-4 sm:px-6 sm:pb-6">
                  <div className="h-[250px] sm:h-[350px]">
                    {dailyUsers.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyUsers}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(v) => v.slice(5)}
                            className="text-xs"
                            interval={1}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                          />
                          <YAxis className="text-xs" allowDecimals={false} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                            }}
                            formatter={(value, name) => [
                              toNumericValue(value).toLocaleString(),
                              name,
                            ]}
                            labelFormatter={(label) => `日期: ${label}`}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="activeUsers" name="活跃用户" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="newUsers" name="新增用户" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="sessions" name="任务数" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-500">暂无数据</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "revenue" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                  <h3 className="text-base font-semibold text-slate-900 sm:text-lg">收入趋势</h3>
                </div>
                <div className="px-2 pb-4 sm:px-6 sm:pb-6">
                  <div className="h-[250px] sm:h-[350px]">
                    {dailyRevenue.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyRevenue}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip
                            formatter={(value, name) => {
                              const nameText = String(name || "");
                              return [
                                nameText.includes("¥")
                                  ? `¥${toNumericValue(value).toFixed(2)}`
                                  : `$${toNumericValue(value).toFixed(2)}`,
                                nameText,
                              ];
                            }}
                            labelFormatter={(label) => `日期: ${label}`}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend />
                          {source === "cn" ? (
                            <Bar dataKey="amountCny" name="收入金额 (¥)" fill="#ef4444" radius={[4, 4, 0, 0]} />
                          ) : (
                            <Bar dataKey="amount" name="收入金额 ($)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-500">暂无数据</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "devices" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                    <h3 className="text-base font-semibold text-slate-900 sm:text-lg">设备类型分布</h3>
                  </div>
                  <div className="px-2 pb-4 sm:px-6 sm:pb-6">
                    <div className="h-[220px] sm:h-[300px]">
                      {deviceData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={deviceData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(1)}%`}
                            >
                              {deviceData.map((_, index) => (
                                <Cell key={`device-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "8px",
                              }}
                              formatter={(value) => [
                                toNumericValue(value).toLocaleString(),
                                "用户数",
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-500">暂无设备数据</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                    <h3 className="text-base font-semibold text-slate-900 sm:text-lg">操作系统分布</h3>
                  </div>
                  <div className="px-2 pb-4 sm:px-6 sm:pb-6">
                    <div className="h-[220px] sm:h-[300px]">
                      {osData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={osData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(1)}%`}
                            >
                              {osData.map((_, index) => (
                                <Cell key={`os-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "8px",
                              }}
                              formatter={(value) => [
                                toNumericValue(value).toLocaleString(),
                                "用户数",
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-500">暂无系统数据</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "plans" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                  <h3 className="text-base font-semibold text-slate-900 sm:text-lg">订阅计划分布</h3>
                </div>
                <div className="px-2 pb-4 sm:px-6 sm:pb-6">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="h-[220px] sm:h-[300px]">
                      {planData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={planData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(1)}%`}
                            >
                              {planData.map((_, index) => (
                                <Cell key={`plan-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "8px",
                              }}
                              formatter={(value) => [
                                toNumericValue(value).toLocaleString(),
                                "订阅数",
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-500">暂无订阅数据</div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between rounded-lg bg-slate-100 p-4">
                        <span className="text-sm font-medium text-slate-700">总订阅数</span>
                        <span className="text-2xl font-bold text-slate-900">{stats.subscriptions.total}</span>
                      </div>
                      <div className="space-y-2">
                        {planData.map((plan, index) => (
                          <div key={plan.name} className="flex items-center justify-between rounded p-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <span className="text-sm text-slate-700">{plan.name}</span>
                            </div>
                            <span className="font-medium text-slate-900">{plan.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-xs sm:text-sm ${
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
