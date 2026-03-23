import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export interface AdminSession {
  userId: string;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    console.warn("[AdminSession] 生产环境未配置 ADMIN_SESSION_SECRET，使用默认密钥（不安全）");
  }

  return secret || "mvp5-dev-admin-session-secret";
}

function toBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function signPayload(payloadBase64: string) {
  return toBase64Url(
    createHmac("sha256", getSessionSecret()).update(payloadBase64).digest(),
  );
}

function encodeToken(payload: AdminSession) {
  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function decodeToken(token: string): AdminSession | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payloadBase64);
  const given = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  try {
    const json = fromBase64Url(payloadBase64).toString("utf8");
    const payload = JSON.parse(json) as AdminSession;
    if (!payload.userId || !payload.username || !payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function createAdminSession(input: {
  userId: string;
  username: string;
  role: string;
}) {
  const now = Date.now();
  const payload: AdminSession = {
    userId: input.userId,
    username: input.username,
    role: input.role,
    iat: now,
    exp: now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  };

  const token = encodeToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = decodeToken(token);
  if (!payload) {
    return null;
  }

  if (Date.now() > payload.exp) {
    await destroyAdminSession();
    return null;
  }

  return payload;
}

export async function verifyAdminSession() {
  return (await getAdminSession()) !== null;
}

