export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  ensureGlobalAppUser,
  GlobalPaymentError,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
} from "@/lib/payment/global-payment";
import { deletePersistedGenerationHistory } from "@/lib/server/generation-history";

function resolveStatus(error: unknown) {
  if (error instanceof GlobalPaymentError) {
    return error.status;
  }

  return 400;
}

export async function DELETE(
  request: NextRequest,
  context: { params: { generationId: string } },
) {
  try {
    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    await ensureGlobalAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    const result = await deletePersistedGenerationHistory({
      db,
      source: "global",
      userId: user.userId,
      taskId: context.params.generationId,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Failed to delete generation record.";

    return NextResponse.json(
      { success: false, error: message },
      { status: resolveStatus(error) },
    );
  }
}