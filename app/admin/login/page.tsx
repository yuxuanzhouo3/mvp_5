import AdminLoginForm from "@/app/admin/login/AdminLoginForm";
import { getAppDisplayName } from "@/lib/app-branding";

export default async function AdminLoginPage() {
  const appDisplayName = await getAppDisplayName();
  return <AdminLoginForm appDisplayName={appDisplayName} />;
}
