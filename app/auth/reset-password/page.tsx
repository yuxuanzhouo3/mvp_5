import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return <AuthPage mode="reset" />;
}
