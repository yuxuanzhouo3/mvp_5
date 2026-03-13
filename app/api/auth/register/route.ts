import { NextResponse } from "next/server";
import { IS_DOMESTIC_VERSION } from "@/config";
import { CloudBaseAuthService } from "@/lib/cloudbase/auth";
import { trackRegisterEvent } from "@/services/analytics";
import { VerificationCodeService } from "@/lib/email/verification-code";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // 版本隔离：国际版不允许访问 CloudBase 注册接口
    if (!IS_DOMESTIC_VERSION) {
      return new NextResponse(null, { status: 404 });
    }

    const { email, password, name, verificationCode } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
    }

    if (!verificationCode) {
      return NextResponse.json({ error: "验证码不能为空" }, { status: 400 });
    }

    // 验证验证码
    const codeVerification = VerificationCodeService.verifyCode(email, verificationCode);
    if (!codeVerification.valid) {
      return NextResponse.json({ error: codeVerification.error }, { status: 400 });
    }

    // 仅使用 CloudBase（国内版对标 mvp28-fix 项目）
    const service = new CloudBaseAuthService();
    const result = await service.signUpWithEmail(email, password, name);

    if (!result.user || !result.session) {
      return NextResponse.json(
        { error: result.error?.message || "注册失败" },
        { status: 400 }
      );
    }

    // 记录注册事件到 user_analytics
    trackRegisterEvent(result.user.id, {
      userAgent: req.headers.get("user-agent") || undefined,
      language: req.headers.get("accept-language")?.split(",")[0] || undefined,
      referrer: req.headers.get("referer") || undefined,
      registerMethod: "email",
    }).catch((err) => console.warn("[auth/register] trackRegisterEvent error:", err));

    // 注册成功，不设置cookie，让用户手动登录
    return NextResponse.json({
      success: true,
      user: result.user,
      provider: "cloudbase",
    });
  } catch (error) {
    console.error("[auth/register] error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
