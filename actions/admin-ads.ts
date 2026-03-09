"use server";

import { revalidatePath } from "next/cache";
import {
  AdminActionResult,
  createTextId,
  parseIntOr,
  requireAdminContext,
  writeAdminAuditLog,
} from "@/actions/admin-common";

export type AdminAd = {
  id: string;
  source: string;
  title: string;
  description: string | null;
  media_type: "image" | "video";
  media_url: string | null;
  thumbnail_url: string | null;
  link_url: string | null;
  link_type: "external" | "internal" | "download";
  position: string;
  platform: string;
  status: "active" | "inactive" | "scheduled";
  priority: number;
  start_at: string | null;
  end_at: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
  updated_at: string;
};

function normalizeMediaType(input: string | null | undefined): "image" | "video" {
  return String(input || "").toLowerCase() === "video" ? "video" : "image";
}

function normalizeStatus(input: string | null | undefined): "active" | "inactive" | "scheduled" {
  const value = String(input || "").toLowerCase();
  if (value === "inactive") return "inactive";
  if (value === "scheduled") return "scheduled";
  return "active";
}

function normalizeLinkType(input: string | null | undefined): "external" | "internal" | "download" {
  const value = String(input || "").toLowerCase();
  if (value === "internal") return "internal";
  if (value === "download") return "download";
  return "external";
}

