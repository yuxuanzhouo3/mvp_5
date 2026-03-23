export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  getRoutedRuntimeDbClient,
  resolveBackendFromLanguage,
} from "@/lib/server/database-routing";
import { applyDueDomesticPendingSubscriptions } from "@/lib/payment/domestic-payment";
import { applyDueGlobalPendingSubscriptions } from "@/lib/payment/global-payment";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  const authHeader = request.headers.get("authorization")?.trim() || "";

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    return NextResponse.json(
      { success: false, error: "Database unavailable" },
      { status: 503 },
    );
  }

  const backend = resolveBackendFromLanguage();
  const now = new Date();

  const result =
    backend === "cloudbase"
      ? await applyDueDomesticPendingSubscriptions({
          db,
          now,
        })
      : await applyDueGlobalPendingSubscriptions({
          db,
          now,
        });

  return NextResponse.json({
    success: true,
    backend,
    applied_count: result.appliedCount,
    error_count: result.errorCount,
    executed_at: now.toISOString(),
  });
}
