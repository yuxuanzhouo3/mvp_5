"use client";

import { useEffect, useState } from "react";
import {
  getOrders,
  getOrderStats,
  updateOrderNotes,
  updateOrderRiskLevel,
  type Order,
  type OrderFilters,
} from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  Shield,
} from "lucide-react";

const PAYMENT_METHODS = [
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
];

// 常用国家代码映射
const COUNTRY_NAMES: Record<string, string> = {
  US: "美国", CN: "中国", JP: "日本", KR: "韩国", GB: "英国",
  DE: "德国", FR: "法国", CA: "加拿大", AU: "澳大利亚", SG: "新加坡",
  HK: "香港", TW: "台湾", IN: "印度", BR: "巴西", RU: "俄罗斯",
  C2: "PayPal测试", // PayPal沙盒环境
};

function getCountryName(code?: string): string {
  if (!code) return "";
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

const RISK_LEVELS = [
  { value: "low", label: "低风险", color: "bg-green-100 text-green-700" },
  { value: "medium", label: "中风险", color: "bg-yellow-100 text-yellow-700" },
  { value: "high", label: "高风险", color: "bg-orange-100 text-orange-700" },
  { value: "blocked", label: "已拦截", color: "bg-red-100 text-red-700" },
];

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

import { formatDateTime } from "@/lib/utils/date-format";

function formatDate(dateStr?: string): string {
  return formatDateTime(dateStr);
}

function getPaymentStatusIcon(status: string) {
  switch (status) {
    case "paid":
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-600" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "refunded":
      return <AlertTriangle className="h-4 w-4 text-orange-600" />;
    default:
      return <Clock className="h-4 w-4 text-slate-400" />;
  }
}

function getPaymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "已支付";
    case "pending":
      return "待支付";
    case "failed":
      return "支付失败";
    case "refunded":
      return "已退款";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function getFixedSourceScope(): "global" | "cn" {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh").toLowerCase();
  return language.startsWith("zh") ? "cn" : "global";
}

export default function AdminOrdersPage() {
  const sourceScope = getFixedSourceScope();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState({
    total: 0,
    paid: 0,
    pending: 0,
    failed: 0,
    totalAmount: 0,
    highRisk: 0,
  });

  const [filters, setFilters] = useState<OrderFilters>({
    source: sourceScope,
    payment_status: "all",
    risk_level: "all",
    payment_method: "all",
    search: "",
  });

  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editRiskLevel, setEditRiskLevel] = useState("");

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [filters.source, filters.payment_status, filters.risk_level, filters.payment_method, page]);

  async function fetchOrders() {
    setLoading(true);
    const result = await getOrders({ ...filters, page, limit: 20 });
    setOrders(result.orders);
    setTotal(result.total);
    setLoading(false);
  }

  async function fetchStats() {
    const data = await getOrderStats(filters.source);
    setStats(data);
  }

  function handleSearch() {
    setPage(1);
    fetchOrders();
  }

  function openDetail(order: Order) {
    setDetailOrder(order);
    setEditNotes(order.notes || "");
    setEditRiskLevel(order.risk_level);
    setDetailOpen(true);
  }

  async function handleSaveNotes() {
    if (!detailOrder) return;
    setSaving(true);
    await updateOrderNotes(detailOrder.id, editNotes, detailOrder.source);
    setSaving(false);
    fetchOrders();
  }

  async function handleSaveRiskLevel() {
    if (!detailOrder) return;
    setSaving(true);
    await updateOrderRiskLevel(detailOrder.id, editRiskLevel, undefined, detailOrder.source);
    setSaving(false);
    fetchOrders();
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">交易订单</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          订单管理与风控溯源
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">总订单</p>
          <p className="text-2xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">已支付</p>
          <p className="text-2xl font-bold mt-1 text-green-600">{stats.paid}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">待支付</p>
          <p className="text-2xl font-bold mt-1 text-yellow-600">{stats.pending}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">支付失败</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{stats.failed}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">总收入</p>
          <p className="text-2xl font-bold mt-1">
            {formatCurrency(stats.totalAmount, sourceScope === "cn" ? "CNY" : "USD")}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500">高风险订单</p>
          <p className="text-2xl font-bold mt-1 text-orange-600">{stats.highRisk}</p>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label className="text-xs">区域</Label>
          <Select
            value={filters.source}
            disabled
            onValueChange={(v) => setFilters({ ...filters, source: v })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceScope === "cn" ? (
                <SelectItem value="cn">国内版</SelectItem>
              ) : (
                <SelectItem value="global">国际版</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">支付状态</Label>
          <Select
            value={filters.payment_status}
            onValueChange={(v) => setFilters({ ...filters, payment_status: v })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="paid">已支付</SelectItem>
              <SelectItem value="pending">待支付</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="refunded">已退款</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">风控等级</Label>
          <Select
            value={filters.risk_level}
            onValueChange={(v) => setFilters({ ...filters, risk_level: v })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {RISK_LEVELS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">支付方式</Label>
          <Select
            value={filters.payment_method}
            onValueChange={(v) => setFilters({ ...filters, payment_method: v })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">搜索</Label>
          <div className="flex gap-2">
            <Input
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="订单号/邮箱/交易号"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} size="icon">
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 订单列表 */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-slate-500">暂无订单数据</div>
      ) : (
        <>
          {/* 桌面端表格视图 */}
          <div className="hidden md:block bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium">订单号</th>
                  <th className="text-left py-3 px-4 font-medium">用户</th>
                  <th className="text-left py-3 px-4 font-medium">商品</th>
                  <th className="text-left py-3 px-4 font-medium">金额</th>
                  <th className="text-left py-3 px-4 font-medium">支付方式</th>
                  <th className="text-left py-3 px-4 font-medium">状态</th>
                  <th className="text-left py-3 px-4 font-medium">风控</th>
                  <th className="text-left py-3 px-4 font-medium">时间</th>
                  <th className="text-left py-3 px-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  >
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs">{order.order_no}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs">{order.user_email || "-"}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <span className="font-medium">{order.product_name}</span>
                        {order.plan && (
                          <span className="text-slate-500 ml-1">({order.plan})</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium">
                      {formatCurrency(order.amount, order.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs">
                        {PAYMENT_METHODS.find((m) => m.value === order.payment_method)?.label ||
                          order.payment_method ||
                          "-"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {getPaymentStatusIcon(order.payment_status)}
                        <span className="text-xs">
                          {getPaymentStatusLabel(order.payment_status)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            RISK_LEVELS.find((r) => r.value === order.risk_level)?.color ||
                            "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {RISK_LEVELS.find((r) => r.value === order.risk_level)?.label ||
                            order.risk_level}
                        </span>
                        <span className="text-xs text-slate-500">{order.risk_score}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(order)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片视图 */}
          <div className="md:hidden space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
                onClick={() => openDetail(order)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-slate-500 truncate">{order.order_no}</p>
                    <p className="text-sm truncate mt-0.5">{order.user_email || "-"}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {getPaymentStatusIcon(order.payment_status)}
                    <span className="text-xs">{getPaymentStatusLabel(order.payment_status)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-sm">{order.product_name}</span>
                    {order.plan && (
                      <span className="text-slate-500 text-xs ml-1">({order.plan})</span>
                    )}
                  </div>
                  <span className="font-semibold text-primary">
                    {formatCurrency(order.amount, order.currency)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded">
                      {PAYMENT_METHODS.find((m) => m.value === order.payment_method)?.label ||
                        order.payment_method || "-"}
                    </span>
                    <span
                      className={`px-2 py-1 rounded font-medium ${
                        RISK_LEVELS.find((r) => r.value === order.risk_level)?.color ||
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {RISK_LEVELS.find((r) => r.value === order.risk_level)?.label || order.risk_level}
                    </span>
                  </div>
                  <span className="text-slate-500">{formatDate(order.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            共 {total} 条记录，第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 订单详情对话框 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] md:w-full">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-6">
              {/* 基本信息 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-slate-500">订单号</Label>
                  <p className="font-mono text-xs break-all">{detailOrder.order_no}</p>
                </div>
                <div>
                  <Label className="text-slate-500">用户邮箱</Label>
                  <p className="break-all">{detailOrder.user_email || "-"}</p>
                </div>
                <div>
                  <Label className="text-slate-500">商品名称</Label>
                  <p>{detailOrder.product_name}</p>
                </div>
                <div>
                  <Label className="text-slate-500">套餐/周期</Label>
                  <p>
                    {detailOrder.plan || "-"} / {detailOrder.period || "-"}
                  </p>
                </div>
                <div>
                  <Label className="text-slate-500">订单金额</Label>
                  <p className="font-medium">
                    {formatCurrency(detailOrder.amount, detailOrder.currency)}
                  </p>
                </div>
                <div>
                  <Label className="text-slate-500">支付方式</Label>
                  <p>
                    {PAYMENT_METHODS.find((m) => m.value === detailOrder.payment_method)?.label ||
                      detailOrder.payment_method ||
                      "-"}
                  </p>
                </div>
                <div>
                  <Label className="text-slate-500">支付状态</Label>
                  <p>{getPaymentStatusLabel(detailOrder.payment_status)}</p>
                </div>
                <div>
                  <Label className="text-slate-500">支付时间</Label>
                  <p>{formatDate(detailOrder.paid_at)}</p>
                </div>
              </div>

              {/* 第三方支付信息 */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3">支付渠道信息</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="text-slate-500">渠道订单号</Label>
                    <p className="font-mono text-xs break-all">
                      {detailOrder.provider_order_id || "-"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-slate-500">渠道交易号</Label>
                    <p className="font-mono text-xs break-all">
                      {detailOrder.provider_transaction_id || "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 风控信息 */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  风控信息
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="text-slate-500">风控评分</Label>
                    <p className="font-medium">{detailOrder.risk_score}</p>
                  </div>
                  <div>
                    <Label className="text-slate-500">风控等级</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={editRiskLevel} onValueChange={setEditRiskLevel}>
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RISK_LEVELS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={handleSaveRiskLevel} disabled={saving}>
                        保存
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-slate-500">IP地址</Label>
                    <p className="font-mono text-xs">{detailOrder.ip_address || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-slate-500">地理位置</Label>
                    <p>
                      {[getCountryName(detailOrder.country), detailOrder.region_name, detailOrder.city]
                        .filter(Boolean)
                        .join(", ") || "-"}
                    </p>
                  </div>
                  <div className="col-span-1 sm:col-span-2">
                    <Label className="text-slate-500">User-Agent</Label>
                    <p className="font-mono text-xs break-all bg-slate-50 dark:bg-slate-700/50 p-2 rounded mt-1">
                      {detailOrder.user_agent || "-"}
                    </p>
                  </div>
                  {detailOrder.risk_factors && detailOrder.risk_factors.length > 0 && (
                    <div className="col-span-1 sm:col-span-2">
                      <Label className="text-slate-500">风险因素</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {(detailOrder.risk_factors as string[]).map((factor, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded text-xs"
                          >
                            {factor}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 备注 */}
              <div className="border-t pt-4">
                <Label>管理员备注</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="mt-2"
                />
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={handleSaveNotes}
                  disabled={saving}
                >
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  保存备注
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
