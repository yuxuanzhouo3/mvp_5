"use client";

import { useState, useTransition } from "react";
import { getRuntimeLanguage } from "@/config/runtime";
import { useRouter } from "next/navigation";
import { adminLogin } from "@/actions/admin-auth";

export default function AdminLoginForm({
  appDisplayName,
}: {
  appDisplayName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const sourceLabel =
    getRuntimeLanguage() === "zh"
      ? "国内版"
      : "国际版";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{appDisplayName}管理后台</h1>
        <p className="mt-1 text-sm text-slate-500">后台登录 · 当前环境：{sourceLabel}</p>
        <p className="mt-1 text-sm text-slate-500">请输入管理员账号密码</p>

        <form
          className="mt-6 space-y-4"
          action={(formData) => {
            setError("");
            startTransition(async () => {
              const result = await adminLogin(formData);
              if (result.success) {
                router.push("/admin/stats");
                router.refresh();
              } else {
                setError(result.error || "登录失败");
              }
            });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">用户名</span>
            <input
              name="username"
              type="text"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder="admin"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">密码</span>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder="请输入密码"
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
