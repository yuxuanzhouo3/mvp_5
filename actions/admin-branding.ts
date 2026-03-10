"use server";

import { revalidatePath } from "next/cache";
import {
  type AdminActionResult,
  requireAdminContext,
  writeAdminAuditLog,
} from "@/actions/admin-common";
import {
  APP_DISPLAY_NAME_FALLBACK,
  APP_DISPLAY_NAME_MAX_LENGTH,
  APP_DISPLAY_NAME_SETTING_KEY,
  getAppDisplayName,
  normalizeDisplayName,
  resolveDisplayName,
} from "@/lib/app-branding";

export async function getAdminAppDisplayName() {
  const appDisplayName = await getAppDisplayName();
  return { appDisplayName };
}

export async function updateAdminAppDisplayName(
  formData: FormData,
): Promise<AdminActionResult<{ appDisplayName: string }>> {
  const { session, db } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const rawDisplayName = formData.get("app_display_name");
  const nextDisplayName = normalizeDisplayName(rawDisplayName);
  if (!nextDisplayName) {
    return { success: false, error: "项目名称不能为空" };
  }
  if (nextDisplayName.length > APP_DISPLAY_NAME_MAX_LENGTH) {
    return {
      success: false,
      error: `项目名称最多 ${APP_DISPLAY_NAME_MAX_LENGTH} 个字符`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: beforeRow, error: beforeError } = await db
    .from("app_settings")
    .select("setting_key, setting_value, updated_at")
    .eq("setting_key", APP_DISPLAY_NAME_SETTING_KEY)
    .maybeSingle();

  if (beforeError) {
    return { success: false, error: "读取当前项目名称失败" };
  }

  const previousDisplayName = resolveDisplayName(beforeRow?.setting_value);

  if (beforeRow) {
    const { error: updateError } = await db
      .from("app_settings")
      .update({
        setting_value: nextDisplayName,
        updated_at: nowIso,
      })
      .eq("setting_key", APP_DISPLAY_NAME_SETTING_KEY);

    if (updateError) {
      return { success: false, error: "更新项目名称失败" };
    }
  } else {
    const { error: insertError } = await db.from("app_settings").insert({
      setting_key: APP_DISPLAY_NAME_SETTING_KEY,
      setting_value: nextDisplayName,
      updated_at: nowIso,
    });

    if (insertError) {
      return { success: false, error: "创建项目名称配置失败" };
    }
  }

  await writeAdminAuditLog({
    action: "update_app_display_name",
    targetType: "app_settings",
    targetId: APP_DISPLAY_NAME_SETTING_KEY,
    beforeJson: { app_display_name: previousDisplayName || APP_DISPLAY_NAME_FALLBACK },
    afterJson: { app_display_name: nextDisplayName },
  });

  revalidatePath("/", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/login");
  revalidatePath("/admin/quota");

  return {
    success: true,
    data: {
      appDisplayName: nextDisplayName,
    },
  };
}
