"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";
import { getCloudbaseConfigError } from "@/lib/cloudbase/client";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import {
  extractDomesticAuthErrorMessage,
  loginWithDomesticEmailPassword,
  resetDomesticPasswordWithCode,
  sendDomesticEmailCode,
  signUpWithDomesticEmailCode,
  type DomesticAuthScene,
  type DomesticVerificationInfo,
} from "@/lib/cloudbase/domestic-email-auth";

type Mode = "login" | "signup" | "reset";

interface AuthPageProps {
  mode: Mode;
}

function sanitizeNextPath(next: string | null) {
  if (!next) {
    return "/";
  }
  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}

function mapSupabaseSignUpErrorMessage(rawMessage: string, isZh: boolean) {
  const normalized = rawMessage.trim().toLowerCase();
  if (normalized.includes("database error saving new user")) {
    return isZh
      ? "注册失败：该邮箱存在历史数据冲突。请稍后重试；若持续失败，请联系管理员执行数据库修复迁移。"
      : "Sign-up failed due to historical data conflict for this email. Please try again later.";
  }
  return rawMessage;
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

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
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function WechatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.5 4C2.46 4 0 6.24 0 8.99c0 2 1.33 3.74 3.3 4.62-.12.45-.76 2.8-.79 3.02 0 0-.02.17.09.24.11.07.24.02.24.02.32-.05 3.04-1.99 3.47-2.31.4.06.8.09 1.19.09 3.04 0 5.5-2.23 5.5-4.99C13 6.24 10.54 4 7.5 4h-2Zm12 4c-2.49 0-4.5 1.8-4.5 4.02 0 1.34.7 2.53 1.78 3.31-.09.36-.53 2.04-.55 2.2 0 0-.02.13.07.19.09.06.2.02.2.02.26-.04 2.45-1.6 2.8-1.85.32.05.65.07.97.07 2.49 0 4.5-1.8 4.5-4.02C22 9.8 19.99 8 17.5 8Z" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function AuthPage({ mode }: AuthPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentLanguage, isDomesticVersion } = useLanguage();
  const isZh = currentLanguage === "zh";
  const next = sanitizeNextPath(searchParams.get("next") || searchParams.get("redirect"));
  const supabase = useMemo(
    () => (isDomesticVersion ? null : createSupabaseClient()),
    [isDomesticVersion],
  );

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    verificationCode: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verificationInfo, setVerificationInfo] = useState<DomesticVerificationInfo | null>(null);
  const [verificationScene, setVerificationScene] = useState<DomesticAuthScene | null>(null);

  const currentDomesticScene: DomesticAuthScene =
    mode === "signup" ? "signup" : mode === "reset" ? "reset" : "login";
  const cloudbaseConfigError = useMemo(() => {
    return isDomesticVersion ? getCloudbaseConfigError() : null;
  }, [isDomesticVersion]);

  const pushEmailDeliveryLog = useCallback(
    async (input: {
      action:
        | "signup_verification_email_request"
        | "signup_verification_email_resend"
        | "password_reset_email_request";
      status: "accepted" | "failed";
      email?: string | null;
      detail?: string | null;
    }) => {
      if (isDomesticVersion) {
        return;
      }

      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

      try {
        await fetch("/api/auth/email-delivery-log", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          keepalive: true,
          cache: "no-store",
          body: JSON.stringify({
            action: input.action,
            status: input.status,
            email: input.email?.trim().toLowerCase() || null,
            detail: input.detail || null,
            requestId,
          }),
        });
      } catch (error) {
        console.warn("[AuthPage] pushEmailDeliveryLog failed:", error);
      }
    },
    [isDomesticVersion],
  );

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const title = useMemo(() => {
    if (mode === "login") return isZh ? "欢迎回来" : "Welcome Back";
    if (mode === "signup") return isZh ? "创建账号" : "Create Account";
    return isZh ? "重置密码" : "Reset Password";
  }, [mode, isZh]);

  const subtitle = useMemo(() => {
    if (mode === "login") return isZh ? "登录以继续使用" : "Sign in to continue";
    if (mode === "signup") return isZh ? "注册以开始使用" : "Sign up to get started";
    return isDomesticVersion
      ? isZh
        ? "邮箱验证码找回密码"
        : "Reset password with email code"
      : isZh
        ? "输入您的邮箱，我们将发送重置链接"
        : "Enter your email to receive a reset link";
  }, [mode, isZh, isDomesticVersion]);

  const handleChange = (key: "name" | "email" | "password" | "verificationCode", value: string) => {
    if (key === "email") {
      setVerificationInfo(null);
      setVerificationScene(null);
      setCountdown(0);
    }
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const buildConfirmRedirectUrl = () => {
    const confirmRedirectUrl = new URL("/auth/confirm", window.location.origin);
    confirmRedirectUrl.searchParams.set("next", next);
    return confirmRedirectUrl.toString();
  };

  const resendVerificationEmailAutomatically = useCallback(
    async (email: string) => {
      if (isDomesticVersion || !supabase) {
        return;
      }

      const normalizedEmail = email.trim();
      const confirmRedirectUrl = new URL("/auth/confirm", window.location.origin);
      confirmRedirectUrl.searchParams.set("next", next);
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo: confirmRedirectUrl.toString(),
        },
      });

      if (resendError) {
        await pushEmailDeliveryLog({
          action: "signup_verification_email_resend",
          status: "failed",
          email: normalizedEmail,
          detail: resendError.message,
        });
        throw resendError;
      }

      await pushEmailDeliveryLog({
        action: "signup_verification_email_resend",
        status: "accepted",
        email: normalizedEmail,
      });
    },
    [isDomesticVersion, pushEmailDeliveryLog, supabase, next],
  );

  const handleSendCode = async () => {
    setError(null);
    setSuccess(null);

    if (!form.email.trim()) {
      setError(isZh ? "请先输入邮箱地址" : "Please enter email first");
      return;
    }

    if (isDomesticVersion) {
      if (cloudbaseConfigError) {
        setError(cloudbaseConfigError);
        return;
      }

      setSendingCode(true);
      try {
        const info = await sendDomesticEmailCode(form.email, currentDomesticScene);
        setVerificationInfo(info);
        setVerificationScene(currentDomesticScene);
        setCountdown(60);
        setSuccess(isZh ? "验证码已发送" : "Verification code sent");
      } catch (sendError) {
        setError(extractDomesticAuthErrorMessage(sendError, isZh ? "发送验证码失败" : "Failed to send code"));
      } finally {
        setSendingCode(false);
      }
      return;
    }

    setSendingCode(true);
    setTimeout(() => {
      setSendingCode(false);
      setCountdown(60);
      setSuccess(isZh ? "验证码已发送" : "Verification code sent");
    }, 900);
  };

  const handleThirdPartyLogin = async () => {
    setError(null);
    setSuccess(null);
    if (isDomesticVersion) {
      setError(isZh ? "微信登录暂未接入，请使用邮箱和密码登录" : "WeChat login is not ready. Please use email and password.");
      return;
    }

    if (!supabase) {
      setError(
        isZh
          ? "Supabase 配置缺失，暂时无法使用 Google 登录。"
          : "Supabase is not configured. Google sign-in is unavailable.",
      );
      return;
    }

    setIsLoading(true);

    try {
      const oauthStartUrl = new URL("/auth/google", window.location.origin);
      if (next && next !== "/") {
        oauthStartUrl.searchParams.set("next", next);
      }
      window.location.href = oauthStartUrl.toString();
    } catch (oauthError) {
      setError(
        extractDomesticAuthErrorMessage(
          oauthError,
          isZh ? "Google 登录失败，请稍后重试。" : "Google sign-in failed. Please try again.",
        ),
      );
      setIsLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (isDomesticVersion && cloudbaseConfigError) {
      setError(cloudbaseConfigError);
      return;
    }

    const requireVerificationCode = isDomesticVersion && (mode === "signup" || mode === "reset");
    if (requireVerificationCode && !form.verificationCode.trim()) {
      setError(isZh ? "请输入验证码" : "Please enter verification code");
      return;
    }

    if (
      requireVerificationCode &&
      (!verificationInfo ||
        !verificationInfo.verification_id ||
        verificationScene !== currentDomesticScene)
    ) {
      setError(isZh ? "请先发送验证码后再提交" : "Please send verification code first");
      return;
    }

    if (mode === "signup") {
      if (form.password.length < 6) {
        setError(isZh ? "密码至少需要6个字符" : "Password must be at least 6 characters");
        return;
      }
    }

    if (mode === "login" && isDomesticVersion) {
      if (!form.password) {
        setError(isZh ? "请输入密码" : "Please enter password");
        return;
      }
    }

    if (mode === "reset" && isDomesticVersion) {
      if (!form.password) {
        setError(isZh ? "请输入新密码" : "Please enter new password");
        return;
      }
      if (form.password.length < 6) {
        setError(isZh ? "密码至少需要6个字符" : "Password must be at least 6 characters");
        return;
      }
    }

    setIsLoading(true);

    try {
      if (isDomesticVersion) {
        if (mode === "login") {
          await loginWithDomesticEmailPassword({
            email: form.email,
            password: form.password,
          });
          setSuccess(isZh ? "登录成功，正在跳转" : "Login successful, redirecting");
          router.push(next);
          return;
        }

        const verifiedInfo = verificationInfo as DomesticVerificationInfo;
        if (mode === "signup") {
          await signUpWithDomesticEmailCode({
            email: form.email,
            password: form.password,
            name: form.name,
            code: form.verificationCode,
            verificationInfo: verifiedInfo,
          });
          setSuccess(isZh ? "注册成功，正在跳转登录" : "Sign up successful, redirecting to login");
          window.setTimeout(() => {
            router.push(`/auth/login?next=${encodeURIComponent(next)}`);
          }, 1200);
          return;
        }

        await resetDomesticPasswordWithCode({
          email: form.email,
          newPassword: form.password,
          code: form.verificationCode,
          verificationInfo: verifiedInfo,
        });
        setSuccess(
          isZh
            ? "密码重置成功，正在跳转登录"
            : "Password reset successful, redirecting to login",
        );
        window.setTimeout(() => router.push("/auth/login"), 1200);
        return;
      }

      if (!supabase) {
        throw new Error(
          isZh
            ? "Supabase 配置缺失，暂时无法完成该操作。"
            : "Supabase is not configured.",
        );
      }

      if (mode === "login") {
        const { data, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: form.email.trim(),
            password: form.password,
          });

        if (signInError) {
          throw signInError;
        }

        if (!data.user?.email_confirmed_at) {
          await supabase.auth.signOut();
          await resendVerificationEmailAutomatically(form.email.trim());
          setSuccess(
            isZh
              ? "该邮箱尚未完成验证，系统已自动重新发送验证邮件，请查收邮箱。"
              : "This email is not verified. A new verification email has been sent automatically.",
          );
          return;
        }

        setSuccess(isZh ? "登录成功，正在跳转" : "Login successful, redirecting");
        window.location.href = next;
        return;
      }

      if (mode === "signup") {
        const normalizedEmail = form.email.trim();

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: form.password,
          options: {
            data: {
              full_name: form.name.trim(),
            },
            emailRedirectTo: buildConfirmRedirectUrl(),
          },
        });

        if (signUpError) {
          const mappedMessage = mapSupabaseSignUpErrorMessage(
            signUpError.message || "",
            isZh,
          );
          await pushEmailDeliveryLog({
            action: "signup_verification_email_request",
            status: "failed",
            email: normalizedEmail,
            detail: mappedMessage,
          });
          throw new Error(mappedMessage);
        }

        if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
          await pushEmailDeliveryLog({
            action: "signup_verification_email_request",
            status: "accepted",
            email: normalizedEmail,
            detail: "existing_unverified_user_auto_resend",
          });
          await resendVerificationEmailAutomatically(normalizedEmail);
          await supabase.auth.signOut();
          setSuccess(
            isZh
              ? "该邮箱尚未完成验证，系统已自动重新发送验证邮件，请查收邮箱。"
              : "This email is not verified yet. A new verification email has been sent automatically.",
          );
          window.setTimeout(() => {
            router.push(`/auth/login?next=${encodeURIComponent(next)}`);
          }, 1200);
          return;
        }

        await pushEmailDeliveryLog({
          action: "signup_verification_email_request",
          status: "accepted",
          email: normalizedEmail,
        });
        await supabase.auth.signOut();
        setSuccess(
          isZh
            ? "注册成功，请查收邮件完成验证。"
            : "Sign-up successful. Please verify your email.",
        );
        window.setTimeout(() => {
          router.push(`/auth/login?next=${encodeURIComponent(next)}`);
        }, 1200);
        return;
      }

      const resetRedirectUrl = new URL("/auth/update-password", window.location.origin);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        form.email.trim(),
        {
          redirectTo: resetRedirectUrl.toString(),
        },
      );
      if (resetError) {
        await pushEmailDeliveryLog({
          action: "password_reset_email_request",
          status: "failed",
          email: form.email.trim(),
          detail: resetError.message,
        });
        throw resetError;
      }
      await pushEmailDeliveryLog({
        action: "password_reset_email_request",
        status: "accepted",
        email: form.email.trim(),
      });
      setSuccess(
        isZh
          ? "重置链接已发送，请查收邮箱。"
          : "Password reset link sent. Please check your email.",
      );
      window.setTimeout(() => router.push("/auth/login"), 1200);
    } catch (submitError) {
      setError(extractDomesticAuthErrorMessage(submitError, isZh ? "操作失败" : "Operation failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const showThirdPartyButton = mode === "login";
  const showNameField = mode === "signup";
  const showVerificationCode = isDomesticVersion && (mode === "signup" || mode === "reset");
  const showPasswordField = isDomesticVersion
    ? mode === "login" || mode === "signup" || mode === "reset"
    : mode === "login" || mode === "signup";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6 sm:py-8">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-white to-cyan-100/40 dark:from-slate-950 dark:via-slate-900 dark:to-cyan-950/20" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-cyan-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-purple-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />
      </div>

      <Link
        href="/"
        className="fixed top-4 left-4 z-10 inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-cyan-200/70 dark:border-cyan-400/25 bg-gradient-to-r from-cyan-500/10 to-blue-500/12 dark:from-cyan-400/12 dark:to-blue-500/12 backdrop-blur-md text-cyan-700 dark:text-cyan-200 shadow-sm shadow-cyan-500/10 hover:from-cyan-500/18 hover:to-blue-500/22 dark:hover:from-cyan-400/18 dark:hover:to-blue-500/18 hover:border-cyan-300/80 dark:hover:border-cyan-300/40 transition-all duration-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <span className="text-sm font-medium">{isZh ? "返回首页" : "Back to Home"}</span>
      </Link>

      <div className="w-full max-w-md">
        <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 dark:border-white/10 p-5 sm:p-6 shadow-xl">
          <h1 className="text-[1.75rem] sm:text-[1.95rem] leading-[1.15] font-bold tracking-[-0.01em] text-center text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm sm:text-base font-normal text-gray-500 dark:text-gray-400/90 text-center mb-5">
            {subtitle}
          </p>

          {showThirdPartyButton && (
            <>
              <button
                type="button"
                className={`w-full h-11 rounded-xl gap-3 mb-4 font-medium flex items-center justify-center ${
                  isDomesticVersion
                    ? "bg-[#00c060] hover:bg-[#00a654] text-white"
                    : "bg-white dark:bg-white/10 border border-gray-200 dark:border-white/15 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/15"
                }`}
                onClick={handleThirdPartyLogin}
                disabled={isLoading || !agreePrivacy}
              >
                {isLoading ? (
                  <SpinnerIcon className="h-5 w-5 animate-spin" />
                ) : isDomesticVersion ? (
                  <WechatIcon className="h-5 w-5" />
                ) : (
                  <GoogleIcon className="h-5 w-5" />
                )}
                <span>
                  {isLoading
                    ? isZh
                      ? "处理中..."
                      : "Processing..."
                    : isDomesticVersion
                      ? isZh
                        ? "使用微信登录"
                        : "Sign in with WeChat"
                      : isZh
                        ? "使用 Google 登录"
                        : "Sign in with Google"}
                </span>
              </button>

              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-slate-900 px-2 text-gray-400 dark:text-gray-500">
                    {isZh ? "或使用邮箱" : "or continue with email"}
                  </span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {showNameField && (
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isZh ? "用户名" : "Username"}
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder={isZh ? "请输入用户名" : "Enter your username"}
                    value={form.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                    className="w-full pl-10 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                    required
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isZh ? "邮箱" : "Email"}
              </label>
              <div className="relative">
                <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder={isZh ? "请输入邮箱" : "Enter your email"}
                  value={form.email}
                  onChange={(event) => handleChange("email", event.target.value)}
                  className="w-full pl-10 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                  required
                />
              </div>
            </div>

            {showVerificationCode && (
              <div className="space-y-2">
                <label htmlFor="verificationCode" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isZh ? "邮箱验证码" : "Verification Code"}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      id="verificationCode"
                      name="verificationCode"
                      type="text"
                      placeholder={isZh ? "输入6位验证码" : "Enter 6-digit code"}
                      value={form.verificationCode}
                      onChange={(event) => handleChange("verificationCode", event.target.value)}
                      className="w-full h-11 rounded-xl px-3 border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                      maxLength={6}
                      required
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={sendingCode || countdown > 0 || !form.email}
                    className="h-11 px-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {sendingCode
                      ? isZh
                        ? "发送中..."
                        : "Sending..."
                      : countdown > 0
                        ? `${countdown}s`
                        : isZh
                          ? "发送"
                          : "Send"}
                  </button>
                </div>
              </div>
            )}

            {showPasswordField && (
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {mode === "reset" ? (isZh ? "新密码" : "New Password") : isZh ? "密码" : "Password"}
                </label>
                <div className="relative">
                  <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={
                      mode === "reset"
                        ? isZh
                          ? "请输入新密码"
                          : "Enter new password"
                        : isZh
                          ? "请输入密码"
                          : "Enter your password"
                    }
                    value={form.password}
                    onChange={(event) => handleChange("password", event.target.value)}
                    className="w-full pl-10 pr-10 h-11 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === "login" && (
              <div className="flex justify-end">
                <Link href="/auth/reset-password" className="text-sm text-cyan-500 hover:text-cyan-400">
                  {isZh ? "忘记密码？" : "Forgot password?"}
                </Link>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="agree-privacy"
                checked={agreePrivacy}
                onChange={(event) => setAgreePrivacy(event.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
              />
              <label
                htmlFor="agree-privacy"
                className="flex items-center flex-wrap gap-x-1 text-sm leading-5 text-gray-500 dark:text-gray-400 cursor-pointer"
              >
                <span>{isZh ? "我已阅读并同意" : "I have read and agree to"}</span>
                <button
                  type="button"
                  onClick={() => setShowPrivacyDialog(true)}
                  className="inline-flex items-center leading-5 text-cyan-500 hover:text-cyan-400 underline"
                >
                  {isZh ? "《隐私条款》" : "Privacy Policy"}
                </button>
              </label>
            </div>

            {error ? (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg p-3">
            {error}
          </div>
            ) : null}

            {success ? (
              <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-lg p-3">
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isLoading || !agreePrivacy}
            >
              {isLoading
                ? isZh
                  ? "处理中..."
                  : "Processing..."
                : mode === "login"
                  ? isZh
                    ? "登录"
                    : "Sign In"
                : mode === "signup"
                    ? isZh
                      ? "注册"
                      : "Sign Up"
                    : isDomesticVersion
                      ? isZh
                        ? "重置密码"
                        : "Reset Password"
                      : isZh
                        ? "发送重置邮件"
                        : "Send Reset Email"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            {mode === "login" ? (
              <>
                {isZh ? "还没有账号？" : "Don't have an account?"}{" "}
                <Link href="/auth/sign-up" className="text-cyan-500 hover:text-cyan-400 font-medium">
                  {isZh ? "立即注册" : "Sign up"}
                </Link>
              </>
            ) : (
              <>
                {isZh ? "已有账号？" : "Already have an account?"}{" "}
                <Link href="/auth/login" className="text-cyan-500 hover:text-cyan-400 font-medium">
                  {isZh ? "立即登录" : "Sign in"}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      {showPrivacyDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowPrivacyDialog(false)}
        >
          <div
            className="relative w-[95vw] sm:max-w-2xl lg:max-w-4xl max-h-[90vh] sm:max-h-[85vh] overflow-hidden rounded-xl sm:rounded-2xl p-0 border-0 shadow-2xl bg-white dark:bg-slate-800"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                <span>{isZh ? "隐私条款" : "Privacy Policy"}</span>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                {isZh ? "请仔细阅读以下隐私条款" : "Please read the following privacy policy carefully"}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4 bg-white/50 dark:bg-slate-800/50 max-h-[55vh]">
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-7">
                {isZh
                  ? "本页面用于真实账户鉴权，请确保您已阅读并同意隐私政策后继续。"
                  : "This page is used for live account authentication. Please read and agree to the privacy policy before continuing."}
              </p>
            </div>

            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-200/80 dark:border-gray-700/80 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
              <button
                onClick={() => {
                  setShowPrivacyDialog(false);
                  setAgreePrivacy(true);
                }}
                className="w-full py-2 sm:py-2.5 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm sm:text-base font-medium rounded-lg sm:rounded-xl"
              >
                {isZh ? "我已阅读并同意" : "I have read and agree"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
