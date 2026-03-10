"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A3 3 0 0 0 9 13a3 3 0 0 0 4.4 2.6" />
      <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.2" />
      <path d="M6.6 6.6A17.2 17.2 0 0 0 2 12s3.5 7 10 7c1.6 0 3-.4 4.4-1" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function UpdatePasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentLanguage, isDomesticVersion } = useLanguage();
  const isZh = currentLanguage === "zh";
  const supabase = isDomesticVersion ? null : createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "updating" | "success">("idle");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next");
    if (!next) {
      return "/";
    }
    if (!next.startsWith("/") || next.startsWith("//")) {
      return "/";
    }
    return next;
  }, [searchParams]);

  useEffect(() => {
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

    if (!supabase) {
      setError(
        isZh
          ? "Supabase 配置缺失，请联系管理员。"
          : "Missing Supabase configuration.",
      );
      return;
    }

    let active = true;

    const prepareSession = async () => {
      try {
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
          return;
        }

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
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
        }
      } catch (prepareError) {
        if (!active) {
          return;
        }
        setError(
          prepareError instanceof Error
            ? prepareError.message
            : isZh
              ? "重置链接无效或已过期。"
              : "Invalid or expired reset link.",
        );
      }
    };

    void prepareSession();

    return () => {
      active = false;
    };
  }, [isDomesticVersion, isZh, router, searchParams, supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!supabase) {
      setError(
        isZh
          ? "Supabase 配置缺失，请联系管理员。"
          : "Missing Supabase configuration.",
      );
      return;
    }

    if (password.length < 6) {
      setError(
        isZh ? "密码长度至少为 6 位。" : "Password must be at least 6 characters.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(isZh ? "两次输入的密码不一致。" : "Passwords do not match.");
      return;
    }

    setStatus("updating");

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        throw updateError;
      }
      setStatus("success");
      window.setTimeout(() => {
        router.replace(nextPath);
      }, 1200);
    } catch (updateErr) {
      setStatus("idle");
      setError(
        updateErr instanceof Error
          ? updateErr.message
          : isZh
            ? "更新密码失败，请稍后重试。"
            : "Failed to update password. Please try again later.",
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6 sm:py-8">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-white to-cyan-100/40 dark:from-slate-950 dark:via-slate-900 dark:to-cyan-950/20" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-cyan-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-purple-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 dark:border-white/10 p-5 sm:p-6 shadow-xl">
          <h1 className="text-[1.75rem] sm:text-[1.95rem] leading-[1.15] font-bold tracking-[-0.01em] text-center text-gray-900 dark:text-white">
            {isZh ? "设置新密码" : "Set New Password"}
          </h1>
          <p className="mt-2 text-sm sm:text-base font-normal text-gray-500 dark:text-gray-400/90 text-center mb-5">
            {isZh ? "请输入新的登录密码" : "Please enter your new password"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isZh ? "新密码" : "New Password"}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isZh ? "至少 6 位" : "At least 6 characters"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full px-3 pr-10 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                  required
                  minLength={6}
                  disabled={status !== "idle"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isZh ? "确认新密码" : "Confirm Password"}
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder={isZh ? "请再次输入新密码" : "Enter password again"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full px-3 pr-10 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                  required
                  disabled={status !== "idle"}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((previous) => !previous)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showConfirmPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg p-3">
                {error}
              </div>
            ) : null}

            {status === "success" ? (
              <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-lg p-3">
                {isZh ? "密码更新成功，正在跳转..." : "Password updated. Redirecting..."}
              </div>
            ) : null}

            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={status !== "idle"}
            >
              {status === "updating" ? (
                <span className="inline-flex items-center gap-2">
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  {isZh ? "更新中..." : "Updating..."}
                </span>
              ) : (
                <>{isZh ? "确认更新" : "Update Password"}</>
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/auth/login" className="text-sm text-cyan-500 hover:text-cyan-400">
              {isZh ? "返回登录" : "Back to login"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
