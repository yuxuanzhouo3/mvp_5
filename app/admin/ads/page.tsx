"use client";

import { useState, useEffect, useMemo } from "react";
import {
  getAdminAds,
  createAdminAd,
  updateAdminAd,
  deleteAdminAd,
  toggleAdminAdStatus,
  type AdminAd,
} from "@/actions/admin-ads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialogTrigger,
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
  Video,
  RefreshCw,
  Eye,
  EyeOff,
  Database,
  Cloud,
  Search,
  X,
} from "lucide-react";

type Advertisement = Omit<AdminAd, "source" | "status" | "link_url"> & {
  source: "supabase" | "cloudbase" | "both";
  is_active: boolean;
  target_url: string | null;
};

function getUiSourceFromEnv(): "supabase" | "cloudbase" {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en").toLowerCase();
  return language.startsWith("zh") ? "cloudbase" : "supabase";
}

function mapAdSource(source: string): "supabase" | "cloudbase" | "both" {
  if (source === "global") return "supabase";
  if (source === "cn") return "cloudbase";
  return "both";
}

function toUiAdvertisement(ad: AdminAd): Advertisement {
  return {
    ...ad,
    source: mapAdSource(ad.source),
    is_active: ad.status === "active",
    target_url: ad.link_url,
  };
}

