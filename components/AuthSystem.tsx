"use client";

import React from "react";
import { getUIText, type UILanguage } from "@/lib/ui-text";

export type AuthMode = "login" | "signup" | "reset";

export interface AuthFormState {
  name: string;
  email: string;
  password: string;
  verificationCode: string;
}

export interface AuthUser {
  name: string;
  email: string;
}

interface AuthSystemProps {
  currentLanguage: UILanguage;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  authForm: AuthFormState;
  setAuthForm: (form: AuthFormState) => void;
  showPassword: boolean;
  setShowPassword: (show: boolean) => void;
  isDomesticVersion: boolean;
  user: AuthUser | null;
  onSubmit: () => void;
  onLogout: () => void;
}

const AuthSystem: React.FC<AuthSystemProps> = ({
  currentLanguage,
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  showPassword,
  setShowPassword,
  isDomesticVersion,
  user,
  onSubmit,
  onLogout,
}) => {
  const text = getUIText(currentLanguage);

  return (
    <section className="rounded-2xl bg-white/90 dark:bg-[#1f2937]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {text.authWelcome}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {text.authHint}
        </p>
      </div>

      {user ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 p-4">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {text.loggedInAs}
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
              {user.name}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
              {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
          >
            {text.logout}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => setAuthMode("login")}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${
                authMode === "login"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {text.login}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("signup")}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${
                authMode === "signup"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {text.signup}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("reset")}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${
                authMode === "reset"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {text.reset}
            </button>
          </div>

          {authMode === "signup" && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600 dark:text-gray-300">
                {text.name}
              </label>
              <input
                type="text"
                value={authForm.name}
                onChange={(event) =>
                  setAuthForm({ ...authForm, name: event.target.value })
                }
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-gray-600 dark:text-gray-300">
              {text.email}
            </label>
            <input
              type="email"
              value={authForm.email}
              onChange={(event) =>
                setAuthForm({ ...authForm, email: event.target.value })
              }
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          {(authMode === "signup" || authMode === "reset") && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600 dark:text-gray-300">
                {text.verificationCode}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={authForm.verificationCode}
                  onChange={(event) =>
                    setAuthForm({
                      ...authForm,
                      verificationCode: event.target.value,
                    })
                  }
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button
                  type="button"
                  className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
                >
                  {text.sendCode}
                </button>
              </div>
            </div>
          )}

          {(authMode === "login" || authMode === "signup") && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-600 dark:text-gray-300">
                {text.password}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, password: event.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 px-3 pr-10 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 h-10 px-3 text-xs text-gray-500 dark:text-gray-300"
                >
                  {showPassword ? text.hidePassword : text.showPassword}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onSubmit}
            className={`w-full h-10 rounded-lg text-white text-sm font-semibold transition-colors ${
              authMode === "login"
                ? "bg-blue-600 hover:bg-blue-700"
                : authMode === "signup"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-amber-500 hover:bg-amber-600"
            }`}
          >
            {authMode === "login"
              ? text.signIn
              : authMode === "signup"
                ? text.createAccount
                : text.resetPassword}
          </button>

          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {authMode === "login" ? (
              <button
                type="button"
                onClick={() => setAuthMode("reset")}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {text.forgotPassword}
              </button>
            ) : authMode === "signup" ? (
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {text.haveAccount} {text.login}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {text.backToLogin}
              </button>
            )}
          </div>

          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {currentLanguage === "zh"
              ? isDomesticVersion
                ? "可接入微信/邮箱验证登录。"
                : "可接入 Google/邮箱登录。"
              : isDomesticVersion
                ? "WeChat/Email sign-in can be connected later."
                : "Google/Email sign-in can be connected later."}
          </p>
        </div>
      )}
    </section>
  );
};

export default AuthSystem;
