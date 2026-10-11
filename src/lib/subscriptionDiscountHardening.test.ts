/**
 * The client side of the discount hardening (2026-10-11). Pure functions only —
 * the SQL contract lives in `subscriptionDiscountHardening.sql.integration.test.ts`.
 *
 * Each block pins one of the approved decisions as the BROWSER sees it:
 *   A  a refused manual payment explains which amount is owed
 *   C  a zero-amount checkout reads as "nothing to pay", not as a crash
 *   D  the public book carries the global discount and never an account one
 *   item 10  the savings figure matches the price now that the floor is applied
 *            first, and the two admin screens name the plans identically
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_DISCOUNT_PLAN_LABELS,
  MAX_ADMIN_DISCOUNT_PERCENT,
  mapDiscountError,
  normalizeDiscountPercent,
  parseDiscountPercent,
  validateDiscountDraft,
} from "./adminSubscriptionDiscounts";
import { PLAN_LABELS } from "./pricingCampaigns";
import { explainMarkPaidRefusal } from "./subscriptionEngine";
import { classifyCheckoutError } from "./paymentCheckout";
import {
  CANONICAL_PLAN_PRICES,
  MIN_FINAL_MONTHLY_UGX,
  buildDefaultPublicPricing,
  computePlanDisplayPrice,
  mapPublicPricingRpc,
  pricingForPlan,
} from "./subscriptionPricing";

describe("A — a refused manual payment explains what is owed", () => {
  it("names the server's amount when it refuses a mismatch", () => {
    const message = explainMarkPaidRefusal(
      "amount_mismatch",
      "expected_amount_ugx=18000",
    );
    expect(message).toContain("UGX 18,000");
    expect(message).toContain("record that instead");
  });

  it("falls back to a reload instruction when the amount is not supplied", () => {
    expect(explainMarkPaidRefusal("amount_mismatch", null)).toContain("Reload the account");
  });

  it("routes a fully discounted account to the free-period grant", () => {
    expect(explainMarkPaidRefusal("fully_discounted", "effective_discount_percent=100")).toContain(
      "Grant the free period instead",
    );
  });

  it("explains a zero plan and a non-positive amount", () => {
    expect(explainMarkPaidRefusal("nothing_to_pay", null)).toContain("nothing to pay");
    expect(explainMarkPaidRefusal("invalid_amount", "expected_amount_ugx=36000")).toContain(
      "Zero and negative amounts",
    );
  });

  it("passes an unrelated error through untouched", () => {
    expect(explainMarkPaidRefusal("some_other_error", null)).toBe("some_other_error");
  });
});

describe("F1 — a free period is refused while a payment is in flight", () => {
  it("turns the refusal into an instruction, on both admin paths", () => {
    const message = mapDiscountError("payment_reconciliation_required");
    expect(message).toContain("already sent to the provider");
    expect(message).toContain("before granting a free period");
    expect(message).not.toBe("payment_reconciliation_required");

    // The same code reaches the console's mark-paid path, where it already had
    // its own wording; both must stay human.
    expect(explainMarkPaidRefusal("payment_reconciliation_required", null)).toBe(
      "payment_reconciliation_required",
    );
  });

  it("explains the impossible-window conflict instead of claiming success", () => {
    const message = mapDiscountError("free_activation_conflict");
    expect(message).toContain("already covers this window");
    expect(message).toContain("Nothing was granted");
  });
});

describe("C — a zero-amount checkout reads as 'nothing to pay'", () => {
  it("classifies the server's refusal on the same key as the local guard", () => {
    for (const error of ["fully_discounted", "zero_amount"]) {
      const classified = classifyCheckoutError(error);
      expect(classified.errorKey, error).toBe("checkoutFullyDiscounted");
    }
  });

  it("still classifies a real amount mismatch as a requote", () => {
    expect(classifyCheckoutError("amount_mismatch")).toEqual({
      errorKey: "checkoutPriceUpdated",
      kind: "requote",
    });
  });
});

describe("10 — the saving is what the floor leaves, not what was asked for", () => {
  it("reports the real saving when the UGX 5,000 floor binds", () => {
    const starter = computePlanDisplayPrice("starter", {
      monthlyDiscountType: "percentage",
      monthlyDiscountValue: 90,
    });
    // 90% of 18,000 is 16,200, but the price only falls to the 5,000 floor.
    expect(starter.finalMonthlyUgx).toBe(MIN_FINAL_MONTHLY_UGX);
    expect(starter.monthlyDiscountUgx).toBe(18_000 - MIN_FINAL_MONTHLY_UGX);
    expect(starter.monthlyDiscountUgx).not.toBe(16_200);
  });

  it("leaves an unfloored discount exactly as asked", () => {
    const business = computePlanDisplayPrice("business", {
      monthlyDiscountType: "percentage",
      monthlyDiscountValue: 25,
    });
    expect(business.finalMonthlyUgx).toBe(27_000);
    expect(business.monthlyDiscountUgx).toBe(9_000);
  });

  it("caps a fixed amount at the floor too, and reports that cap", () => {
    const business = computePlanDisplayPrice("business", {
      monthlyDiscountType: "fixed_amount",
      monthlyDiscountValue: 999_999,
    });
    expect(business.finalMonthlyUgx).toBe(MIN_FINAL_MONTHLY_UGX);
    expect(business.monthlyDiscountUgx).toBe(36_000 - MIN_FINAL_MONTHLY_UGX);
  });

  it("keeps the campaign clamp where it was", () => {
    const enterprise = computePlanDisplayPrice("waka_plus", {
      monthlyDiscountType: "percentage",
      monthlyDiscountValue: 99,
    });
    expect(enterprise.finalMonthlyUgx).toBe(8_200); // 90% of 82,000, above the floor
  });
});

describe("10 — one plan, one name, on both admin screens", () => {
  it("uses the same labels the Pricing Campaigns window uses", () => {
    for (const plan of ["starter", "business", "waka_plus"] as const) {
      expect(ADMIN_DISCOUNT_PLAN_LABELS[plan]).toBe(PLAN_LABELS[plan]);
    }
    expect(ADMIN_DISCOUNT_PLAN_LABELS.waka_plus).toBe("Enterprise (Waka Plus)");
    expect(ADMIN_DISCOUNT_PLAN_LABELS.waka_plus).not.toBe("DKASU Plus");
  });
});

describe("D — the public book carries the global rule", () => {
  const rpcRow = (over: Record<string, unknown> = {}) => ({
    plan_code: "business",
    original_monthly_ugx: 36_000,
    monthly_discount_ugx: 0,
    final_monthly_ugx: 18_000,
    original_annual_full_ugx: 432_000,
    final_annual_ugx: 172_800,
    annual_discount_percent: 20,
    has_monthly_discount: false,
    has_annual_discount: true,
    campaign_monthly_ugx: 36_000,
    campaign_annual_ugx: 345_600,
    global_discount_percent: 50,
    ...over,
  });

  it("takes the final price from the server rather than re-deriving it", () => {
    const snapshot = mapPublicPricingRpc({
      global_discount_active: true,
      plans: [rpcRow()],
      as_of: "2026-10-11T00:00:00Z",
    });
    const business = pricingForPlan(snapshot, "business");

    expect(business.finalMonthlyUgx).toBe(18_000);
    expect(business.originalMonthlyUgx).toBe(36_000);
    expect(business.campaignMonthlyUgx).toBe(36_000);
    expect(business.globalDiscountPercent).toBe(50);
    expect(snapshot.globalDiscountActive).toBe(true);
  });

  it("says nothing about a discount when the book is undiscounted", () => {
    const snapshot = mapPublicPricingRpc({
      global_discount_active: false,
      plans: [
        rpcRow({
          final_monthly_ugx: 36_000,
          final_annual_ugx: 345_600,
          global_discount_percent: 0,
          campaign_monthly_ugx: undefined,
          campaign_annual_ugx: undefined,
        }),
      ],
    });
    const business = pricingForPlan(snapshot, "business");

    expect(business.finalMonthlyUgx).toBe(36_000);
    expect(snapshot.globalDiscountActive).toBe(false);
    // An older deployment that publishes none of the new fields still maps.
    expect(business.campaignMonthlyUgx).toBeUndefined();
  });

  it("derives the flag from the per-plan percentages when the server omits it", () => {
    const snapshot = mapPublicPricingRpc({ plans: [rpcRow()] });
    expect(snapshot.globalDiscountActive).toBe(true);
  });

  it("falls back to the canonical book when the server returns no plans", () => {
    const snapshot = mapPublicPricingRpc({ plans: [] });
    expect(snapshot.plans.length).toBe(CANONICAL_PLAN_PRICES.length);
    expect(snapshot.globalDiscountActive).toBe(false);
  });

  it("starts from an undiscounted book before the RPC answers", () => {
    const fallback = buildDefaultPublicPricing();
    expect(fallback.globalDiscountActive).toBe(false);
    expect(fallback.plans.every((p) => p.finalMonthlyUgx === p.originalMonthlyUgx)).toBe(true);
  });
});

describe("ordinary discounts stay capped at 99% — 100% is a separate flow", () => {
  it("refuses to parse or normalise above the cap", () => {
    expect(parseDiscountPercent("100").ok).toBe(false);
    expect(normalizeDiscountPercent(100)).toBe(MAX_ADMIN_DISCOUNT_PERCENT);
    expect(normalizeDiscountPercent(-5)).toBe(0);
  });

  it("still accepts the cap itself", () => {
    const parsed = parseDiscountPercent("99");
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toBe(99);
  });

  it("rejects an inverted window before it reaches the server", () => {
    const errors = validateDiscountDraft({
      percentRaw: "25",
      startsAt: "2026-12-01",
      expiresAt: "2026-11-01",
    });
    expect(errors.window).toBeTruthy();
  });
});
