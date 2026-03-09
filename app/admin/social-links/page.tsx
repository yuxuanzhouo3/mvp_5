"use client";

import { useState, useEffect, useMemo } from "react";
import {
  listSocialLinks,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink,
  toggleSocialLinkStatus,
  updateSocialLinksOrder,
  type SocialLink,
} from "@/actions/admin-social-links";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Image as ImageIcon,
  RefreshCw,
  Eye,
  EyeOff,
  Database,
  Cloud,
  Search,
  X,
  ExternalLink,
  Link as LinkIcon,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

function getFixedUploadTarget(): "supabase" | "cloudbase" {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en").toLowerCase();
  return language.startsWith("zh") ? "cloudbase" : "supabase";
}

export default function SocialLinksManagementPage() {
  const fixedUploadTarget = getFixedUploadTarget();
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SocialLink | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SocialLink | null>(null);

  // 文件预览状态
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // 列表预览对话框状态
  const [listPreviewLink, setListPreviewLink] = useState<SocialLink | null>(null);

  // 筛选和搜索状态
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource] = useState<string>(fixedUploadTarget);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // 排序更新状态
  const [updating, setUpdating] = useState(false);

  // 筛选后的链接列表
  const filteredLinks = useMemo(() => {
    return links.filter((link) => {
      // 搜索过滤
      if (searchQuery && !(link.title || link.name).toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      // 数据源过滤
      if (filterSource !== "all" && link.source !== filterSource) {
        return false;
      }
      // 状态过滤
      if (filterStatus !== "all") {
        const isActive = filterStatus === "active";
        if (link.is_active !== isActive) {
          return false;
        }
      }
      return true;
    });
  }, [links, searchQuery, filterSource, filterStatus]);

  // 清除所有筛选
  function clearFilters() {
    setSearchQuery("");
    setFilterStatus("all");
  }

  // 是否有筛选条件
  const hasFilters = searchQuery || filterStatus !== "all";

  // 处理文件选择，生成预览
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    // 释放之前的预览 URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    // 生成新的预览 URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }

  // 清理预览 URL
  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  }

  // 加载链接列表
  async function loadLinks() {
    setLoading(true);
    setError(null);
    try {
      const result = await listSocialLinks();
      if (result.success && result.data) {
        setLinks(result.data);
      } else {
        setError(result.error || "加载失败");
      }
    } catch {
      setError("加载社交链接列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLinks();
  }, []);

  // 创建链接
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await createSocialLink(formData);

    if (result.success) {
      setDialogOpen(false);
      clearPreview();
      loadLinks();
    } else {
      setError(result.error || "创建失败");
    }
    setCreating(false);
  }

  // 更新链接
  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;

    setCreating(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await updateSocialLink(editing.id, formData);

    if (result.success) {
      setEditDialogOpen(false);
      setEditing(null);
      loadLinks();
    } else {
      setError(result.error || "更新失败");
    }
    setCreating(false);
  }

  // 删除链接
  async function handleDelete() {
    if (!deleteTarget) return;

    setDeleting(deleteTarget.id);
    const result = await deleteSocialLink(deleteTarget.id, deleteTarget.region);
    if (result.success) {
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      loadLinks();
    } else {
      setError(result.error || "删除失败");
    }
    setDeleting(null);
  }

  // 切换状态
  async function handleToggle(id: string, currentStatus: boolean) {
    setToggling(id);
    const result = await toggleSocialLinkStatus(id, !currentStatus);
    if (result.success) {
      loadLinks();
    } else {
      setError(result.error || "切换状态失败");
    }
    setToggling(null);
  }

  // 移动排序
  async function handleMove(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= filteredLinks.length) return;

    setUpdating(true);

    // 创建新的排序
    const newLinks = [...filteredLinks];
    [newLinks[index], newLinks[newIndex]] = [newLinks[newIndex], newLinks[index]];

    // 更新排序值
    const orders = newLinks.map((link, idx) => ({
      id: link.id,
      sort_order: idx,
    }));

    const result = await updateSocialLinksOrder(orders);
    if (result.success) {
      loadLinks();
    } else {
      setError(result.error || "更新排序失败");
    }
    setUpdating(false);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">社交链接管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理侧边栏折叠后显示的小方块链接，支持图标、标题、描述和跳转链接
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadLinks} disabled={loading}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            刷新
          </Button>

          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) clearPreview();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新增链接
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>新增社交链接</DialogTitle>
                <DialogDescription>
                  上传图标并填写链接信息，数据将自动写入当前环境对应的数据源
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">标题 *</Label>
                  <Input
                    id="title"
                    name="title"
                    placeholder="输入链接标题（悬浮显示）"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">描述</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="输入链接描述（悬浮显示）"
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="targetUrl">跳转链接 *</Label>
                  <Input
                    id="targetUrl"
                    name="targetUrl"
                    type="url"
                    placeholder="https://example.com"
                    required
                  />
                </div>

                {/* 上传目标选择 */}
                <div className="space-y-2">
                  <Label>上传目标 *</Label>
                  <input type="hidden" name="uploadTarget" value={fixedUploadTarget} />
                  <Select value={fixedUploadTarget} disabled>
                    <SelectTrigger className="bg-muted/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supabase">
                        <span className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          仅 Supabase (国际版)
                        </span>
                      </SelectItem>
                      <SelectItem value="cloudbase">
                        <span className="flex items-center gap-2">
                          <Cloud className="h-4 w-4" />
                          仅 CloudBase (国内版)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    已根据环境固定数据源，确保国内/国际后台数据绝对隔离
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="file">图标文件 *</Label>
                  <Input
                    id="file"
                    name="file"
                    type="file"
                    accept="image/*"
                    required
                    onChange={handleFileChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    建议使用 PNG 或 SVG 格式，尺寸 64x64 像素
                  </p>

                  {/* 文件预览 */}
                  {previewUrl && (
                    <div className="mt-3 relative rounded-lg overflow-hidden border bg-slate-50 dark:bg-slate-800 p-4 flex items-center justify-center">
                      <img
                        src={previewUrl}
                        alt="预览"
                        className="w-16 h-16 object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          clearPreview();
                          const fileInput = document.getElementById("file") as HTMLInputElement;
                          if (fileInput) fileInput.value = "";
                        }}
                        className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 text-white"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">排序顺序</Label>
                    <Input
                      id="sortOrder"
                      name="sortOrder"
                      type="number"
                      defaultValue="0"
                      min="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      数字越小越靠前
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>立即上架</Label>
                    <div className="flex items-center h-10">
                      <input
                        type="hidden"
                        name="isActive"
                        id="create-isActive-hidden"
                        defaultValue="true"
                      />
                      <Switch
                        defaultChecked={true}
                        onCheckedChange={(checked) => {
                          const hidden = document.getElementById("create-isActive-hidden") as HTMLInputElement;
                          if (hidden) hidden.value = String(checked);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      clearPreview();
                    }}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        上传中...
                      </>
                    ) : (
                      "创建"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 搜索和筛选栏 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索链接标题..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* 数据源筛选 */}
            <Select value={filterSource} disabled>
              <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="数据源" />
              </SelectTrigger>
              <SelectContent>
                {fixedUploadTarget === "supabase" ? (
                  <SelectItem value="supabase">
                    <span className="flex items-center gap-2">
                      <Database className="h-4 w-4" /> Supabase
                    </span>
                  </SelectItem>
                ) : (
                  <SelectItem value="cloudbase">
                    <span className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" /> CloudBase
                    </span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            {/* 状态筛选 */}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-[120px]">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">已上架</SelectItem>
                <SelectItem value="inactive">已下架</SelectItem>
              </SelectContent>
            </Select>

            {/* 清除筛选按钮 */}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full sm:w-auto">
                <X className="h-4 w-4 mr-1" />
                清除筛选
              </Button>
            )}
          </div>

          {/* 筛选结果统计 */}
          {hasFilters && (
            <div className="mt-3 text-sm text-muted-foreground">
              找到 {filteredLinks.length} 条结果（共 {links.length} 条）
            </div>
          )}
        </CardContent>
      </Card>

      {/* 链接列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            社交链接列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLinks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasFilters ? "没有符合筛选条件的链接" : "暂无链接，点击\"新增链接\"开始添加"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">排序</TableHead>
                    <TableHead className="w-16">图标</TableHead>
                    <TableHead className="min-w-[120px]">标题</TableHead>
                    <TableHead className="min-w-[150px]">描述</TableHead>
                    <TableHead className="w-24">数据源</TableHead>
                    <TableHead className="w-28">创建时间</TableHead>
                    <TableHead className="w-20">状态</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLinks.map((link, index) => (
                    <TableRow key={link.id}>
                      <TableCell className="p-2">
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleMove(index, "up")}
                            disabled={index === 0 || updating}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleMove(index, "down")}
                            disabled={index === filteredLinks.length - 1 || updating}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="p-2">
                        <button
                          type="button"
                          onClick={() => setListPreviewLink(link)}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          title="点击预览"
                        >
                          <img
                            src={link.icon_url || undefined}
                            alt={link.title}
                            className="w-10 h-10 object-cover rounded"
                          />
                        </button>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{link.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                        {link.description || "-"}
                      </TableCell>
                      <TableCell>
                        {link.source === "supabase" ? (
                          <Badge variant="secondary" className="gap-0.5 text-xs px-1.5">
                            <Database className="h-3 w-3" />
                          </Badge>
                        ) : link.source === "cloudbase" ? (
                          <Badge variant="secondary" className="gap-0.5 text-xs px-1.5">
                            <Cloud className="h-3 w-3" />
                          </Badge>
                        ) : (
                          <Badge variant="default" className="gap-0.5 text-xs px-1.5">
                            <Database className="h-3 w-3" />
                            <Cloud className="h-3 w-3" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {link.created_at
                            ? new Date(link.created_at).toLocaleDateString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              }) + " " + new Date(link.created_at).toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 px-2 ${
                            link.is_active
                              ? "text-green-600"
                              : "text-muted-foreground"
                          }`}
                          onClick={() => handleToggle(link.id, link.is_active)}
                          disabled={toggling === link.id}
                        >
                          {toggling === link.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : link.is_active ? (
                            <><Eye className="h-3.5 w-3.5 mr-0.5" />上架</>
                          ) : (
                            <><EyeOff className="h-3.5 w-3.5 mr-0.5" />下架</>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditing(link);
                              setEditDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => link.target_url && window.open(link.target_url, "_blank")}
                            disabled={!link.target_url}
                            title="访问链接"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setDeleteTarget(link);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑对话框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑社交链接</DialogTitle>
            <DialogDescription>
              修改链接信息，图标文件不支持更换
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">标题 *</Label>
                <Input
                  id="edit-title"
                  name="title"
                  defaultValue={editing.title || editing.name}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">描述</Label>
                <Textarea
                  id="edit-description"
                  name="description"
                  defaultValue={editing.description || ""}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-targetUrl">跳转链接 *</Label>
                <Input
                  id="edit-targetUrl"
                  name="targetUrl"
                  type="url"
                  defaultValue={editing.target_url || editing.url}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-sortOrder">排序顺序</Label>
                  <Input
                    id="edit-sortOrder"
                    name="sortOrder"
                    type="number"
                    defaultValue={editing.sort_order}
                    min="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label>状态</Label>
                  <div className="flex items-center h-10">
                    <input
                      type="hidden"
                      name="isActive"
                      id="edit-isActive-hidden"
                      defaultValue={String(editing.is_active)}
                    />
                    <Switch
                      defaultChecked={editing.is_active}
                      onCheckedChange={(checked) => {
                        const hidden = document.getElementById(
                          "edit-isActive-hidden"
                        ) as HTMLInputElement;
                        if (hidden) hidden.value = String(checked);
                      }}
                    />
                    <span className="ml-2 text-sm text-muted-foreground">
                      {editing.is_active ? "已上架" : "已下架"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 当前图标预览 */}
              {editing.icon_url && (
                <div className="space-y-2">
                  <Label>当前图标</Label>
                  <div className="flex items-center gap-4 p-4 border rounded-lg bg-slate-50 dark:bg-slate-800">
                    <img
                      src={editing.icon_url || undefined}
                      alt={editing.title || editing.name}
                      className="w-16 h-16 object-contain"
                    />
                    <div className="text-sm text-muted-foreground">
                      <p>图标文件不支持更换</p>
                      <p>如需更换请删除后重新创建</p>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditDialogOpen(false);
                    setEditing(null);
                  }}
                >
                  取消
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    "保存"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 列表预览对话框 */}
      <Dialog open={!!listPreviewLink} onOpenChange={(open) => !open && setListPreviewLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              {listPreviewLink?.title}
            </DialogTitle>
            <DialogDescription>
              {listPreviewLink?.is_active ? "已上架" : "已下架"} ·
              排序: {listPreviewLink?.sort_order}
            </DialogDescription>
          </DialogHeader>

          {listPreviewLink && (
            <div className="space-y-4">
              {/* 图标预览 */}
              <div className="rounded-lg overflow-hidden border bg-slate-50 dark:bg-slate-900 p-8 flex items-center justify-center">
                <img
                  src={listPreviewLink.icon_url || undefined}
                  alt={listPreviewLink.title}
                  className="w-24 h-24 object-contain"
                />
              </div>

              {/* 描述 */}
              {listPreviewLink.description && (
                <div className="text-sm">
                  <span className="text-muted-foreground">描述：</span>
                  <p className="mt-1">{listPreviewLink.description}</p>
                </div>
              )}

              {/* 跳转链接 */}
              <div className="text-sm">
                <span className="text-muted-foreground">跳转链接：</span>
                <a
                  href={listPreviewLink.target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline ml-1 break-all"
                >
                  {listPreviewLink.target_url}
                </a>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setListPreviewLink(null)}>
              关闭
            </Button>
            <Button
              variant="outline"
              onClick={() => listPreviewLink?.target_url && window.open(listPreviewLink.target_url, "_blank")}
              disabled={!listPreviewLink?.target_url}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              访问链接
            </Button>
            <Button
              onClick={() => {
                if (listPreviewLink) {
                  setEditing(listPreviewLink);
                  setEditDialogOpen(true);
                  setListPreviewLink(null);
                }
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />
              编辑
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除社交链接「{deleteTarget?.title}」吗？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting === deleteTarget?.id}
            >
              {deleting === deleteTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "删除"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
