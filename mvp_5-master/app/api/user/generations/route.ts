export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  ensureGlobalAppUser,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
} from "@/lib/payment/global-payment";
import { listPersistedGenerationHistory } from "@/lib/server/generation-history";

export async function GET(request: NextRequest) {
  try {
    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    await ensureGlobalAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    const generations = await listPersistedGenerationHistory({
      db,
      source: "global",
      userId: user.userId,
      limit: 30,
    });

    return NextResponse.json({
      success: true,
      generations,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "读取生成历史失败";
    return NextResponse.json({ success: false, error: message }, { status: 401 });
  }
}
