"use client";

import React from "react";
import { getUIText, type UILanguage } from "@/lib/ui-text";

export interface AuthUser {
  name: string;
  email: string;
}

interface AuthSystemProps {
  currentLanguage: UILanguage;
  isDomesticVersion: boolean;
  user: AuthUser | null;
  onLogin: () => void;
  onSignup: () => void;
  onResetPassword: () => void;
  onLogout: () => void;
}

const AuthSystem: React.FC<AuthSystemProps> = ({
  currentLanguage,
  isDomesticVersion,
  user,
  onLogin,
  onSignup,
  onResetPassword,
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
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/30 p-4">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              {currentLanguage === "zh"
                ? "该入口已接入真实鉴权，请选择下方操作继续。"
                : "This entry is connected to real authentication. Choose an action below to continue."}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
              {isDomesticVersion
                ? currentLanguage === "zh"
                  ? "国内版：CloudBase 账号体系"
                  : "Domestic: CloudBase account system"
                : currentLanguage === "zh"
                  ? "国际版：Supabase 账号体系"
                  : "International: Supabase account system"}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={onLogin}
              className="h-8 rounded-md text-xs font-medium transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {text.login}
            </button>
            <button
              type="button"
              onClick={onSignup}
              className="h-8 rounded-md text-xs font-medium transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {text.signup}
            </button>
            <button
              type="button"
              onClick={onResetPassword}
              className="h-8 rounded-md text-xs font-medium transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {text.reset}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default AuthSystem;
