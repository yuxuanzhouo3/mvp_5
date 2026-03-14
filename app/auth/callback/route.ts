import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKeyFromEnv, getSupabaseUrlFromEnv } from "@/lib/supabase/env";
import { IS_DOMESTIC_VERSION } from "@/config";
import { trackLoginEvent, trackRegisterEvent } from "@/services/analytics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncGlobalAuthUser } from "@/lib/server/supabase-auth-user-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
  const host = forwardedHost || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return request.nextUrl.origin;
}

function sanitizeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

function wasAuthUserRecentlyCreated(createdAt: string | null | undefined) {
  if (!createdAt) {
    return false;
  }

  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs < 5 * 60 * 1000;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const origin = getRequestOrigin(request);

  console.info("[auth/callback] Received callback", {
    hasCode: !!code,
    hasError: !!errorParam,
    isDomestic: IS_DOMESTIC_VERSION,
  });

  // 处理 OAuth 错误
  if (errorParam) {
    console.error("[auth/callback] OAuth error:", errorParam, errorDescription);
    const errUrl = new URL("/auth/login", origin);
    errUrl.searchParams.set("error", errorParam);
    if (errorDescription) {
      errUrl.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(errUrl);
  }

  // 如果没有 code，重定向到客户端页面处理其他情况
  if (!code) {
    console.info("[auth/callback] No code found, redirecting to client-side handler");
    const clientUrl = new URL("/auth/callback/client", origin);
    searchParams.forEach((value, key) => {
      clientUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(clientUrl);
  }

  // Supabase OAuth处理 (Google等)
  const supabaseUrl = getSupabaseUrlFromEnv();
  const supabaseAnonKey = getSupabaseAnonKeyFromEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[auth/callback] Missing Supabase configuration");
    const errUrl = new URL("/auth/login", origin);
    errUrl.searchParams.set("error", "configuration_error");
    errUrl.searchParams.set("error_description", "Missing Supabase configuration");
    return NextResponse.redirect(errUrl);
  }

  // 收集需要设置的 cookie
  const pendingCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  console.info("[auth/callback] Exchanging code for session (Supabase OAuth)");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession error:", error.message);
    const errUrl = new URL("/auth/login", origin);
    errUrl.searchParams.set("error", "exchange_failed");
    errUrl.searchParams.set("error_description", error.message);
    return NextResponse.redirect(errUrl);
  }

  console.info("[auth/callback] Session established for:", data?.session?.user?.email);

  // 记录登录/注册事件到 user_analytics
  if (data?.session?.user) {
    const user = data.session.user;

    let hasExistingAppUser = false;
    if (supabaseAdmin) {
      try {
        const normalizedEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
        const { data: existingById, error: existingByIdError } = await supabaseAdmin
          .from("app_users")
          .select("id")
          .eq("source", "global")
          .eq("id", user.id)
          .limit(1);

        if (existingByIdError) {
          throw existingByIdError;
        }

        hasExistingAppUser = Array.isArray(existingById) && existingById.length > 0;

        if (!hasExistingAppUser && normalizedEmail) {
          const { data: existingByEmail, error: existingByEmailError } = await supabaseAdmin
            .from("app_users")
            .select("id")
            .eq("source", "global")
            .eq("email_normalized", normalizedEmail)
            .limit(1);

          if (existingByEmailError) {
            throw existingByEmailError;
          }

          hasExistingAppUser = Array.isArray(existingByEmail) && existingByEmail.length > 0;
        }
      } catch (err) {
        console.warn("[auth/callback] app_users existence check failed:", err);
      }
    }

    const isNewUser = !hasExistingAppUser && wasAuthUserRecentlyCreated(user.created_at);

    try {
      await syncGlobalAuthUser(user, {
        markVerified: true,
        touchLastLoginAt: true,
      });
    } catch (syncError) {
      console.warn("[auth/callback] syncGlobalAuthUser failed:", syncError);
    }

    const trackFn = isNewUser ? trackRegisterEvent : trackLoginEvent;
    trackFn(user.id, {
      userAgent: request.headers.get("user-agent") || undefined,
      language: request.headers.get("accept-language")?.split(",")[0] || undefined,
      referrer: request.headers.get("referer") || undefined,
      ...(isNewUser ? { registerMethod: "google" } : {}),
    }).catch((err) => console.warn("[auth/callback] track event error:", err));
  }

  const successUrl = new URL(next, origin);
  const response = NextResponse.redirect(successUrl);

  // 将 Supabase 设置的 cookie 添加到响应中
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Record<string, unknown>);
  }

  return response;
}
