import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  getSupabaseAnonKeyFromEnv,
  getSupabaseUrlFromEnv,
} from "@/lib/supabase/env";
import {
  extractRequestAnalyticsMeta,
  trackAnalyticsSessionEvent,
} from "@/lib/analytics/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const IS_DOMESTIC_RUNTIME = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh")
  .toLowerCase()
  .startsWith("zh");

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
  const host = forwardedHost || request.headers.get("host");

  if (host) {
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}

function sanitizeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

async function trackConfirmedUser(
  request: NextRequest,
  supabase: ReturnType<typeof createServerClient>,
) {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) {
      return;
    }

    await trackAnalyticsSessionEvent({
      source: "global",
      userId: user.id,
      ensureSession: true,
      eventType: "register",
      eventName: "email_confirmed",
      eventData: {
        method: "supabase_email",
      },
      meta: extractRequestAnalyticsMeta(request),
    });
  } catch (trackError) {
    console.warn("[auth/confirm] analytics track failed:", trackError);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));
  const origin = getRequestOrigin(request);

  if (IS_DOMESTIC_RUNTIME) {
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "unsupported_auth_version");
    errorUrl.searchParams.set(
      "error_description",
      "Domestic version uses CloudBase auth only.",
    );
    return NextResponse.redirect(errorUrl);
  }

  const supabaseUrl = getSupabaseUrlFromEnv();
  const supabaseAnonKey = getSupabaseAnonKeyFromEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[auth/confirm] Missing Supabase configuration");
    return NextResponse.redirect(new URL("/auth/login?error=config_error", origin));
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

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (error) {
      console.error("[auth/confirm] verifyOtp error:", error.message);
      const errorUrl = new URL("/auth/login", origin);
      errorUrl.searchParams.set("error", "verification_failed");
      errorUrl.searchParams.set("error_description", error.message);
      return NextResponse.redirect(errorUrl);
    }

    await trackConfirmedUser(request, supabase);

    const successUrl = new URL(next, origin);
    const response = NextResponse.redirect(successUrl);
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options as Record<string, unknown>);
    }
    return response;
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/confirm] exchangeCodeForSession error:", error.message);
      const errorUrl = new URL("/auth/login", origin);
      errorUrl.searchParams.set("error", "code_exchange_failed");
      errorUrl.searchParams.set("error_description", error.message);
      return NextResponse.redirect(errorUrl);
    }

    await trackConfirmedUser(request, supabase);

    const successUrl = new URL(next, origin);
    const response = NextResponse.redirect(successUrl);
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options as Record<string, unknown>);
    }
    return response;
  }

  console.error("[auth/confirm] No valid confirmation params");
  return NextResponse.redirect(new URL("/auth/login?error=invalid_link", origin));
}
