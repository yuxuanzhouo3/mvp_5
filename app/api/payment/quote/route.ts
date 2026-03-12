export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertGlobalSubscriptionPurchaseAllowed,
  ensureGlobalAppUser,
  prepareGlobalSubscriptionCheckout,
  readGlobalAddonPricing,
  requireGlobalLoginUser,
  requireGlobalRuntimeDb,
  resolveGlobalAddonCode,
  resolveGlobalBillingPeriod,
  resolveGlobalPlanCode,
  toHttpError,
} from "@/lib/payment/global-payment";

type QuoteRequestBody = {
  planName?: unknown;
  billingPeriod?: unknown;
  productType?: unknown;
  addonPackageId?: unknown;
};

function resolveProductType(input: unknown) {
  return typeof input === "string" && input.trim().toUpperCase() === "ADDON"
    ? "ADDON"
    : "SUBSCRIPTION";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QuoteRequestBody;
    const productType = resolveProductType(body.productType);
    const user = await requireGlobalLoginUser(request);
    const db = await requireGlobalRuntimeDb();

    await ensureGlobalAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    if (productType === "ADDON") {
      const resolvedAddonCode = resolveGlobalAddonCode(body.addonPackageId);
      if (!resolvedAddonCode) {
        return NextResponse.json(
          { success: false, error: "Unsupported add-on package." },
          { status: 400 },
        );
      }

      const addon = await readGlobalAddonPricing({
        db,
        addonCode: resolvedAddonCode,
      });

      if (addon.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "Invalid add-on amount. Please contact support." },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        productType,
        addonCode: addon.addonCode,
        amount: addon.amount,
        originalAmount: null,
        currency: addon.currency,
        isUpgrade: false,
      });
    }

    const resolvedPlanCode = resolveGlobalPlanCode(body.planName);
    if (!resolvedPlanCode) {
      return NextResponse.json(
        { success: false, error: "Only Pro and Enterprise subscriptions are supported." },
        { status: 400 },
      );
    }

    const resolvedBillingPeriod = resolveGlobalBillingPeriod(body.billingPeriod);
    await assertGlobalSubscriptionPurchaseAllowed({
      db,
      userId: user.userId,
      targetPlanCode: resolvedPlanCode,
    });

    const subscriptionQuote = await prepareGlobalSubscriptionCheckout({
      db,
      userId: user.userId,
      planCode: resolvedPlanCode,
      billingPeriod: resolvedBillingPeriod,
    });
    const plan = subscriptionQuote.checkoutPlan;

    if (plan.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid plan amount. Please contact support." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      productType,
      planCode: plan.planCode,
      billingPeriod: resolvedBillingPeriod,
      amount: plan.amount,
      originalAmount: plan.originalAmount,
      currency: plan.currency,
      isUpgrade: subscriptionQuote.isUpgrade,
    });
  } catch (error) {
    const httpError = toHttpError(error);
    console.error("[Global Quote] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
