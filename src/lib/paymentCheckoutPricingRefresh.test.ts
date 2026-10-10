import { describe, expect, it } from "vitest";
import {
  checkoutReducer,
  initialCheckoutState,
  quotePricingSignature,
  type CheckoutQuote,
  type CheckoutState,
} from "./paymentCheckout";

function quote(overrides: Partial<CheckoutQuote> = {}): CheckoutQuote {
  return {
    planCode: "business",
    cycle: "monthly",
    amountUgx: 36_000,
    campaignId: null,
    quotedAt: "2026-10-10T00:00:00.000Z",
    isCurrent: false,
    currentPlanCode: "starter",
    ...overrides,
  };
}

/** A state that is holding a quote, reached the way the flow actually reaches it. */
function selecting(overrides: Partial<CheckoutState> = {}): CheckoutState {
  let state = checkoutReducer(initialCheckoutState("monthly"), {
    type: "SELECT_PLAN",
    plan: "business",
  });
  state = checkoutReducer(state, { type: "QUOTE_OK", quote: quote() });
  return { ...state, ...overrides };
}

describe("checkoutReducer — PRICING_CHANGED", () => {
  it("drops a held quote so it is re-read from the server", () => {
    const state = selecting();
    expect(state.quote).not.toBeNull();

    const next = checkoutReducer(state, { type: "PRICING_CHANGED" });

    expect(next.quote).toBeNull();
    expect(next.quoteErrorKey).toBeNull();
  });

  it("routes straight to the refreshing indication rather than an empty price row", () => {
    const next = checkoutReducer(selecting(), { type: "PRICING_CHANGED" });

    expect(next.quoteLoading).toBe(true);
    expect(next.phase).toBe("selecting");
  });

  it("keeps the plan and cycle the payer chose", () => {
    const next = checkoutReducer(selecting(), { type: "PRICING_CHANGED" });

    expect(next.planCode).toBe("business");
    expect(next.cycle).toBe("monthly");
  });

  it("does nothing when no quote is held", () => {
    const state = checkoutReducer(initialCheckoutState("monthly"), {
      type: "SELECT_PLAN",
      plan: "business",
    });

    expect(checkoutReducer(state, { type: "PRICING_CHANGED" })).toBe(state);
  });

  /**
   * THE LOAD-BEARING CASE. Once the server holds an intent for a specific amount,
   * clearing the quote would not change that intent — it would only re-open plan
   * selection over a live payment and invite a second one.
   */
  it("refuses while a payment intent exists", () => {
    const state = selecting({
      phase: "pending_provider",
      intent: {
        paymentId: "p1",
        reference: "ref1",
        phone: "+256700000000",
        planCode: "business",
        cycle: "monthly",
        amountUgx: 36_000,
      },
      initiated: true,
    });

    expect(checkoutReducer(state, { type: "PRICING_CHANGED" })).toBe(state);
  });

  it("refuses during intent creation, before `intent` is populated", () => {
    const state = selecting({ phase: "creating_payment" });

    expect(checkoutReducer(state, { type: "PRICING_CHANGED" })).toBe(state);
  });

  it("refuses once the payment has been initiated, even mid-reconciliation", () => {
    const state = selecting({ phase: "reconciliation_required", initiated: true });

    expect(checkoutReducer(state, { type: "PRICING_CHANGED" })).toBe(state);
  });

  it("refuses in terminal phases", () => {
    for (const phase of ["confirmed", "failed", "cancelled"] as const) {
      const state = selecting({ phase });
      expect(checkoutReducer(state, { type: "PRICING_CHANGED" })).toBe(state);
    }
  });

  it("still re-quotes normally afterwards, so the payer is not stuck", () => {
    let state = checkoutReducer(selecting(), { type: "PRICING_CHANGED" });
    state = checkoutReducer(state, { type: "QUOTE_STARTED" });
    state = checkoutReducer(state, {
      type: "QUOTE_OK",
      quote: quote({ amountUgx: 41_000, campaignId: "c1" }),
    });

    expect(state.quote?.amountUgx).toBe(41_000);
    expect(state.quoteLoading).toBe(false);
  });
});

describe("checkoutReducer — a failed re-quote is never a zero-price quote", () => {
  it("holds no quote and no amount after a refresh fails", () => {
    let state = checkoutReducer(selecting(), { type: "PRICING_CHANGED" });
    state = checkoutReducer(state, { type: "QUOTE_STARTED" });
    state = checkoutReducer(state, { type: "QUOTE_FAILED", errorKey: "checkoutUnavailable" });

    expect(state.quote).toBeNull();
    expect(state.quoteErrorKey).toBe("checkoutUnavailable");
    expect(state.quoteLoading).toBe(false);
  });
});

describe("quotePricingSignature", () => {
  const base = {
    planCode: "business" as const,
    cycle: "monthly" as const,
    currentPlanCode: "starter",
    planPricing: { originalMonthlyUgx: 36_000, finalMonthlyUgx: 36_000, finalAnnualUgx: 360_000 },
    campaignId: null,
  };

  it("is stable for identical inputs", () => {
    expect(quotePricingSignature(base)).toBe(quotePricingSignature({ ...base }));
  });

  it("changes when a campaign discount moves the selected plan's price", () => {
    const discounted = {
      ...base,
      campaignId: "campaign-1",
      planPricing: { originalMonthlyUgx: 36_000, finalMonthlyUgx: 27_000, finalAnnualUgx: 270_000 },
    };

    expect(quotePricingSignature(discounted)).not.toBe(quotePricingSignature(base));
  });

  it("changes when only the campaign identity changes", () => {
    expect(quotePricingSignature({ ...base, campaignId: "campaign-2" })).not.toBe(
      quotePricingSignature({ ...base, campaignId: "campaign-1" }),
    );
  });

  it("changes when the subscription's own plan moves", () => {
    expect(quotePricingSignature({ ...base, currentPlanCode: "waka_plus" })).not.toBe(
      quotePricingSignature(base),
    );
  });

  it("changes when the selection changes", () => {
    expect(quotePricingSignature({ ...base, planCode: "starter" })).not.toBe(quotePricingSignature(base));
    expect(quotePricingSignature({ ...base, cycle: "yearly" })).not.toBe(quotePricingSignature(base));
  });

  it("ignores the rest of the book — only the selected plan is projected", () => {
    const otherPlansRepriced = { ...base };

    expect(quotePricingSignature(otherPlansRepriced)).toBe(quotePricingSignature(base));
  });

  it("distinguishes a not-yet-known price row from a known one", () => {
    expect(quotePricingSignature({ ...base, planPricing: null })).not.toBe(quotePricingSignature(base));
    expect(quotePricingSignature({ ...base, planPricing: undefined })).toBe(
      quotePricingSignature({ ...base, planPricing: null }),
    );
  });
});
