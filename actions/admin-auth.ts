"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminSourceScope } from "@/lib/admin/source-scope";
import { getRoutedAdminDbClient } from "@/lib/server/database-routing";
import {
  createAdminSession,
  destroyAdminSession,
  getAdminSession,
  verifyAdminSession,
} from "@/lib/admin/session";
import { hashPassword, verifyPassword } from "@/lib/admin/password";

type LoginResult = {
  success: boolean;
  error?: string;
};

type ActionResult = {
  success: boolean;
  error?: string;
};

export async function adminLogin(formData: FormData): Promise<LoginResult> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { success: false, error: "请输入用户名和密码" };
  }

  const db = await getRoutedAdminDbClient(getAdminSourceScope());
  if (!db) {
    return { success: false, error: "后台数据库未配置" };
  }

  const { data: admin, error } = await db
    .from("admin_users")
    .select("id, username, password_hash, role, status")
    .eq("username", username)
    .maybeSingle();

  if (error || !admin) {
    return { success: false, error: "用户名或密码错误" };
  }

  if (admin.status !== "active") {
    return { success: false, error: "管理员账号已禁用" };
  }

  const ok = await verifyPassword(password, admin.password_hash || "");
  if (!ok) {
    return { success: false, error: "用户名或密码错误" };
  }

  await db
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", admin.id);

  await createAdminSession({
    userId: admin.id,
    username: admin.username,
    role: admin.role || "admin",
  });

  return { success: true };
}

export async function adminLogout() {
  await destroyAdminSession();
  redirect("/admin/login");
}

export async function getCurrentAdmin() {
  return getAdminSession();
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}

export async function isAdminLoggedIn() {
  return verifyAdminSession();
}

export async function changeAdminPassword(formData: FormData): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) {
    return { success: false, error: "未登录" };
  }

  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { success: false, error: "请填写完整信息" };
  }
  if (newPassword.length < 8) {
    return { success: false, error: "新密码至少 8 位" };
  }
  if (newPassword !== confirmPassword) {
    return { success: false, error: "两次输入的新密码不一致" };
  }

  const db = await getRoutedAdminDbClient(getAdminSourceScope());
  if (!db) {
    return { success: false, error: "后台数据库未配置" };
  }

  const { data: admin, error } = await db
    .from("admin_users")
    .select("id, password_hash")
    .eq("id", session.userId)
    .maybeSingle();

  if (error || !admin) {
    return { success: false, error: "管理员不存在" };
  }

  const ok = await verifyPassword(currentPassword, admin.password_hash || "");
  if (!ok) {
    return { success: false, error: "当前密码错误" };
  }

  const newHash = await hashPassword(newPassword);
  const { error: updateError } = await db
    .from("admin_users")
    .update({ password_hash: newHash })
    .eq("id", admin.id);

  if (updateError) {
    return { success: false, error: "更新密码失败" };
  }

  revalidatePath("/admin");
  return { success: true };
}
