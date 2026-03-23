"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { trackAnalyticsClient } from "@/lib/analytics/client";

export const dynamic = "force-dynamic";

function sanitizeNextPath(next: string | null) {
  if (!next) {
    return "/";
  }
  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}

function redirectWithFreshRequest(path: string) {
  window.location.replace(path);
}

async function syncGlobalProfileAfterAuth() {
  try {
    await fetch("/api/user/profile", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
  } catch (error) {
    console.warn("[auth/callback/client] syncGlobalProfileAfterAuth failed:", error);
  }
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function AuthCallbackClientContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentLanguage, isDomesticVersion } = useLanguage();
  const isZh = currentLanguage === "zh";
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next")),
    [searchParams],
  );

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (isDomesticVersion) {
        const params = new URLSearchParams();
        params.set("error", "unsupported_auth_version");
        params.set(
          "error_description",
          "Domestic version uses CloudBase auth only.",
        );
        router.replace(`/auth/login?${params.toString()}`);
        return;
      }

      const supabase = createClient();
      if (!supabase) {
        setError(
          isZh
            ? "Supabase 配置缺失，请联系管理员。"
            : "Missing Supabase configuration.",
        );
        return;
      }

      const oauthError = searchParams.get("error");
      if (oauthError) {
        const params = new URLSearchParams();
        params.set("error", oauthError);

        const oauthErrorDesc = searchParams.get("error_description");
        if (oauthErrorDesc) {
          params.set("error_description", oauthErrorDesc);
        }
        router.replace(`/auth/login?${params.toString()}`);
        return;
      }

      try {
        const hashParams = new URLSearchParams(
          window.location.hash.replace(/^#/, ""),
        );
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) {
            throw setSessionError;
          }

          await syncGlobalProfileAfterAuth();

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id) {
            void trackAnalyticsClient({
              source: "global",
              userId: user.id,
              eventType: "session_start",
              eventName: "oauth_login_success_client",
              eventData: {
                provider:
                  typeof user.app_metadata?.provider === "string"
                    ? user.app_metadata.provider
                    : "oauth",
                flow: "client_hash_session",
              },
              sessionScope: "auth",
            });
          }

          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
          redirectWithFreshRequest(nextPath);
          return;
        }

        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }

          await syncGlobalProfileAfterAuth();

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id) {
            void trackAnalyticsClient({
              source: "global",
              userId: user.id,
              eventType: "session_start",
              eventName: "oauth_login_success_client",
              eventData: {
                provider:
                  typeof user.app_metadata?.provider === "string"
                    ? user.app_metadata.provider
                    : "oauth",
                flow: "client_code_exchange",
              },
              sessionScope: "auth",
            });
          }
          redirectWithFreshRequest(nextPath);
          return;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        if (session) {
          redirectWithFreshRequest(nextPath);
          return;
        }

        router.replace("/auth/login?error=no_session");
      } catch (callbackError) {
        if (!active) {
          return;
        }
        const message =
          callbackError instanceof Error
            ? callbackError.message
            : isZh
              ? "认证回调处理失败"
              : "Authentication callback failed";
        setError(message);

        const params = new URLSearchParams();
        params.set("error", "callback_failed");
        params.set("error_description", message);
        window.setTimeout(() => {
          router.replace(`/auth/login?${params.toString()}`);
        }, 1200);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [isDomesticVersion, isZh, nextPath, router, searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <Spinner />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {error ||
          (isZh ? "正在完成登录回调..." : "Completing authentication...")}
      </p>
    </div>
  );
}

function AuthCallbackLoadingFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <Spinner />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        正在准备认证回调...
      </p>
    </div>
  );
}

export default function AuthCallbackClientPage() {
  return (
    <Suspense fallback={<AuthCallbackLoadingFallback />}>
      <AuthCallbackClientContent />
    </Suspense>
  );
}