async function uploadAdFileIfNeeded(
  db: NonNullable<Awaited<ReturnType<typeof requireAdminContext>>["db"]>,
  file: FormDataEntryValue | null,
  sourceScope: string,
) {
  if (!(file instanceof File) || file.size <= 0) {
    return null;
  }

  const extRaw = file.name.includes(".") ? file.name.split(".").pop() || "bin" : "bin";
  const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const objectPath = `${sourceScope}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage.from("ads-media").upload(objectPath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    return null;
  }

  const { data } = db.storage.from("ads-media").getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

export async function getAdminAds(
  _source: "all" | "global" | "cn" = "all",
): Promise<AdminAd[]> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [];
  }

  const { data, error } = await db
    .from("ads")
    .select("*")
    .eq("source", sourceScope)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data || []) as AdminAd[];
}

export async function createAdminAd(formData: FormData): Promise<AdminActionResult<{ id: string }>> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const title = String(formData.get("title") || "").trim();
  const mediaType = normalizeMediaType(
    (formData.get("mediaType") as string | null) || (formData.get("media_type") as string | null),
  );
  const targetUrl = String(
    (formData.get("targetUrl") as string | null) || (formData.get("link_url") as string | null) || "",
  ).trim();
  const manualMediaUrl = String(
    (formData.get("media_url") as string | null) || (formData.get("mediaUrl") as string | null) || "",
  ).trim();
  const uploadedMediaUrl = await uploadAdFileIfNeeded(db, formData.get("file"), sourceScope);
  const finalMediaUrl = uploadedMediaUrl || manualMediaUrl || null;
  const isActiveRaw = formData.get("isActive");
  const statusFromSwitch =
    isActiveRaw === null ? null : String(isActiveRaw).toLowerCase() === "true" ? "active" : "inactive";

  const payload = {
    id: createTextId("ad"),
    source: sourceScope,
    title,
    description: String(formData.get("description") || "").trim() || null,
    media_type: mediaType,
    media_url: finalMediaUrl,
    thumbnail_url:
      String(formData.get("thumbnail_url") || "").trim() ||
      (mediaType === "image" ? finalMediaUrl : "") ||
      null,
    link_url: targetUrl || null,
    link_type: normalizeLinkType(formData.get("link_type") as string | null),
    position: String(formData.get("position") || "top"),
    platform: String(formData.get("platform") || "all"),
    status: normalizeStatus((formData.get("status") as string | null) || statusFromSwitch),
    priority: parseIntOr(formData.get("priority") as string, 0),
    start_at: String(formData.get("start_at") || "").trim() || null,
    end_at: String(formData.get("end_at") || "").trim() || null,
    impressions: 0,
    clicks: 0,
    created_by: session.userId,
  };

  if (!payload.title) {
    return { success: false, error: "标题不能为空" };
  }
  if (!payload.media_url) {
    return { success: false, error: "请上传广告素材或填写媒体链接" };
  }

  const { data, error } = await db.from("ads").insert(payload).select("id").single();
  if (error || !data) {
    return { success: false, error: "创建广告失败" };
  }

  await writeAdminAuditLog({
    action: "create_ad",
    targetType: "ads",
    targetId: data.id,
    source: payload.source,
    afterJson: payload,
  });

  revalidatePath("/admin/ads");
  return { success: true, data: { id: data.id } };
}

export async function updateAdminAd(
  id: string,
  formData: FormData,
): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const title = String(formData.get("title") || "").trim();
  if (!title) {
    return { success: false, error: "标题不能为空" };
  }

  const updates: Record<string, unknown> = {
    source: sourceScope,
    title,
    updated_at: new Date().toISOString(),
  };

  if (formData.has("description")) {
    updates.description = String(formData.get("description") || "").trim() || null;
  }
  if (formData.has("media_type") || formData.has("mediaType")) {
    updates.media_type = normalizeMediaType(
      (formData.get("mediaType") as string | null) || (formData.get("media_type") as string | null),
    );
  }
  if (formData.has("media_url") || formData.has("mediaUrl")) {
    updates.media_url =
      String(
        (formData.get("media_url") as string | null) || (formData.get("mediaUrl") as string | null) || "",
      ).trim() || null;
  }
  if (formData.has("thumbnail_url")) {
    updates.thumbnail_url = String(formData.get("thumbnail_url") || "").trim() || null;
  }
  if (formData.has("targetUrl") || formData.has("link_url")) {
    updates.link_url =
      String(
        (formData.get("targetUrl") as string | null) || (formData.get("link_url") as string | null) || "",
      ).trim() || null;
  }
  if (formData.has("link_type")) {
    updates.link_type = normalizeLinkType(formData.get("link_type") as string | null);
  }
  if (formData.has("position")) {
    updates.position = String(formData.get("position") || "top");
  }
  if (formData.has("platform")) {
    updates.platform = String(formData.get("platform") || "all");
  }
  if (formData.has("isActive")) {
    updates.status = String(formData.get("isActive")).toLowerCase() === "true" ? "active" : "inactive";
  } else if (formData.has("status")) {
    updates.status = normalizeStatus(formData.get("status") as string | null);
  }
  if (formData.has("priority")) {
    updates.priority = parseIntOr(formData.get("priority") as string, 0);
  }
  if (formData.has("start_at")) {
    updates.start_at = String(formData.get("start_at") || "").trim() || null;
  }
  if (formData.has("end_at")) {
    updates.end_at = String(formData.get("end_at") || "").trim() || null;
  }

  const { error } = await db
    .from("ads")
    .update(updates)
    .eq("id", id)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "更新广告失败" };
  }

  await writeAdminAuditLog({
    action: "update_ad",
    targetType: "ads",
    targetId: id,
    source: sourceScope,
    afterJson: updates,
  });

  revalidatePath("/admin/ads");
  return { success: true };
}

export async function deleteAdminAd(id: string): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db.from("ads").delete().eq("id", id).eq("source", sourceScope);
  if (error) {
    return { success: false, error: "删除广告失败" };
  }

  await writeAdminAuditLog({
    action: "delete_ad",
    targetType: "ads",
    targetId: id,
  });

  revalidatePath("/admin/ads");
  return { success: true };
}

export async function toggleAdminAdStatus(
  id: string,
  status: "active" | "inactive" | "scheduled",
): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("ads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("source", sourceScope);

  if (error) {
    return { success: false, error: "更新状态失败" };
  }

  await writeAdminAuditLog({
    action: "toggle_ad_status",
    targetType: "ads",
    targetId: id,
    source: sourceScope,
    afterJson: { status },
  });

  revalidatePath("/admin/ads");
  return { success: true };
}
