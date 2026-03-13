/**
 * 邮箱验证码服务
 * 用于国内版邮箱注册、登录、找回密码的验证码管理
 */

interface VerificationCodeData {
  code: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

const codeStore = new Map<string, VerificationCodeData>();

export class VerificationCodeService {
  private static CODE_LENGTH = 6;
  private static CODE_EXPIRY_MS = 10 * 60 * 1000; // 10分钟

  /**
   * 生成6位数字验证码
   */
  static generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 存储验证码
   */
  static storeCode(email: string, code: string): void {
    const now = Date.now();
    codeStore.set(email.toLowerCase(), {
      code,
      email: email.toLowerCase(),
      createdAt: now,
      expiresAt: now + this.CODE_EXPIRY_MS,
    });
  }

  /**
   * 验证验证码
   */
  static verifyCode(email: string, code: string): { valid: boolean; error?: string } {
    const normalizedEmail = email.toLowerCase();
    const stored = codeStore.get(normalizedEmail);

    if (!stored) {
      return { valid: false, error: "验证码不存在或已过期" };
    }

    if (Date.now() > stored.expiresAt) {
      codeStore.delete(normalizedEmail);
      return { valid: false, error: "验证码已过期" };
    }

    if (stored.code !== code) {
      return { valid: false, error: "验证码错误" };
    }

    // 验证成功后删除验证码
    codeStore.delete(normalizedEmail);
    return { valid: true };
  }

  /**
   * 清理过期验证码
   */
  static cleanupExpiredCodes(): void {
    const now = Date.now();
    const entries = Array.from(codeStore.entries());
    for (const [email, data] of entries) {
      if (now > data.expiresAt) {
        codeStore.delete(email);
      }
    }
  }
}

// 定期清理过期验证码
setInterval(() => {
  VerificationCodeService.cleanupExpiredCodes();
}, 5 * 60 * 1000); // 每5分钟清理一次
