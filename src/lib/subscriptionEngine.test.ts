import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SUBSCRIPTION_ENGINE_EXTENSION_POINTS,
  SUBSCRIPTION_ENGINE_VERSION,
  notifySubscriptionMutationChanged,
  onPaymentSuccess,
  onPaymentFailure,
  onRefund,
  processExpiry,
  processGracePeriod,
  processRenewalReminder,
  subscriptionEngine,
} from "./subscriptionEngine";
import { buildSubscriptionAuditPayload } from "./subscriptionAuditPayload";

describe("subscriptionEngine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports engine version 17.4", () => {
    expect(SUBSCRIPTION_ENGINE_VERSION).toBe("17.4");
    expect(subscriptionEngine.grant).toBeTypeOf("function");
    expect(subscriptionEngine.grantTrial).toBeTypeOf("function");
    expect(subscriptionEngine.resetToFree).toBeTypeOf("function");
    expect(subscriptionEngine.processGracePeriod).toBeTypeOf("function");
    expect(subscriptionEngine.processRenewalReminder).toBeTypeOf("function");
  });

  it("documents payment webhook stubs without live integration", async () => {
    expect(SUBSCRIPTION_ENGINE_EXTENSION_POINTS.onPaymentSuccess).toContain("onPaymentSuccess");
    const pay = await onPaymentSuccess({
      shopId: "s1",
      planCode: "business",
      amountUgx: 56000,
      provider: "stripe",
      externalReference: "ref-1",
    });
    expect(pay.ok).toBe(false);
    const fail = await onPaymentFailure({
      shopId: "s1",
      provider: "stripe",
      externalReference: "ref-1",
    });
    expect(fail.ok).toBe(false);
    const refund = await onRefund({
      shopId: "s1",
      provider: "stripe",
      externalReference: "ref-1",
      amountUgx: 1000,
    });
    expect(refund.ok).toBe(false);
  });

  it("processExpiry returns ok when no candidates offline", async () => {
    const expiry = await processExpiry();
    expect(expiry.ok).toBe(true);
    expect(expiry.summary?.expired).toBe(0);
  });

  it("processGracePeriod and processRenewalReminder run offline", async () => {
    const grace = await processGracePeriod();
    expect(grace.ok).toBe(true);
    const reminder = await processRenewalReminder();
    expect(reminder.ok).toBe(true);
  });

  it("notifySubscriptionMutationChanged dispatches refresh events", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    notifySubscriptionMutationChanged();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "waka:internal-ops-changed" }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "waka:subscription-updated" }));
  });

  it("buildSubscriptionAuditPayload integrates with engine action names", () => {
    const payload = buildSubscriptionAuditPayload({
      action: "subscription.grant",
      before: null,
      after: null,
      source: "admin",
      reason: "Promotion",
      durationDays: 30,
    });
    expect(payload.action).toBe("subscription.grant");
    expect(payload.source).toBe("admin");
    expect(payload.durationDays).toBe(30);
  });
});
