import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAnonKeyFromEnv,
  getSupabaseUrlFromEnv,
} from "@/lib/supabase/env";
import { IS_DOMESTIC_VERSION } from "@/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host");
  const proto =
    forwardedProto ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (host) {
    return `${proto}://${host}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);

  // 国内版不支持Google登录
  if (IS_DOMESTIC_VERSION) {
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "unsupported_auth_version");
    errorUrl.searchParams.set(
      "error_description",
      "国内版仅支持邮箱登录",
    );
    return NextResponse.redirect(errorUrl);
  }

  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));

  const supabaseUrl = getSupabaseUrlFromEnv();
  const supabaseAnonKey = getSupabaseAnonKeyFromEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "configuration_error");
    errorUrl.searchParams.set("error_description", "Missing Supabase configuration");
    return NextResponse.redirect(errorUrl);
  }

  const pendingCookies: {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }[] = [];

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach((cookie) => {
          pendingCookies.push(cookie);
        });
      },
    },
  });

  const redirectTo = `${origin}/auth/callback${
    next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  console.info("[auth/google] Starting OAuth flow", { origin, redirectTo, next });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    console.error("[auth/google] signInWithOAuth error:", error.message);
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "oauth_start_failed");
    errorUrl.searchParams.set("error_description", error.message);
    return NextResponse.redirect(errorUrl);
  }

  if (!data.url) {
    console.error("[auth/google] Missing provider redirect URL");
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "oauth_start_failed");
    errorUrl.searchParams.set("error_description", "Google OAuth URL not returned");
    return NextResponse.redirect(errorUrl);
  }

  const response = NextResponse.redirect(data.url);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Record<string, unknown>);
  }
  return response;
}
