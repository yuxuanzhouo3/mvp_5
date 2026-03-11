"use client";

import { getCloudbaseApp, getCloudbaseAuth } from "@/lib/cloudbase/client";

export type DomesticAuthScene = "signup" | "login" | "reset";

export interface DomesticVerificationInfo {
  verification_id?: string;
  is_user?: boolean;
}

interface DomesticUserProfile {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

function toReadableText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function formatErrorMessage(message: string, code: string) {
  if (!message) {
    return "";
  }
  if (!code || message.includes(code)) {
    return message;
  }
  return `${message} (${code})`;
}

export function extractDomesticAuthErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const direct = toReadableText(error.message);
    if (direct) {
      return direct;
    }
  }

  if (!error || typeof error !== "object") {
    return fallback;
  }

  const payload = error as Record<string, unknown>;
  const nestedError =
    (payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : null) || null;
  const nestedData =
    (payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null) || null;

  const code = toReadableText(
    payload.code ||
      payload.error_code ||
      nestedError?.code ||
      nestedError?.error_code ||
      nestedData?.code ||
      nestedData?.error_code,
  );

  const candidates = [
    payload.message,
    payload.error_description,
    payload.msg,
    payload.errMsg,
    nestedError?.message,
    nestedError?.error_description,
    nestedError?.msg,
    nestedData?.message,
    nestedData?.error_description,
    nestedData?.msg,
  ];

  for (const candidate of candidates) {
    const message = toReadableText(candidate);
    if (message) {
      return formatErrorMessage(message, code);
    }
  }

  if (code) {
    return `${fallback} (${code})`;
  }
  return fallback;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayNameCandidate(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyAccountIdentifier(value: string) {
  if (!value) {
    return false;
  }

  if (value.includes("@")) {
    return true;
  }

  if (/^\d{6,}$/.test(value)) {
    return true;
  }

  if (/^(user|uid|account|账号)[_-]?\d+$/i.test(value)) {
    return true;
  }

  return false;
}

function pickPreferredDisplayName(candidates: unknown[]) {
  const normalized = candidates
    .map((candidate) => normalizeDisplayNameCandidate(candidate))
    .filter(Boolean);

  const preferred = normalized.find(
    (candidate) => !isLikelyAccountIdentifier(candidate),
  );

  return preferred || normalized[0] || null;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function toSqlTimestamp(date: Date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getVerificationId(info: DomesticVerificationInfo | null | undefined) {
  const verificationId = info?.verification_id?.trim();
  if (!verificationId) {
    throw new Error("验证码会话无效，请重新发送验证码");
  }
  return verificationId;
}

async function executeQuery<T = Record<string, unknown>>(
  query: PromiseLike<unknown>,
  defaultError: string,
) {
  const result = (await query) as { data?: T[] | null; error?: { message?: string } | null };
  if (result?.error) {
    throw new Error(result.error.message || defaultError);
  }
  return result.data || [];
}

function extractUserId(loginState: unknown, userInfo: unknown) {
  const stateUser = (loginState as { user?: { uid?: string; id?: string } } | null)?.user;
  const stateDataUser = (loginState as { data?: { user?: { uid?: string; id?: string } } } | null)?.data?.user;
  const infoUser = userInfo as { uid?: string; id?: string } | null;
  return infoUser?.uid || infoUser?.id || stateUser?.uid || stateUser?.id || stateDataUser?.uid || stateDataUser?.id || "";
}

function extractUserEmail(loginState: unknown, userInfo: unknown, fallbackEmail: string) {
  const stateUser = (loginState as { user?: { email?: string } } | null)?.user;
  const stateDataUser = (loginState as { data?: { user?: { email?: string } } } | null)?.data?.user;
  const infoUser = userInfo as { email?: string } | null;
  return normalizeEmail(infoUser?.email || stateUser?.email || stateDataUser?.email || fallbackEmail);
}

function extractUserName(loginState: unknown, userInfo: unknown) {
  const stateUser = (loginState as { user?: { name?: string; username?: string } } | null)?.user;
  const stateDataUser = (loginState as {
    data?: { user?: { user_metadata?: { name?: string; username?: string } } };
  } | null)?.data?.user?.user_metadata;
  const infoUser = userInfo as { name?: string; username?: string } | null;
  return pickPreferredDisplayName([
    infoUser?.name,
    stateUser?.name,
    stateDataUser?.name,
    infoUser?.username,
    stateUser?.username,
    stateDataUser?.username,
  ]);
}

function getUserAgent() {
  if (typeof navigator === "undefined") {
    return null;
  }
  return navigator.userAgent || null;
}

async function logEmailCodeSent(email: string, scene: DomesticAuthScene, verificationInfo: DomesticVerificationInfo) {
  try {
    const verificationId = getVerificationId(verificationInfo);
    const expiresAt = toSqlTimestamp(new Date(Date.now() + 10 * 60 * 1000));

    await executeQuery(
      getCloudbaseApp()
        .mysql()
        .from("email_verification_codes")
        .insert({
          id: createId("email_code"),
          source: "cn",
          email,
          scene,
          code_hash: `cloudbase:${verificationId}`,
          expires_at: expiresAt,
          user_agent: getUserAgent(),
        }),
      "记录验证码发送日志失败",
    );
  } catch (error) {
    console.warn("[domestic-email-auth] logEmailCodeSent failed:", error);
  }
}

async function markEmailCodeConsumed(email: string, scene: DomesticAuthScene, verificationInfo: DomesticVerificationInfo) {
  try {
    const verificationId = getVerificationId(verificationInfo);
    await executeQuery(
      getCloudbaseApp()
        .mysql()
        .from("email_verification_codes")
        .update({
          consumed_at: toSqlTimestamp(),
        })
        .eq("source", "cn")
        .eq("email", email)
        .eq("scene", scene)
        .eq("code_hash", `cloudbase:${verificationId}`),
      "更新验证码状态失败",
    );
  } catch (error) {
    console.warn("[domestic-email-auth] markEmailCodeConsumed failed:", error);
  }
}

async function logSecurityEvent(params: {
  userId?: string | null;
  email: string;
  eventType: string;
  scene: DomesticAuthScene;
  success: boolean;
  detail?: Record<string, unknown>;
}) {
  const { userId, email, eventType, scene, success, detail } = params;
  const detailJson = {
    scene,
    email,
    ...(detail || {}),
  };

  try {
    await executeQuery(
      getCloudbaseApp()
        .mysql()
        .from("user_security_events")
        .insert({
          id: createId("security_event"),
          user_id: userId || null,
          source: "cn",
          event_type: eventType,
          provider: "email_code",
          success,
          user_agent: getUserAgent(),
          detail_json: detailJson,
        }),
      "写入安全日志失败",
    );
  } catch (error) {
    console.warn("[domestic-email-auth] logSecurityEvent failed:", error);
  }
}

async function syncDomesticUserProfile(profile: DomesticUserProfile) {
  const mysql = getCloudbaseApp().mysql();
  const now = toSqlTimestamp();
  const normalizedEmail = normalizeEmail(profile.email);
  const userAgent = getUserAgent();
  const defaultDisplayName =
    normalizedEmail.split("@")[0]?.trim() || "用户";

  const rowsById = await executeQuery<{ id: string; display_name?: string | null }>(
    mysql
      .from("app_users")
      .select("id,display_name")
      .eq("id", profile.userId)
      .limit(1),
    "查询用户失败",
  );

  let appUserId = profile.userId;
  if (rowsById.length === 0) {
    const rowsByEmail = await executeQuery<{ id: string; display_name?: string | null }>(
      mysql
        .from("app_users")
        .select("id,display_name")
        .eq("source", "cn")
        .eq("email_normalized", normalizedEmail)
        .limit(1),
      "按邮箱查询用户失败",
    );

    if (rowsByEmail.length > 0 && rowsByEmail[0]?.id) {
      appUserId = rowsByEmail[0].id;
      const displayName =
        pickPreferredDisplayName([
          profile.displayName,
          rowsByEmail[0]?.display_name,
        ]) || defaultDisplayName;
      await executeQuery(
        mysql
          .from("app_users")
          .update({
            email: normalizedEmail,
            email_normalized: normalizedEmail,
            display_name: displayName,
            avatar_url: profile.avatarUrl,
            last_login_at: now,
            is_active: true,
            updated_at: now,
          })
          .eq("id", appUserId),
        "更新用户失败",
      );
    } else {
      await executeQuery(
        mysql.from("app_users").insert({
          id: appUserId,
          source: "cn",
          email: normalizedEmail,
          email_normalized: normalizedEmail,
          display_name:
            pickPreferredDisplayName([profile.displayName]) || defaultDisplayName,
          avatar_url: profile.avatarUrl,
          current_plan_code: "free",
          subscription_status: "inactive",
          last_login_at: now,
          is_active: true,
          created_at: now,
          updated_at: now,
        }),
        "创建用户失败",
      );
    }
  } else {
    const displayName =
      pickPreferredDisplayName([
        profile.displayName,
        rowsById[0]?.display_name,
      ]) || defaultDisplayName;
    await executeQuery(
      mysql
        .from("app_users")
        .update({
          email: normalizedEmail,
          email_normalized: normalizedEmail,
          display_name: displayName,
          avatar_url: profile.avatarUrl,
          last_login_at: now,
          is_active: true,
          updated_at: now,
        })
        .eq("id", appUserId),
      "更新用户失败",
    );
  }

  const identityRows = await executeQuery<{ id: string }>(
    mysql
      .from("user_auth_identities")
      .select("id")
      .eq("source", "cn")
      .eq("provider", "email_code")
      .eq("provider_user_id", profile.userId)
      .limit(1),
    "查询认证身份失败",
  );

  if (identityRows.length > 0) {
    await executeQuery(
      mysql
        .from("user_auth_identities")
        .update({
          user_id: appUserId,
          provider_email: normalizedEmail,
          is_primary: true,
          verified_at: now,
          last_login_at: now,
          metadata_json: {
            sync_from: "cloudbase_email_code",
            user_agent: userAgent,
          },
        })
        .eq("id", identityRows[0].id),
      "更新认证身份失败",
    );
  } else {
    await executeQuery(
      mysql.from("user_auth_identities").insert({
        id: createId("auth_identity"),
        user_id: appUserId,
        source: "cn",
        provider: "email_code",
        provider_user_id: profile.userId,
        provider_email: normalizedEmail,
        is_primary: true,
        verified_at: now,
        last_login_at: now,
        metadata_json: {
          sync_from: "cloudbase_email_code",
          user_agent: userAgent,
        },
      }),
      "创建认证身份失败",
    );
  }

  return appUserId;
}

async function resolveCurrentUserProfile(loginState: unknown, fallbackEmail: string): Promise<DomesticUserProfile> {
  const auth = getCloudbaseAuth();

  let userInfo: unknown = null;
  try {
    userInfo = await auth.getUserInfo();
  } catch (error) {
    console.warn("[domestic-email-auth] getUserInfo failed:", error);
  }

  const userId = extractUserId(loginState, userInfo);
  if (!userId) {
    throw new Error("未获取到 CloudBase 用户ID，请重新登录");
  }

  const email = extractUserEmail(loginState, userInfo, fallbackEmail);
  const displayName = extractUserName(loginState, userInfo);

  return {
    userId,
    email,
    displayName,
    avatarUrl: null,
  };
}

export async function sendDomesticEmailCode(email: string, scene: DomesticAuthScene) {
  const normalizedEmail = normalizeEmail(email);
  const auth = getCloudbaseAuth();

  const verificationInfo = (await auth.getVerification({
    email: normalizedEmail,
  })) as DomesticVerificationInfo;

  await logEmailCodeSent(normalizedEmail, scene, verificationInfo);
  return verificationInfo;
}

export async function loginWithDomesticEmailCode(params: {
  email: string;
  code: string;
  verificationInfo: DomesticVerificationInfo;
}) {
  const { email, code, verificationInfo } = params;
  const normalizedEmail = normalizeEmail(email);
  const trimmedCode = code.trim();
  const auth = getCloudbaseAuth();

  const loginState = await auth.signInWithEmail({
    verificationInfo: {
      verification_id: getVerificationId(verificationInfo),
      is_user: Boolean(verificationInfo.is_user),
    },
    verificationCode: trimmedCode,
    email: normalizedEmail,
  });

  const profile = await resolveCurrentUserProfile(loginState, normalizedEmail);
  let appUserId: string | null = null;
  try {
    appUserId = await syncDomesticUserProfile(profile);
  } catch (error) {
    console.warn("[domestic-email-auth] login profile sync skipped:", error);
  }
  await markEmailCodeConsumed(normalizedEmail, "login", verificationInfo);
  await logSecurityEvent({
    userId: appUserId,
    email: normalizedEmail,
    eventType: "login_success",
    scene: "login",
    success: true,
  });

  return profile;
}

export async function loginWithDomesticEmailPassword(params: {
  email: string;
  password: string;
}) {
  const { email, password } = params;
  const normalizedEmail = normalizeEmail(email);
  const auth = getCloudbaseAuth();

  const signInResult = (await auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })) as {
    data?: { user?: unknown };
    error?: { message?: string } | null;
  };

  if (signInResult?.error) {
    throw new Error(extractDomesticAuthErrorMessage(signInResult.error, "邮箱或密码错误"));
  }

  const profile = await resolveCurrentUserProfile(signInResult, normalizedEmail);
  let appUserId: string | null = null;
  try {
    appUserId = await syncDomesticUserProfile(profile);
  } catch (error) {
    console.warn("[domestic-email-auth] login profile sync skipped:", error);
  }
  await logSecurityEvent({
    userId: appUserId,
    email: normalizedEmail,
    eventType: "login_success",
    scene: "login",
    success: true,
  });

  return profile;
}

export async function signUpWithDomesticEmailCode(params: {
  email: string;
  password: string;
  name?: string;
  code: string;
  verificationInfo: DomesticVerificationInfo;
}) {
  const { email, password, name, code, verificationInfo } = params;
  const normalizedEmail = normalizeEmail(email);
  const trimmedCode = code.trim();
  const auth = getCloudbaseAuth();

  const verifyResponse = (await auth.verify({
    verification_code: trimmedCode,
    verification_id: getVerificationId(verificationInfo),
  })) as { verification_token?: string };

  const verificationToken = verifyResponse?.verification_token || "";
  if (!verificationToken) {
    throw new Error("验证码校验失败，请重新获取验证码");
  }

  const signUpResult = await auth.signUp({
    email: normalizedEmail,
    password,
    name: name?.trim() || undefined,
    verification_code: trimmedCode,
    verification_token: verificationToken,
  });

  if (signUpResult?.error) {
    throw new Error(extractDomesticAuthErrorMessage(signUpResult.error, "注册失败"));
  }

  await markEmailCodeConsumed(normalizedEmail, "signup", verificationInfo);

  let appUserId: string | null = null;
  try {
    const loginState = await auth.getLoginState();
    if (loginState?.user) {
      const profile = await resolveCurrentUserProfile(loginState, normalizedEmail);
      appUserId = await syncDomesticUserProfile(profile);
    }
  } catch (error) {
    console.warn("[domestic-email-auth] signUp sync skipped:", error);
  }

  await logSecurityEvent({
    userId: appUserId,
    email: normalizedEmail,
    eventType: "register_success",
    scene: "signup",
    success: true,
  });
}

export async function resetDomesticPasswordWithCode(params: {
  email: string;
  newPassword: string;
  code: string;
  verificationInfo: DomesticVerificationInfo;
}) {
  const { email, newPassword, code, verificationInfo } = params;
  const normalizedEmail = normalizeEmail(email);
  const trimmedCode = code.trim();
  const auth = getCloudbaseAuth();

  const verifyResponse = (await auth.verify({
    verification_code: trimmedCode,
    verification_id: getVerificationId(verificationInfo),
  })) as { verification_token?: string };

  const verificationToken = verifyResponse?.verification_token || "";
  if (!verificationToken) {
    throw new Error("验证码校验失败，请重新获取验证码");
  }

  await auth.resetPassword({
    email: normalizedEmail,
    new_password: newPassword,
    verification_token: verificationToken,
  });

  await markEmailCodeConsumed(normalizedEmail, "reset", verificationInfo);

  let userId: string | null = null;
  try {
    const userRows = await executeQuery<{ id: string }>(
      getCloudbaseApp()
        .mysql()
        .from("app_users")
        .select("id")
        .eq("source", "cn")
        .eq("email_normalized", normalizedEmail)
        .limit(1),
      "查询用户失败",
    );
    if (userRows.length > 0) {
      userId = userRows[0].id;
    }
  } catch (error) {
    console.warn("[domestic-email-auth] resetPassword user lookup failed:", error);
  }

  await logSecurityEvent({
    userId,
    email: normalizedEmail,
    eventType: "password_reset",
    scene: "reset",
    success: true,
  });
}
