import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/session";
import AdminSidebar from "@/app/admin/components/AdminSidebar";
import { getAdminSourceLabel, getAdminSourceScope } from "@/lib/admin/source-scope";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";

  if (pathname.startsWith("/admin/login")) {
    return <>{children}</>;
  }

  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const sourceScope = getAdminSourceScope();
  const sourceLabel = getAdminSourceLabel(sourceScope);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar
        username={session.username}
        sourceScope={sourceScope}
        sourceLabel={sourceLabel}
      />
      <main className="pb-20 pt-14 px-4 md:ml-64 md:p-8 md:pb-8 md:pt-8">{children}</main>
    </div>
  );
}
