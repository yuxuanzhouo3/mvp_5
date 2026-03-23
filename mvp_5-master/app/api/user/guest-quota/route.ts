import { readGuestGenerationQuota } from "@/lib/server/guest-quota";

export const dynamic = "force-dynamic";

function jsonWithCookie(
  payload: unknown,
  init?: ResponseInit,
  setCookieHeader?: string,
) {
  const response = Response.json(payload, init);
  if (setCookieHeader) {
    response.headers.append("Set-Cookie", setCookieHeader);
  }
  return response;
}

export async function GET(req: Request) {
  try {
    const { snapshot, setCookieHeader } = await readGuestGenerationQuota(req);
    return jsonWithCookie(snapshot, undefined, setCookieHeader);
  } catch (error) {
    console.error("[GuestQuota] 查询游客额度失败:", error);
    return Response.json(
      { message: "游客额度服务暂不可用，请稍后重试。" },
      { status: 503 },
    );
  }
}
