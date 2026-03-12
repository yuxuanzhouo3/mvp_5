export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  DomesticPaymentError,
  ensureDomesticAppUser,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
} from "@/lib/payment/domestic-payment";
import { deletePersistedGenerationHistory } from "@/lib/server/generation-history";

function resolveStatus(error: unknown) {
  if (error instanceof DomesticPaymentError) {
    return error.status;
  }

  return 400;
}

export async function DELETE(
  request: NextRequest,
  context: { params: { generationId: string } },
) {
  try {
    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    await ensureDomesticAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    const result = await deletePersistedGenerationHistory({
      db,
      source: "cn",
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