import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAnonKeyFromEnv,
  getSupabaseUrlFromEnv,
} from "@/lib/supabase/env";

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

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (errorParam) {
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", errorParam);
    if (errorDescription) {
      errorUrl.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    const clientUrl = new URL("/auth/callback/client", origin);
    clientUrl.searchParams.set("next", next);
    searchParams.forEach((value, key) => {
      if (key !== "code" && key !== "next") {
        clientUrl.searchParams.set(key, value);
      }
    });
    return NextResponse.redirect(clientUrl);
  }

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const errorUrl = new URL("/auth/login", origin);
    errorUrl.searchParams.set("error", "exchange_failed");
    errorUrl.searchParams.set("error_description", error.message);
    return NextResponse.redirect(errorUrl);
  }

  const successUrl = new URL(next, origin);
  const response = NextResponse.redirect(successUrl);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Record<string, unknown>);
  }

  return response;
}