export default function AdsManagementPage() {
  const fixedUploadTarget = getUiSourceFromEnv();
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Advertisement | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // 文件预览状态
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<"image" | "video" | null>(null);

  // 列表预览对话框状态
  const [listPreviewAd, setListPreviewAd] = useState<Advertisement | null>(null);

  // 自动检测的媒体类型状态
  const [detectedMediaType, setDetectedMediaType] = useState<"image" | "video">("image");

  // 筛选和搜索状态
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource] = useState<string>(fixedUploadTarget);
  const [filterPosition, setFilterPosition] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // 筛选后的广告列表
  const filteredAds = useMemo(() => {
    return ads.filter((ad) => {
      // 搜索过滤
      if (searchQuery && !ad.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      // 数据源过滤
      if (filterSource !== "all" && ad.source !== filterSource) {
        return false;
      }
      // 位置过滤
      if (filterPosition !== "all" && ad.position !== filterPosition) {
        return false;
      }
      // 状态过滤
      if (filterStatus !== "all") {
        const isActive = filterStatus === "active";
        if (ad.is_active !== isActive) {
          return false;
        }
      }
      return true;
    });
  }, [ads, searchQuery, filterSource, filterPosition, filterStatus]);

  // 清除所有筛选
  function clearFilters() {
    setSearchQuery("");
    setFilterPosition("all");
    setFilterStatus("all");
  }

  // 是否有筛选条件
  const hasFilters = searchQuery || filterPosition !== "all" || filterStatus !== "all";

  // 根据文件扩展名判断媒体类型
  function getMediaTypeFromFile(fileName: string): "image" | "video" | null {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"];
    const videoExts = ["mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v"];

    if (imageExts.includes(ext || "")) return "image";
    if (videoExts.includes(ext || "")) return "video";
    return null;
  }

  // 处理文件选择，生成预览并自动识别媒体类型
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setPreviewUrl(null);
      setPreviewType(null);
      return;
    }

    // 释放之前的预览 URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    // 生成新的预览 URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // 判断文件类型（优先使用 MIME type，其次使用扩展名）
    let detectedType: "image" | "video" | null = null;
    if (file.type.startsWith("image/")) {
      detectedType = "image";
    } else if (file.type.startsWith("video/")) {
      detectedType = "video";
    } else {
      // 通过扩展名判断
      detectedType = getMediaTypeFromFile(file.name);
    }

    setPreviewType(detectedType);

    // 自动设置媒体类型
    if (detectedType) {
      setDetectedMediaType(detectedType);
    }
  }

  // 清理预览 URL
  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewType(null);
    setDetectedMediaType("image"); // 重置为默认值
  }

  // 加载广告列表
  async function loadAds() {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminAds("all");
      setAds((result || []).map(toUiAdvertisement));
    } catch {
      setError("加载广告列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAds();
  }, []);

  // 创建广告
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await createAdminAd(formData);

    if (result.success) {
      setDialogOpen(false);
      clearPreview();
      loadAds();
    } else {
      setError(result.error || "创建失败");
    }
    setCreating(false);
  }

  // 更新广告
  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;

    setCreating(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await updateAdminAd(editing.id, formData);

    if (result.success) {
      setEditDialogOpen(false);
      setEditing(null);
      loadAds();
    } else {
      setError(result.error || "更新失败");
    }
    setCreating(false);
  }

  // 删除广告
  async function handleDelete(ad: Advertisement) {
    setDeleting(ad.id);
    const result = await deleteAdminAd(ad.id);
    if (result.success) {
      loadAds();
    } else {
      setError(result.error || "删除失败");
    }
    setDeleting(null);
  }

  // 切换状态
  async function handleToggle(ad: Advertisement) {
    setToggling(ad.id);
    const result = await toggleAdminAdStatus(ad.id, ad.is_active ? "inactive" : "active");
    if (result.success) {
      loadAds();
    } else {
      setError(result.error || "切换状态失败");
    }
    setToggling(null);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">广告管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理首页顶部和底部的广告位，支持图片和视频
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAds} disabled={loading}>
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
                新增广告
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>新增广告</DialogTitle>
                <DialogDescription>
                  上传广告素材，数据将自动写入当前环境对应的数据源
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">广告标题 *</Label>
                  <Input
                    id="title"
                    name="title"
                    placeholder="输入广告标题"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="position">展示位置 *</Label>
                    <Select name="position" defaultValue="top">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top">顶部横幅</SelectItem>
                        <SelectItem value="bottom">底部横幅</SelectItem>
                        <SelectItem value="left">输入框左侧</SelectItem>
                        <SelectItem value="right">输入框右侧</SelectItem>
                        <SelectItem value="bottom-left">底部左侧</SelectItem>
                        <SelectItem value="bottom-right">底部右侧</SelectItem>
                        <SelectItem value="sidebar">侧边栏竖向</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mediaType">媒体类型</Label>
                    <input type="hidden" name="mediaType" value={detectedMediaType} />
                    <div className="flex items-center h-10 px-3 border rounded-md bg-muted/50">
                      {detectedMediaType === "image" ? (
                        <span className="flex items-center gap-2 text-sm">
                          <ImageIcon className="h-4 w-4" /> 图片
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-sm">
                          <Video className="h-4 w-4" /> 视频
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      根据上传文件自动识别
                    </p>
                  </div>
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
                    已根据当前环境固定数据源，确保国内/国际后台数据绝对隔离
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="file">媒体文件 *</Label>
                  <Input
                    id="file"
                    name="file"
                    type="file"
                    accept="image/*,video/*"
                    required
                    onChange={handleFileChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    支持 JPG、PNG、GIF、MP4 等格式
                  </p>

                  {/* 文件预览 */}
                  {previewUrl && (
                    <div className="mt-3 relative rounded-lg overflow-hidden border bg-slate-50 dark:bg-slate-800">
                      {previewType === "image" ? (
                        <img
                          src={previewUrl}
                          alt="预览"
                          className="w-full h-40 object-contain"
                        />
                      ) : previewType === "video" ? (
                        <video
                          src={previewUrl}
                          controls
                          className="w-full h-40 object-contain"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          clearPreview();
                          // 清空文件输入
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

                <div className="space-y-2">
                  <Label htmlFor="targetUrl">跳转链接</Label>
                  <Input
                    id="targetUrl"
                    name="targetUrl"
                    type="url"
                    placeholder="https://example.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priority">优先级</Label>
                    <Input
                      id="priority"
                      name="priority"
                      type="number"
                      defaultValue="0"
                      min="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      数字越大越靠前
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
                          const hidden = document.getElementById(
                            "create-isActive-hidden"
                          ) as HTMLInputElement;
                          if (hidden) hidden.value = String(checked);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter>
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
          <div className="flex flex-wrap items-center gap-4">
            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索广告标题..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* 数据源筛选 */}
            <Select value={filterSource} disabled>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="数据源" />
              </SelectTrigger>
              <SelectContent>
                {filterSource === "supabase" ? (
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

            {/* 位置筛选 */}
            <Select value={filterPosition} onValueChange={setFilterPosition}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="位置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部位置</SelectItem>
                <SelectItem value="top">顶部横幅</SelectItem>
                <SelectItem value="bottom">底部横幅</SelectItem>
                <SelectItem value="left">输入框左侧</SelectItem>
                <SelectItem value="right">输入框右侧</SelectItem>
                <SelectItem value="bottom-left">底部左侧</SelectItem>
                <SelectItem value="bottom-right">底部右侧</SelectItem>
                <SelectItem value="sidebar">侧边栏竖向</SelectItem>
              </SelectContent>
            </Select>

            {/* 状态筛选 */}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[120px]">
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
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                清除筛选
              </Button>
            )}
          </div>

          {/* 筛选结果统计 */}
          {hasFilters && (
            <div className="mt-3 text-sm text-muted-foreground">
              找到 {filteredAds.length} 条结果（共 {ads.length} 条）
            </div>
          )}
        </CardContent>
      </Card>

      {/* 广告列表 */}
      <Card>
        <CardHeader>
          <CardTitle>广告列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAds.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasFilters ? "没有符合筛选条件的广告" : "暂无广告，点击\"新增广告\"开始添加"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">预览</TableHead>
                    <TableHead className="min-w-[120px]">标题</TableHead>
                    <TableHead className="w-32">数据源</TableHead>
                    <TableHead className="w-28">位置</TableHead>
                    <TableHead className="w-24">类型</TableHead>
                    <TableHead className="w-40">上传时间</TableHead>
                    <TableHead className="w-20 text-center">优先级</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAds.map((ad) => (
                    <TableRow key={ad.id}>
                      <TableCell className="p-2">
                        <button
                          type="button"
                          onClick={() => setListPreviewAd(ad)}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          title="点击预览"
                        >
                          {ad.media_type === "image" ? (
                            <img
                              src={ad.media_url || undefined}
                              alt={ad.title}
                              className="w-12 h-8 object-cover rounded"
                            />
                          ) : (
                            <div className="w-12 h-8 bg-slate-100 dark:bg-slate-800 rounded flex items-center justify-center">
                              <Video className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{ad.title}</TableCell>
                      <TableCell>
                        {ad.source === "supabase" ? (
                          <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 whitespace-nowrap">
                            <Database className="h-3 w-3" />
                            <span>Supabase</span>
                          </Badge>
                        ) : ad.source === "cloudbase" ? (
                          <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 whitespace-nowrap">
                            <Cloud className="h-3 w-3" />
                            <span>CloudBase</span>
                          </Badge>
                        ) : (
                          <Badge variant="default" className="gap-1 text-xs px-2 py-0.5 whitespace-nowrap">
                            <Database className="h-3 w-3" />
                            <Cloud className="h-3 w-3" />
                            <span>双源</span>
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs px-2 py-0.5 w-fit whitespace-nowrap">
                          {ad.position === "top" ? "顶部" :
                           ad.position === "bottom" ? "底部" :
                           ad.position === "left" ? "左侧" :
                           ad.position === "right" ? "右侧" :
                           ad.position === "bottom-left" ? "底部左" :
                           ad.position === "bottom-right" ? "底部右" :
                           ad.position === "sidebar" ? "侧栏" : ad.position}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 whitespace-nowrap">
                          {ad.media_type === "image" ? (
                            <>
                              <ImageIcon className="h-3 w-3" />
                              图片
                            </>
                          ) : (
                            <>
                              <Video className="h-3 w-3" />
                              视频
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {ad.created_at ? (
                          <div className="flex flex-col leading-tight">
                            <span className="text-xs tabular-nums text-foreground/90 whitespace-nowrap">
                              {new Date(ad.created_at).toLocaleDateString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                              {new Date(ad.created_at).toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="justify-center min-w-12 text-xs tabular-nums">
                          {ad.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 px-2 ${
                            ad.is_active
                              ? "text-green-600"
                              : "text-muted-foreground"
                          }`}
                          onClick={() => handleToggle(ad)}
                          disabled={toggling === ad.id}
                        >
                          {toggling === ad.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : ad.is_active ? (
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
                              setEditing(ad);
                              setEditDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认删除</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定要删除广告「{ad.title}」吗？此操作不可恢复。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(ad)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  {deleting === ad.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    "删除"
                                  )}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑广告</DialogTitle>
            <DialogDescription>
              修改广告信息，媒体文件不支持更换
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">广告标题 *</Label>
                <Input
                  id="edit-title"
                  name="title"
                  defaultValue={editing.title}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-targetUrl">跳转链接</Label>
                <Input
                  id="edit-targetUrl"
                  name="targetUrl"
                  type="url"
                  defaultValue={editing.target_url || ""}
                  placeholder="https://example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-priority">优先级</Label>
                  <Input
                    id="edit-priority"
                    name="priority"
                    type="number"
                    defaultValue={editing.priority}
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
      <Dialog open={!!listPreviewAd} onOpenChange={(open) => !open && setListPreviewAd(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {listPreviewAd?.media_type === "image" ? (
                <ImageIcon className="h-5 w-5" />
              ) : (
                <Video className="h-5 w-5" />
              )}
              {listPreviewAd?.title}
            </DialogTitle>
            <DialogDescription>
              {listPreviewAd?.position === "top" ? "顶部广告位" :
               listPreviewAd?.position === "bottom" ? "底部广告位" :
               listPreviewAd?.position === "left" ? "输入框左侧广告位" :
               listPreviewAd?.position === "right" ? "输入框右侧广告位" :
               listPreviewAd?.position === "bottom-left" ? "底部左侧广告位" :
               listPreviewAd?.position === "bottom-right" ? "底部右侧广告位" :
               listPreviewAd?.position === "sidebar" ? "侧边栏广告位" : "广告位"} ·
              优先级: {listPreviewAd?.priority} ·
              {listPreviewAd?.is_active ? "已上架" : "已下架"}
            </DialogDescription>
          </DialogHeader>

          {listPreviewAd && (
            <div className="space-y-4">
              {/* 媒体预览 */}
              <div className="rounded-lg overflow-hidden border bg-slate-50 dark:bg-slate-900">
                {listPreviewAd.media_type === "image" ? (
                  <img
                    src={listPreviewAd.media_url || undefined}
                    alt={listPreviewAd.title}
                    className="w-full max-h-[60vh] object-contain"
                  />
                ) : (
                  <video
                    src={listPreviewAd.media_url || undefined}
                    controls
                    autoPlay
                    className="w-full max-h-[60vh]"
                  />
                )}
              </div>

              {/* 跳转链接 */}
              {listPreviewAd.target_url && (
                <div className="text-sm">
                  <span className="text-muted-foreground">跳转链接：</span>
                  <a
                    href={listPreviewAd.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline ml-1"
                  >
                    {listPreviewAd.target_url}
                  </a>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setListPreviewAd(null)}>
              关闭
            </Button>
            <Button
              onClick={() => {
                if (listPreviewAd) {
                  setEditing(listPreviewAd);
                  setEditDialogOpen(true);
                  setListPreviewAd(null);
                }
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />
              编辑
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
