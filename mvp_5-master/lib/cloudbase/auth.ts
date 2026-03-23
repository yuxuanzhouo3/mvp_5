/**
 * CloudBase 认证服务（国内版）
 * 使用 CloudBase 文档库的 users 与 sessions 两张集合
 */

import bcrypt from "bcryptjs";
import { CloudBaseConnector } from "./connector";

export interface CloudBaseUser {
  _id?: string;
  email: string | null;
  password: string | null;
  name: string | null;
  avatar: string | null;
  wechatOpenId?: string;
  wechatUnionId?: string | null;
  createdAt: string;
  lastLoginAt: string;
  pro: boolean;
  region: "CN";
  subscriptionTier?: string;
  plan?: string | null;
  plan_exp?: string | null;
  paymentMethod: string | null;
  source?: string;
}

export interface CloudBaseSession {
  access_token: string;
  expires_at: number;
  user: CloudBaseAuthUser;
}

export interface CloudBaseAuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  createdAt: Date;
  metadata: {
    pro: boolean;
    region: "CN";
    plan?: string | null;
    plan_exp?: string | null;
  };
}

export class CloudBaseAuthService {
  private db: any = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize() {
    const connector = new CloudBaseConnector({});
    await connector.initialize();
    this.db = connector.getClient();
  }

  private async ensureReady() {
    if (this.initPromise) await this.initPromise;
    if (!this.db) throw new Error("CloudBase database not ready");
  }

  async signInWithEmail(email: string, password: string): Promise<{
    user: CloudBaseAuthUser | null;
    session?: CloudBaseSession;
    error?: Error;
  }> {
    try {
      await this.ensureReady();
      const result = await this.db.collection("users").where({ email }).get();
      const user = result.data[0] as CloudBaseUser | undefined;
      if (!user || !user.password) {
        return { user: null, error: new Error("用户不存在") };
      }

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        return { user: null, error: new Error("密码错误") };
      }

      const authUser = this.mapUser(user._id!, user);
      const session = await this.createSession(user._id!);

      await this.db
        .collection("users")
        .doc(user._id)
        .update({ lastLoginAt: new Date().toISOString() });

      return { user: authUser, session };
    } catch (error) {
      console.error("[cloudbase] signIn error", error);
      return { user: null, error: error as Error };
    }
  }

  async signUpWithEmail(email: string, password: string, name?: string): Promise<{
    user: CloudBaseAuthUser | null;
    session?: CloudBaseSession;
    error?: Error;
  }> {
    try {
      await this.ensureReady();
      const existing = await this.db.collection("users").where({ email }).get();
      if (existing.data.length > 0) {
        return { user: null, error: new Error("用户已存在") };
      }

      const hashed = await bcrypt.hash(password, 10);
      const now = new Date().toISOString();

      const userData: CloudBaseUser = {
        email,
        password: hashed,
        name: name || null,
        avatar: null,
        createdAt: now,
        lastLoginAt: now,
        pro: false,
        region: "CN",
        subscriptionTier: "free",
        plan: "free",
        plan_exp: null,
        paymentMethod: null,
        source: "cn",
      };

      const result = await this.db.collection("users").add(userData);

      const authUser = this.mapUser(result.id, userData);
      const session = await this.createSession(result.id);

      return { user: authUser, session };
    } catch (error) {
      console.error("[cloudbase] signUp error", error);
      return { user: null, error: error as Error };
    }
  }

  async validateToken(token: string): Promise<CloudBaseAuthUser | null> {
    try {
      await this.ensureReady();

      const sessions = await this.db.collection("sessions").where({ token }).limit(1).get();
      const session = sessions.data[0] as { userId: string; expiresAt: number } | undefined;
      if (!session) {
        return null;
      }
      if (session.expiresAt < Date.now()) {
        return null;
      }

      const users = await this.db.collection("users").doc(session.userId).get();
      const user = users.data[0] as CloudBaseUser | undefined;
      if (!user || !user._id) {
        return null;
      }

      return this.mapUser(user._id, user);
    } catch (error) {
      console.error("[cloudbase] validate token error", error);
      return null;
    }
  }

  async resetPassword(email: string, newPassword: string): Promise<{
    success: boolean;
    error?: Error;
  }> {
    try {
      await this.ensureReady();
      const result = await this.db.collection("users").where({ email }).get();
      const user = result.data[0] as CloudBaseUser | undefined;

      if (!user || !user._id) {
        return { success: false, error: new Error("用户不存在") };
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await this.db.collection("users").doc(user._id).update({
        password: hashed,
        updatedAt: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      console.error("[cloudbase] resetPassword error", error);
      return { success: false, error: error as Error };
    }
  }

  private generateToken(): string {
    return Buffer.from(`${Date.now()}-${Math.random().toString(36).slice(2)}`).toString("base64");
  }

  private async createSession(userId: string): Promise<CloudBaseSession> {
    const token = this.generateToken();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    await this.db.collection("sessions").add({
      userId,
      token,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    const users = await this.db.collection("users").doc(userId).get();
    const user = users.data[0] as CloudBaseUser;
    const authUser = this.mapUser(userId, user);

    return {
      access_token: token,
      expires_at: expiresAt,
      user: authUser,
    };
  }

  private mapUser(id: string, user: CloudBaseUser): CloudBaseAuthUser {
    const plan = user.plan || user.subscriptionTier || (user.pro ? "pro" : "free");
    const planLower = typeof plan === "string" ? plan.toLowerCase() : "free";
    const isProEffective = !!user.pro && planLower !== "basic";

    return {
      id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: new Date(user.createdAt),
      metadata: {
        pro: isProEffective,
        region: "CN",
        plan,
        plan_exp: user.plan_exp || null,
      },
    };
  }
}
