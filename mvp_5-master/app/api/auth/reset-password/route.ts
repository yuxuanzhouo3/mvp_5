import { NextResponse } from "next/server";
import { IS_DOMESTIC_VERSION } from "@/config";
import { CloudBaseAuthService } from "@/lib/cloudbase/auth";
import { VerificationCodeService } from "@/lib/email/verification-code";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (!IS_DOMESTIC_VERSION) {
      return new NextResponse(null, { status: 404 });
    }

    const { email, verificationCode, newPassword } = await req.json();

    if (!email || !verificationCode || !newPassword) {
      return NextResponse.json(
        { error: "邮箱、验证码和新密码不能为空" },
        { status: 400 }
      );
    }

    // 验证密码长度
    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "密码至少需要6个字符" },
        { status: 400 }
      );
    }

    // 验证验证码
    const codeVerification = VerificationCodeService.verifyCode(email, verificationCode);
    if (!codeVerification.valid) {
      return NextResponse.json(
        { error: codeVerification.error },
        { status: 400 }
      );
    }

    // 重置密码
    const service = new CloudBaseAuthService();
    const result = await service.resetPassword(email, newPassword);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error?.message || "重置密码失败" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "密码重置成功",
    });
  } catch (error) {
    console.error("[auth/reset-password] error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}
