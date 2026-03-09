"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminLogout } from "@/actions/admin-auth";

type AdminSidebarProps = {
  username: string;
  sourceScope: "cn" | "global";
  sourceLabel: string;
};

const NAV_ITEMS = [
  { href: "/admin/stats", label: "数据统计", shortLabel: "统计" },
  { href: "/admin/ads", label: "广告管理", shortLabel: "广告" },
  { href: "/admin/social-links", label: "社交链接", shortLabel: "社交" },
  { href: "/admin/releases", label: "版本发布", shortLabel: "版本" },
  { href: "/admin/orders", label: "订单管理", shortLabel: "订单" },
  { href: "/admin/quota", label: "额度管理", shortLabel: "额度" },
];

function SidebarContent({
  pathname,
  username,
  sourceScope,
  sourceLabel,
  onNavigate,
}: {
  pathname: string;
  username: string;
  sourceScope: "cn" | "global";
  sourceLabel: string;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="border-b border-slate-200 px-5 py-5">
        <Link href="/admin/stats" onClick={onNavigate} className="block">
          <div className="text-lg font-semibold text-slate-900">MornStudio管理后台</div>
          <div className="mt-1 text-xs text-slate-500">
            当前环境：{sourceLabel}（{sourceScope}）
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`block rounded-md px-3 py-2 text-sm ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
          当前管理员：{username}
        </div>
        <form action={adminLogout} className="mt-2">
          <button
            type="submit"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            退出登录
          </button>
        </form>
      </div>
    </>
  );
}

export default function AdminSidebar({
  username,
  sourceScope,
  sourceLabel,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <Link href="/admin/stats" className="text-base font-semibold text-slate-900">
          MornStudio管理后台
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
        >
          {mobileOpen ? "关闭" : "菜单"}
        </button>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed bottom-16 left-0 top-14 z-50 w-72 border-r border-slate-200 bg-white transition-transform duration-200 md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent
          pathname={pathname}
          username={username}
          sourceScope={sourceScope}
          sourceLabel={sourceLabel}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-50 grid h-16 grid-cols-6 border-t border-slate-200 bg-white md:hidden">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-center px-1 text-xs ${
                active ? "font-medium text-slate-900" : "text-slate-500"
              }`}
            >
              {item.shortLabel}
            </Link>
          );
        })}
      </nav>

      <aside className="hidden border-r border-slate-200 bg-white md:fixed md:left-0 md:top-0 md:flex md:h-screen md:w-64 md:flex-col">
        <SidebarContent
          pathname={pathname}
          username={username}
          sourceScope={sourceScope}
          sourceLabel={sourceLabel}
          onNavigate={() => undefined}
        />
      </aside>
    </>
  );
}
