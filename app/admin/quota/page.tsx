"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  getQuotaConfig,
  updateAddonPackageLimits,
  updateSubscriptionPlanLimits,
  type AddonPackageRow,
  type SubscriptionPlanRow,
} from "@/actions/admin-quota";
import {
  getAdminAppDisplayName,
  updateAdminAppDisplayName,
} from "@/actions/admin-branding";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";

function getSourceLabel() {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh").toLowerCase();
  return language.startsWith("zh") ? "国内版（cn）" : "国际版（global）";
}

export default function AdminQuotaPage() {
  const [plans, setPlans] = useState<SubscriptionPlanRow[]>([]);
  const [addons, setAddons] = useState<AddonPackageRow[]>([]);
  const [appDisplayName, setAppDisplayName] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [savingAddon, setSavingAddon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sourceLabel = useMemo(() => getSourceLabel(), []);

  async function loadConfig() {
    setLoadingConfig(true);
    try {
      const [quotaResult, brandingResult] = await Promise.all([
        getQuotaConfig(),
        getAdminAppDisplayName(),
      ]);
      setPlans(quotaResult.plans || []);
      setAddons(quotaResult.addons || []);
      setAppDisplayName(brandingResult.appDisplayName || "");
    } catch {
      setError("加载套餐与加油包配置失败");
    } finally {
      setLoadingConfig(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function handleRefresh() {
    setError(null);
    setSuccess(null);
    await loadConfig();
  }

  async function handleSaveDisplayName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingDisplayName(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData(e.currentTarget);
    const result = await updateAdminAppDisplayName(formData);

    if (!result.success) {
      setError(result.error || "更新项目名称失败");
    } else {
      const nextDisplayName = result.data?.appDisplayName || appDisplayName.trim();
      setAppDisplayName(nextDisplayName);
      setSuccess(`项目名称已更新为 ${nextDisplayName}`);
      await loadConfig();
    }

    setSavingDisplayName(false);
  }

  async function handleSavePlan(planCode: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingPlan(planCode);
    setError(null);
    setSuccess(null);

    const formData = new FormData(e.currentTarget);
    formData.set("plan_code", planCode);
    const result = await updateSubscriptionPlanLimits(formData);

    if (!result.success) {
      setError(result.error || "更新套餐额度失败");
    } else {
      setSuccess(`套餐 ${planCode} 额度已更新`);
      await loadConfig();
    }

    setSavingPlan(null);
  }

  async function handleSaveAddon(addonCode: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingAddon(addonCode);
    setError(null);
    setSuccess(null);

    const formData = new FormData(e.currentTarget);
    formData.set("addon_code", addonCode);
    const result = await updateAddonPackageLimits(formData);

    if (!result.success) {
      setError(result.error || "更新加油包额度失败");
    } else {
      setSuccess(`加油包 ${addonCode} 额度已更新`);
      await loadConfig();
    }

    setSavingAddon(null);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">额度管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            套餐基础额度与加油包额度调整
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{sourceLabel}</Badge>
          <Button variant="outline" onClick={handleRefresh} disabled={loadingConfig}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingConfig ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">名称更改</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void handleSaveDisplayName(e)}
            className="flex flex-col gap-3 md:flex-row md:items-center"
          >
            <Input
              name="app_display_name"
              value={appDisplayName}
              onChange={(e) => setAppDisplayName(e.target.value)}
              placeholder="请输入项目名称"
              className="md:max-w-md"
              maxLength={64}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={savingDisplayName || !appDisplayName.trim()}
            >
              {savingDisplayName && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              一键改名
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            保存后将同步更新前台标题、后台标题与浏览器页面标题。
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">套餐基础额度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingConfig ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              plans.map((plan) => (
                <form
                  key={plan.plan_code}
                  onSubmit={(e) => void handleSavePlan(plan.plan_code, e)}
                  className="rounded-md border border-slate-200 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{plan.display_name_cn}</div>
                    <Badge variant="outline">{plan.plan_code}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <QuotaInput label="文档" name="monthly_document_limit" defaultValue={plan.monthly_document_limit} />
                    <QuotaInput label="图片" name="monthly_image_limit" defaultValue={plan.monthly_image_limit} />
                    <QuotaInput label="视频" name="monthly_video_limit" defaultValue={plan.monthly_video_limit} />
                    <QuotaInput label="音频" name="monthly_audio_limit" defaultValue={plan.monthly_audio_limit} />
                  </div>
                  <Button type="submit" variant="outline" size="sm" disabled={savingPlan === plan.plan_code}>
                    {savingPlan === plan.plan_code && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    保存套餐额度
                  </Button>
                </form>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">加油包额度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingConfig ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              addons.map((addon) => (
                <form
                  key={addon.addon_code}
                  onSubmit={(e) => void handleSaveAddon(addon.addon_code, e)}
                  className="rounded-md border border-slate-200 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{addon.display_name_cn}</div>
                    <Badge variant="outline">{addon.addon_code}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <QuotaInput label="文档" name="document_quota" defaultValue={addon.document_quota} />
                    <QuotaInput label="图片" name="image_quota" defaultValue={addon.image_quota} />
                    <QuotaInput label="视频" name="video_quota" defaultValue={addon.video_quota} />
                    <QuotaInput label="音频" name="audio_quota" defaultValue={addon.audio_quota} />
                  </div>
                  <Button type="submit" variant="outline" size="sm" disabled={savingAddon === addon.addon_code}>
                    {savingAddon === addon.addon_code && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    保存加油包额度
                  </Button>
                </form>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuotaInput({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <Input name={name} type="number" defaultValue={defaultValue} className="mt-1" />
    </label>
  );
}
