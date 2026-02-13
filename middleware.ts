import { NextRequest, NextResponse } from "next/server";
import { geoRouter } from "@/lib/core/geo-router";
import { RegionType } from "@/lib/utils/ip-detection";

const FAIL_CLOSED =
  (process.env.GEO_FAIL_CLOSED || "true").toLowerCase() === "true";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 跳过静态资源
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico") ||
    (pathname.includes(".") && !pathname.startsWith("/api/"))
  ) {
    return NextResponse.next();
  }

  try {
    const debugParam = searchParams.get("debug");
    const isDevelopment = process.env.NODE_ENV === "development";

    // 生产环境禁止调试模式
    if (debugParam && !isDevelopment) {
      console.warn(`[Middleware] Production debug mode blocked: ${debugParam}`);
      return new NextResponse(
        JSON.stringify({
          error: "Access Denied",
          message: "Debug mode is not allowed in production.",
          code: "DEBUG_MODE_BLOCKED",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 开发环境调试模式
    if (debugParam && isDevelopment) {
      console.info(`[Middleware] Debug mode enabled: ${debugParam}`);
      const debugResult = getDebugGeoResult(debugParam);

      if (debugResult) {
        const response = NextResponse.next();
        response.headers.set("X-User-Region", debugResult.region);
        response.headers.set("X-User-Country", debugResult.countryCode);
        response.headers.set("X-User-Currency", debugResult.currency);
        response.headers.set("X-Debug-Mode", debugParam);
        return response;
      }
    }

    // 正常地理位置检测
    const clientIP = getClientIP(request);

    if (!clientIP) {
      if (FAIL_CLOSED) {
        console.warn("[Middleware] No client IP, access blocked (fail-closed)");
        return new NextResponse(
          JSON.stringify({
            error: "Access Denied",
            message: "IP detection failed. Access blocked by policy.",
            code: "GEO_FAIL_CLOSED",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const res = NextResponse.next();
      res.headers.set("X-Geo-Error", "true");
      return res;
    }

    const geoResult = await geoRouter.detect(clientIP);

    // 禁止欧洲IP访问
    if (
      geoResult.region === RegionType.EUROPE &&
      !(debugParam && isDevelopment)
    ) {
      console.info(`[Middleware] European IP blocked: ${geoResult.countryCode}`);
      return new NextResponse(
        JSON.stringify({
          error: "Access Denied",
          message: "This service is not available in your region due to regulatory requirements.",
          code: "REGION_BLOCKED",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 添加地理信息头
    const response = NextResponse.next();
    response.headers.set("X-User-Region", geoResult.region);
    response.headers.set("X-User-Country", geoResult.countryCode);
    response.headers.set("X-User-Currency", geoResult.currency);

    if (debugParam && isDevelopment) {
      response.headers.set("X-Debug-Mode", debugParam);
    }

    return response;
  } catch (error) {
    console.error("[Middleware] Geo routing error:", error);

    if (FAIL_CLOSED) {
      return new NextResponse(
        JSON.stringify({
          error: "Access Denied",
          message: "Geo detection failed. Access blocked by policy.",
          code: "GEO_FAIL_CLOSED",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-Geo-Error", "true");
    return response;
  }
}

function getDebugGeoResult(debugParam: string) {
  switch (debugParam.toLowerCase()) {
    case "china":
    case "cn":
      return {
        region: RegionType.CHINA,
        countryCode: "CN",
        currency: "CNY",
        paymentMethods: ["wechat", "alipay"],
        authMethods: ["wechat", "email"],
      };
    case "usa":
    case "us":
      return {
        region: RegionType.USA,
        countryCode: "US",
        currency: "USD",
        paymentMethods: ["stripe", "paypal"],
        authMethods: ["google", "email"],
      };
    case "europe":
    case "eu":
      return {
        region: RegionType.EUROPE,
        countryCode: "DE",
        currency: "EUR",
        paymentMethods: [],
        authMethods: ["email"],
      };
    default:
      return null;
  }
}

function getClientIP(request: NextRequest): string | null {
  const isDev = process.env.NODE_ENV !== "production";

  // 开发环境调试IP
  if (isDev) {
    const debugIp =
      request.headers.get("x-debug-ip") ||
      request.nextUrl.searchParams.get("debug_ip") ||
      request.nextUrl.searchParams.get("debugip");
    if (debugIp && isValidIP(debugIp)) {
      return debugIp;
    }
  }

  // 1. X-Real-IP
  const realIP = request.headers.get("x-real-ip");
  if (realIP && isValidIP(realIP)) {
    return realIP;
  }

  // 2. X-Forwarded-For
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    for (const ip of ips) {
      if (isValidIP(ip)) {
        return ip;
      }
    }
  }

  // 3. 其他代理头
  const possibleHeaders = [
    "x-client-ip",
    "x-forwarded",
    "forwarded-for",
    "forwarded",
    "cf-connecting-ip",
    "true-client-ip",
  ];

  for (const header of possibleHeaders) {
    const ip = request.headers.get(header);
    if (ip && isValidIP(ip)) {
      return ip;
    }
  }

  // 4. Vercel 平台扩展
  const vercelIp = (request as unknown as { ip?: string }).ip;
  if (vercelIp && isValidIP(vercelIp)) {
    return vercelIp;
  }

  return null;
}

function isValidIP(ip: string): boolean {
  // IPv4
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((part) => part >= 0 && part <= 255);
  }

  // IPv6
  if (ip.includes(":")) {
    const ipv6Loose = /^[0-9a-fA-F:]+$/;
    if (!ipv6Loose.test(ip)) return false;
    const lower = ip.toLowerCase();
    // 排除本地和私有IPv6
    if (lower === "::1") return false;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return false;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
    if (lower.startsWith("2001:db8")) return false;
    return true;
  }

  return false;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
