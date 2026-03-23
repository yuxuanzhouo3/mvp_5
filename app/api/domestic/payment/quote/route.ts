export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  assertDomesticSubscriptionPurchaseAllowed,
  ensureDomesticAppUser,
  prepareDomesticSubscriptionCheckout,
  readDomesticAddonPricing,
  requireDomesticLoginUser,
  requireDomesticRuntimeDb,
  resolveDomesticAddonCode,
  resolveDomesticBillingPeriod,
  resolveDomesticPlanCode,
  toHttpError,
} from "@/lib/payment/domestic-payment";

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
    const user = await requireDomesticLoginUser(request);
    const db = await requireDomesticRuntimeDb();

    await ensureDomesticAppUser({
      db,
      userId: user.userId,
      email: user.email,
    });

    if (productType === "ADDON") {
      const resolvedAddonCode = resolveDomesticAddonCode(body.addonPackageId);
      if (!resolvedAddonCode) {
        return NextResponse.json(
          { success: false, error: "仅支持已配置的加油包支付。" },
          { status: 400 },
        );
      }

      const addon = await readDomesticAddonPricing({
        db,
        addonCode: resolvedAddonCode,
      });

      if (addon.amount <= 0) {
        return NextResponse.json(
          { success: false, error: "当前加油包金额无效，请联系管理员。" },
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

    const resolvedPlanCode = resolveDomesticPlanCode(body.planName);
    if (!resolvedPlanCode) {
      return NextResponse.json(
        { success: false, error: "仅支持专业版或企业版订阅支付。" },
        { status: 400 },
      );
    }

    const resolvedBillingPeriod = resolveDomesticBillingPeriod(body.billingPeriod);
    await assertDomesticSubscriptionPurchaseAllowed({
      db,
      userId: user.userId,
      targetPlanCode: resolvedPlanCode,
    });

    const subscriptionQuote = await prepareDomesticSubscriptionCheckout({
      db,
      userId: user.userId,
      planCode: resolvedPlanCode,
      billingPeriod: resolvedBillingPeriod,
    });
    const plan = subscriptionQuote.checkoutPlan;

    if (plan.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "当前套餐金额无效，请联系管理员。" },
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
    console.error("[Domestic Quote] error:", error);
    return NextResponse.json(
      { success: false, error: httpError.message },
      { status: httpError.status },
    );
  }
}
