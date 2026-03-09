"use server";

import { revalidatePath } from "next/cache";
import {
  AdminActionResult,
  createTextId,
  parseIntOr,
  requireAdminContext,
  writeAdminAuditLog,
} from "@/actions/admin-common";

export type AdminSocialLink = {
  id: string;
  source: string;
  name: string;
  description: string | null;
  url: string;
  icon_url: string | null;
  platform_type: string;
  status: "active" | "inactive";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SocialLink = {
  id: string;
  name: string;
  title: string;
  description?: string | null;
  url: string;
  icon?: string | null;
  icon_url?: string | null;
  platform_type: string;
  region: "global" | "cn" | "both";
  source: "supabase" | "cloudbase" | "both";
  status: "active" | "inactive";
  is_active: boolean;
  sort_order: number;
  target_url: string;
  created_at: string;
  updated_at: string;
};

function normalizeStatus(input: string | null | undefined): "active" | "inactive" {
  return String(input || "").toLowerCase() === "inactive" ? "inactive" : "active";
}

function mapSourceToUi(source: string): "supabase" | "cloudbase" | "both" {
  if (source === "cn") return "cloudbase";
  if (source === "global") return "supabase";
  return "both";
}

function mapAdminSocialLink(item: AdminSocialLink): SocialLink {
  return {
    id: item.id,
    name: item.name,
    title: item.name,
    description: item.description,
    url: item.url,
    icon: item.icon_url,
    icon_url: item.icon_url,
    platform_type: item.platform_type || "website",
    region: item.source === "cn" ? "cn" : "global",
    source: mapSourceToUi(item.source),
    status: normalizeStatus(item.status),
    is_active: normalizeStatus(item.status) === "active",
    sort_order: item.sort_order || 0,
    target_url: item.url,
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

async function uploadSocialIconIfNeeded(
  db: NonNullable<Awaited<ReturnType<typeof requireAdminContext>>["db"]>,
  file: FormDataEntryValue | null,
  sourceScope: string,
) {
  if (!(file instanceof File) || file.size <= 0) {
    return null;
  }

  const extRaw = file.name.includes(".") ? file.name.split(".").pop() || "bin" : "bin";
  const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const objectPath = `${sourceScope}/social-icons/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
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

export async function getAdminSocialLinks(
  _source: "all" | "global" | "cn" = "all",
): Promise<AdminSocialLink[]> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return [];
  }

  const { data, error } = await db
    .from("social_links")
    .select("*")
    .eq("source", sourceScope)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data || []) as AdminSocialLink[];
}

export async function createAdminSocialLink(
  formData: FormData,
): Promise<AdminActionResult<{ id: string }>> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const name = String(formData.get("name") || formData.get("title") || "").trim();
  const url = String(formData.get("url") || formData.get("targetUrl") || "").trim();
  const uploadedIconUrl = await uploadSocialIconIfNeeded(db, formData.get("file"), sourceScope);
  const iconUrl = String(
    formData.get("icon_url") || formData.get("icon") || uploadedIconUrl || "",
  ).trim();
  const isActiveRaw = formData.get("isActive");
  const statusFromSwitch =
    isActiveRaw === null ? null : String(isActiveRaw).toLowerCase() === "true" ? "active" : "inactive";

  const payload = {
    id: createTextId("social"),
    source: sourceScope,
    name,
    description: String(formData.get("description") || "").trim() || null,
    url,
    icon_url: iconUrl || null,
    platform_type: String(formData.get("platform_type") || "website"),
    status: normalizeStatus((formData.get("status") as string | null) || statusFromSwitch),
    sort_order: parseIntOr(
      (formData.get("sort_order") as string | null) || (formData.get("sortOrder") as string | null),
      0,
    ),
    created_by: session.userId,
  };

  if (!payload.name || !payload.url) {
    return { success: false, error: "名称和链接不能为空" };
  }

  const { data, error } = await db
    .from("social_links")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: "创建社交链接失败" };
  }

  await writeAdminAuditLog({
    action: "create_social_link",
    targetType: "social_links",
    targetId: data.id,
    source: payload.source,
    afterJson: payload,
  });

  revalidatePath("/admin/social-links");
  return { success: true, data: { id: data.id } };
}

export async function updateAdminSocialLink(
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

  if (formData.has("name") || formData.has("title")) {
    const name = String(formData.get("name") || formData.get("title") || "").trim();
    if (!name) {
      return { success: false, error: "名称不能为空" };
    }
    updates.name = name;
  }
  if (formData.has("url") || formData.has("targetUrl")) {
    const url = String(formData.get("url") || formData.get("targetUrl") || "").trim();
    if (!url) {
      return { success: false, error: "链接不能为空" };
    }
    updates.url = url;
  }
  if (formData.has("description")) {
    updates.description = String(formData.get("description") || "").trim() || null;
  }
  if (formData.has("icon_url") || formData.has("icon")) {
    updates.icon_url = String(formData.get("icon_url") || formData.get("icon") || "").trim() || null;
  }
  const uploadedIconUrl = await uploadSocialIconIfNeeded(db, formData.get("file"), sourceScope);
  if (uploadedIconUrl) {
    updates.icon_url = uploadedIconUrl;
  }
  if (formData.has("platform_type")) {
    updates.platform_type = String(formData.get("platform_type") || "website");
  }
  if (formData.has("isActive")) {
    updates.status = String(formData.get("isActive")).toLowerCase() === "true" ? "active" : "inactive";
  } else if (formData.has("status")) {
    updates.status = normalizeStatus(formData.get("status") as string | null);
  }
  if (formData.has("sort_order") || formData.has("sortOrder")) {
    updates.sort_order = parseIntOr(
      (formData.get("sort_order") as string | null) || (formData.get("sortOrder") as string | null),
      0,
    );
  }

  const { error } = await db
    .from("social_links")
    .update(updates)
    .eq("id", id)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "更新社交链接失败" };
  }

  await writeAdminAuditLog({
    action: "update_social_link",
    targetType: "social_links",
    targetId: id,
    source: sourceScope,
    afterJson: updates,
  });

  revalidatePath("/admin/social-links");
  return { success: true };
}

export async function deleteAdminSocialLink(id: string): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("social_links")
    .delete()
    .eq("id", id)
    .eq("source", sourceScope);
  if (error) {
    return { success: false, error: "删除社交链接失败" };
  }

  await writeAdminAuditLog({
    action: "delete_social_link",
    targetType: "social_links",
    targetId: id,
  });

  revalidatePath("/admin/social-links");
  return { success: true };
}

export async function toggleAdminSocialLinkStatus(
  id: string,
  status: "active" | "inactive",
): Promise<AdminActionResult> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  const { error } = await db
    .from("social_links")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("source", sourceScope);

  if (error) {
    return { success: false, error: "更新状态失败" };
  }

  await writeAdminAuditLog({
    action: "toggle_social_link_status",
    targetType: "social_links",
    targetId: id,
    source: sourceScope,
    afterJson: { status },
  });

  revalidatePath("/admin/social-links");
  return { success: true };
}

export async function listSocialLinks(
  _region?: string,
): Promise<{ success: boolean; data?: SocialLink[]; error?: string }> {
  try {
    const links = await getAdminSocialLinks("all");
    return { success: true, data: links.map(mapAdminSocialLink) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "获取社交链接失败" };
  }
}

export async function createSocialLink(
  formData: FormData | Record<string, unknown>,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const result = await createAdminSocialLink(toFormData(formData));
  return {
    success: result.success,
    error: result.error,
    id: result.data?.id,
  };
}

export async function updateSocialLink(
  id: string,
  formData: FormData | Record<string, unknown>,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await updateAdminSocialLink(id, toFormData(formData));
  return {
    success: result.success,
    error: result.error,
  };
}

export async function deleteSocialLink(
  id: string,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await deleteAdminSocialLink(id);
  return {
    success: result.success,
    error: result.error,
  };
}

export async function toggleSocialLinkStatus(
  id: string,
  isActive: boolean,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await toggleAdminSocialLinkStatus(id, isActive ? "active" : "inactive");
  return {
    success: result.success,
    error: result.error,
  };
}

export async function updateSocialLinksOrder(
  links: Array<{ id: string; sort_order: number }>,
  _region?: string,
): Promise<{ success: boolean; error?: string }> {
  const { session, db, sourceScope } = await requireAdminContext();
  if (!session || !db) {
    return { success: false, error: "未授权访问" };
  }

  for (const item of links) {
    const { error } = await db
      .from("social_links")
      .update({
        sort_order: parseIntOr(item.sort_order, 0),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("source", sourceScope);

    if (error) {
      return { success: false, error: "更新排序失败" };
    }
  }

  await writeAdminAuditLog({
    action: "reorder_social_links",
    targetType: "social_links",
    source: sourceScope,
    afterJson: links,
  });

  revalidatePath("/admin/social-links");
  return { success: true };
}
