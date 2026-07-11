import { describe, expect, it } from "vitest";
import { buildSubscriptionAuditPayload } from "./subscriptionAuditPayload";
import { resolveEffectiveSubscription } from "./effectiveSubscription";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

function remote(row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
      ...row,
    } as RemoteSubscriptionRow,
  };
}

describe("buildSubscriptionAuditPayload", () => {
  it("produces standardized audit fields", () => {
    const before = resolveEffectiveSubscription(remote({ plan_code: "free", status: "active" }));
    const after = resolveEffectiveSubscription(remote({ plan_code: "business", status: "trial" }));
    const payload = buildSubscriptionAuditPayload({
      action: "admin.grant_plan",
      before,
      after,
      reason: "Promotion",
      source: "admin",
      actorId: "admin-1",
      durationDays: 30,
    });
    expect(payload.action).toBe("admin.grant_plan");
    expect(payload.before?.effectivePlan).toBe("free");
    expect(payload.after?.effectivePlan).toBe("business");
    expect(payload.reason).toBe("Promotion");
    expect(payload.source).toBe("admin");
    expect(payload.durationDays).toBe(30);
    expect(payload.timestamp).toBeTruthy();
  });
});
