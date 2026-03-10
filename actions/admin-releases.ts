"use server";

import { revalidatePath } from "next/cache";
import {
  AdminActionResult,
  createTextId,
  parseIntOr,
  requireAdminContext,
  writeAdminAuditLog,
} from "@/actions/admin-common";

export type AdminRelease = {
  id: string;
  source: string;
  platform: string;
  version: string;
  version_code: number;
  title: string;
  description: string | null;
  release_notes: string | null;
  download_url: string | null;
  backup_download_url: string | null;
  file_size_bytes: number | null;
  file_hash: string | null;
  status: "draft" | "published" | "deprecated";
  is_force_update: boolean;
  min_supported_version: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppRelease = {
  id: string;
  version: string;
  version_code: number;
  title: string;
  description?: string;
  release_notes?: string;
  download_url?: string;
  file_url?: string;
  download_url_backup?: string;
  file_size?: number;
  file_hash?: string;
  platform: string;
  variant?: string;
  region: "global" | "cn" | "both";
  status: "draft" | "published" | "deprecated";
  is_active: boolean;
  is_force_update: boolean;
  is_mandatory?: boolean;
  min_supported_version?: string;
  published_at?: string;
  source: "supabase" | "cloudbase" | "both";
  created_at: string;
  updated_at: string;
};

export type Platform = string;
export type Variant = string;

function normalizeReleaseStatus(input: string | null | undefined): "draft" | "published" | "deprecated" {
  const value = String(input || "").toLowerCase();
  if (value === "published") return "published";
  if (value === "deprecated") return "deprecated";
  return "draft";
}

function mapReleaseSource(source: string): "supabase" | "cloudbase" | "both" {
  if (source === "cn") return "cloudbase";
  if (source === "global") return "supabase";
  return "both";
}

function mapRelease(item: AdminRelease): AppRelease {
  const status = normalizeReleaseStatus(item.status);
  const source = mapReleaseSource(item.source);
  return {
    id: item.id,
    version: item.version,
    version_code: item.version_code,
    title: item.title,
    description: item.description || undefined,
    release_notes: item.release_notes || undefined,
    download_url: item.download_url || undefined,
    file_url: item.download_url || undefined,
    download_url_backup: item.backup_download_url || undefined,
    file_size: item.file_size_bytes || undefined,
    file_hash: item.file_hash || undefined,
    platform: item.platform,
    region: item.source === "cn" ? "cn" : "global",
    status,
    is_active: status === "published",
    is_force_update: item.is_force_update,
    is_mandatory: item.is_force_update,
    min_supported_version: item.min_supported_version || undefined,
    published_at: item.published_at || undefined,
    source,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function toFormData(input: FormData | Record<string, unknown>) {
  if (input instanceof FormData) {
    return input;
  }
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (value instanceof Blob) {
      formData.set(key, value);
      continue;
    }
    formData.set(key, String(value));
  }
  return formData;
}

async function uploadReleaseFileIfNeeded(
  db: NonNullable<Awaited<ReturnType<typeof requireAdminContext>>["db"]>,
  file: FormDataEntryValue | null,
  sourceScope: string,
) {
  if (!(file instanceof File) || file.size <= 0) {
    return null;
  }

  const extRaw = file.name.includes(".") ? file.name.split(".").pop() || "bin" : "bin";
  const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const objectPath = `${sourceScope}/releases/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage.from("release-packages").upload(objectPath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    return null;
  }

  const { data } = await db.storage.from("release-packages").getPublicUrl(objectPath);
  return {
    url: data?.publicUrl || null,
    size: file.size || null,
  };
}

export async function getAdminReleases(
  _source: "all" | "global" | "cn" = "all",
  platform: string = "all",
): Promise<AdminRelease[]> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [];
  }

  let query = db
    .from("app_releases")
    .select("*")
    .eq("source", sourceScope)
    .order("platform", { ascending: true })
    .order("version_code", { ascending: false });

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) {
    return [];
  }
  return (data || []) as AdminRelease[];
}

export async function createAdminRelease(
  formData: FormData,
): Promise<AdminActionResult<{ id: string }>> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const platform = String(formData.get("platform") || "").trim();
  const version = String(formData.get("version") || "").trim();
  const releaseTitle = String(formData.get("title") || "").trim();
  const releaseNotes = String(formData.get("release_notes") || formData.get("releaseNotes") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isActiveRaw = formData.get("isActive");
  const statusFromSwitch =
    isActiveRaw === null ? null : String(isActiveRaw).toLowerCase() === "true" ? "published" : "draft";
  const isMandatoryRaw = formData.get("isMandatory");
  const isForceUpdateFromSwitch =
    isMandatoryRaw === null ? null : String(isMandatoryRaw).toLowerCase() === "true";
  const uploadedFile = await uploadReleaseFileIfNeeded(db, formData.get("file"), sourceScope);
  const downloadUrl = String(formData.get("download_url") || uploadedFile?.url || "").trim();

  const payload = {
    id: createTextId("release"),
    source: sourceScope,
    platform,
    version,
    version_code: parseIntOr(
      (formData.get("version_code") as string | null) || (formData.get("versionCode") as string | null),
      1,
    ),
    title: releaseTitle || `${platform || "app"} ${version || ""}`.trim(),
    description: description || null,
    release_notes: releaseNotes || null,
    download_url: downloadUrl || null,
    backup_download_url:
      String(formData.get("backup_download_url") || formData.get("download_url_backup") || "").trim() || null,
    file_size_bytes:
      parseIntOr(formData.get("file_size_bytes") as string | null, 0) ||
      parseIntOr(uploadedFile?.size as number | null, 0) ||
      null,
    file_hash: String(formData.get("file_hash") || "").trim() || null,
    status: normalizeReleaseStatus((formData.get("status") as string | null) || statusFromSwitch),
    is_force_update:
      String(formData.get("is_force_update") || "").toLowerCase() === "true" ||
      String(formData.get("isForceUpdate") || "").toLowerCase() === "true" ||
      Boolean(isForceUpdateFromSwitch),
    min_supported_version:
      String(formData.get("min_supported_version") || "").trim() || null,
    published_at: null as string | null,
    created_by: session.userId,
  };

  if (!payload.platform || !payload.version) {
    return { success: false, error: "平台和版本号不能为空" };
  }

  if (payload.status === "published") {
    payload.published_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from("app_releases")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: "创建版本失败" };
  }

  await writeAdminAuditLog({
    action: "create_release",
    targetType: "app_releases",
    targetId: data.id,
    source: payload.source,
    afterJson: payload,
  });

  revalidatePath("/admin/releases");
  return { success: true, data: { id: data.id } };
}

export async function updateAdminRelease(
  id: string,
  formData: FormData,
): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const updates: Record<string, unknown> = {
    source: sourceScope,
    updated_at: new Date().toISOString(),
  };

  if (formData.has("platform")) {
    const platform = String(formData.get("platform") || "").trim();
    if (!platform) {
      return { success: false, error: "平台不能为空" };
    }
    updates.platform = platform;
  }
  if (formData.has("version")) {
    const version = String(formData.get("version") || "").trim();
    if (!version) {
      return { success: false, error: "版本号不能为空" };
    }
    updates.version = version;
  }
  if (formData.has("version_code") || formData.has("versionCode")) {
    updates.version_code = parseIntOr(
      (formData.get("version_code") as string | null) || (formData.get("versionCode") as string | null),
      1,
    );
  }
  if (formData.has("title")) {
    const title = String(formData.get("title") || "").trim();
    if (!title) {
      return { success: false, error: "标题不能为空" };
    }
    updates.title = title;
  }
  if (formData.has("description")) {
    updates.description = String(formData.get("description") || "").trim() || null;
  }
  if (formData.has("release_notes") || formData.has("releaseNotes")) {
    updates.release_notes =
      String(formData.get("release_notes") || formData.get("releaseNotes") || "").trim() || null;
  }
  if (formData.has("download_url")) {
    updates.download_url = String(formData.get("download_url") || "").trim() || null;
  }
  if (formData.has("backup_download_url") || formData.has("download_url_backup")) {
    updates.backup_download_url =
      String(formData.get("backup_download_url") || formData.get("download_url_backup") || "").trim() || null;
  }
  if (formData.has("file_size_bytes") || formData.has("file_size")) {
    updates.file_size_bytes = parseIntOr(
      (formData.get("file_size_bytes") as string | null) || (formData.get("file_size") as string | null),
      0,
    ) || null;
  }
  if (formData.has("file_hash")) {
    updates.file_hash = String(formData.get("file_hash") || "").trim() || null;
  }
  const uploadedFile = await uploadReleaseFileIfNeeded(db, formData.get("file"), sourceScope);
  if (uploadedFile?.url) {
    updates.download_url = uploadedFile.url;
    updates.file_size_bytes = uploadedFile.size;
  }

  const hasExplicitStatus = formData.has("status");
  const hasActiveFlag = formData.has("isActive");
  if (hasExplicitStatus || hasActiveFlag) {
    const status = hasExplicitStatus
      ? normalizeReleaseStatus(formData.get("status") as string | null)
      : String(formData.get("isActive")).toLowerCase() === "true"
      ? "published"
      : "draft";
    updates.status = status;
    updates.published_at = status === "published" ? new Date().toISOString() : null;
  }

  if (formData.has("is_force_update") || formData.has("isForceUpdate") || formData.has("isMandatory")) {
    updates.is_force_update =
      String(formData.get("is_force_update") || "").toLowerCase() === "true" ||
      String(formData.get("isForceUpdate") || "").toLowerCase() === "true" ||
      String(formData.get("isMandatory") || "").toLowerCase() === "true";
  }
  if (formData.has("min_supported_version")) {
    updates.min_supported_version = String(formData.get("min_supported_version") || "").trim() || null;
  }

  const { error } = await db
    .from("app_releases")
    .update(updates)
    .eq("id", id)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "更新版本失败" };
  }

  await writeAdminAuditLog({
    action: "update_release",
    targetType: "app_releases",
    targetId: id,
    source: sourceScope,
    afterJson: updates,
  });

  revalidatePath("/admin/releases");
  return { success: true };
}

export async function deleteAdminRelease(id: string): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("app_releases")
    .delete()
    .eq("id", id)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "删除版本失败" };
  }

  await writeAdminAuditLog({
    action: "delete_release",
    targetType: "app_releases",
    targetId: id,
  });

  revalidatePath("/admin/releases");
  return { success: true };
}

export async function publishAdminRelease(id: string): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("app_releases")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("source", sourceScope);

  if (error) {
    return { success: false, error: "发布失败" };
  }

  await writeAdminAuditLog({
    action: "publish_release",
    targetType: "app_releases",
    targetId: id,
    source: sourceScope,
  });

  revalidatePath("/admin/releases");
  return { success: true };
}

export async function listReleases(
  _region?: string,
  platform?: string,
): Promise<{ success: boolean; data?: AppRelease[]; error?: string }> {
  try {
    const data = await getAdminReleases("all", platform || "all");
    return { success: true, data: data.map(mapRelease) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "获取版本列表失败" };
  }
}

export async function createRelease(
  formData: FormData | Record<string, unknown>,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const result = await createAdminRelease(toFormData(formData));
  return {
    success: result.success,
    error: result.error,
    id: result.data?.id,
  };
}

export async function updateRelease(
  id: string,
  formData: FormData | Record<string, unknown>,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await updateAdminRelease(id, toFormData(formData));
  return {
    success: result.success,
    error: result.error,
  };
}

export async function deleteRelease(
  id: string,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await deleteAdminRelease(id);
  return {
    success: result.success,
    error: result.error,
  };
}

export async function toggleReleaseStatus(
  id: string,
  isActive: boolean,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const status = isActive ? "published" : "draft";
  const formData = new FormData();
  formData.set("status", status);
  const result = await updateAdminRelease(id, formData);
  return {
    success: result.success,
    error: result.error,
  };
}
