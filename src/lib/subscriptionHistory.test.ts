import { describe, expect, it } from "vitest";
import {
  buildBillingTimelineEvents,
  parseSubscriptionHistoryFromAuditRow,
  parseSubscriptionHistoryRows,
} from "./subscriptionHistory";
import type { OpsAuditRow } from "./wakaInternalAdmin";

describe("subscriptionHistory", () => {
  const auditRow: OpsAuditRow = {
    id: "audit-1",
    actor: "user-abc",
    action: "subscription.grant",
    target_shop_id: "shop-1",
    target_org_id: "org-1",
    created_at: "2026-07-01T10:00:00.000Z",
    payload: {
      subscriptionAudit: {
        action: "subscription.grant",
        before: null,
        after: {
          planCode: "business",
          planTier: "business",
          subscriptionType: "paid",
          status: "active",
          source: "subscription",
          billingCycle: "monthly",
          startsAt: null,
          expiresAt: "2026-08-01T00:00:00.000Z",
          trialEndsAt: null,
          promotionalGrant: null,
          effectivePlan: "business",
          isTrial: false,
          isPaid: true,
          isExpired: false,
          daysRemaining: 30,
          deviceLimit: 3,
        },
        reason: "Admin grant",
        source: "admin",
        actorId: "user-abc",
        durationDays: 30,
        billingCycle: "monthly",
        subscriptionType: "paid",
        timestamp: "2026-07-01T10:00:00.000Z",
      },
    },
  };

  it("parses subscription audit payload from ops row", () => {
    const row = parseSubscriptionHistoryFromAuditRow(auditRow);
    expect(row?.action).toBe("subscription.grant");
    expect(row?.reason).toBe("Admin grant");
    expect(row?.after?.effectivePlan).toBe("business");
  });

  it("builds timeline events from history rows", () => {
    const history = parseSubscriptionHistoryRows([auditRow]);
    const events = buildBillingTimelineEvents(history);
    expect(events[0]?.kind).toBe("subscription_granted");
  });
});
