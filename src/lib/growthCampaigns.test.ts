/**
 * Growth Campaign & Monetization Control — domain tests.
 * Covers: automatic grant, referral grant, manual grant, grant expiry,
 * subscription fallback, campaign disable, audit logging, conversion metrics.
 */
import { describe, expect, it } from "vitest";
import {
  GROWTH_AUDIT_ACTIONS,
  buildGrowthAuditEvent,
  computeCampaignMetrics,
  computeGrantExpiry,
  extendGrantExpiry,
  isCampaignActive,
  isGrantActive,
  resolveRegistrationGrant,
  type CampaignSubscriptionRow,
  type GrowthCampaign,
  type GrowthReferralCode,
  type PromotionalGrant,
} from "./growthCampaigns";
import {
  hasCommercialSubscription,
  hasEffectivePermission,
  resolveEffectivePlanTier,
  type RemoteSubscriptionRow,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";

const NOW = new Date("2026-06-10T12:00:00.000Z").getTime();
const DAY = 86_400_000;

function iso(offsetDays: number): string {
  return new Date(NOW + offsetDays * DAY).toISOString();
}

function campaign(overrides: Partial<GrowthCampaign> = {}): GrowthCampaign {
  return {
    id: "camp-1",
    name: "Uganda Launch 2026",
    description: "180-day Business for new shops",
    enabled: true,
    grantMode: "automatic",
    grantedPlanCode: "business",
    durationDays: 180,
    startsAt: iso(-1),
    endsAt: iso(30),
    ...overrides,
  };
}

function referralCode(overrides: Partial<GrowthReferralCode> = {}): GrowthReferralCode {
  return {
    id: "code-1",
    campaignId: "camp-1",
    code: "UGA2026",
    description: "Uganda launch",
    planCode: "business",
    durationDays: 180,
    enabled: true,
    ...overrides,
  };
}

function grant(overrides: Partial<PromotionalGrant> = {}): PromotionalGrant {
  return {
    id: "grant-1",
    organizationId: "org-1",
    shopId: "shop-1",
    campaignId: "camp-1",
    referralCodeId: null,
    planCode: "business",
    grantedBy: "growth_campaign",
    grantedByAdminId: null,
    reason: null,
    grantedAt: iso(-10),
    expiresAt: iso(170),
    revokedAt: null,
    ...overrides,
  };
}

function remote(
  row: Partial<RemoteSubscriptionRow> & Pick<RemoteSubscriptionRow, "plan_code" | "status">,
  promotionalGrant?: { plan_code: string; expires_at: string; revoked_at?: string | null } | null,
): SubscriptionSnapshot {
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
    promotionalGrant: promotionalGrant
      ? {
          id: "g1",
          plan_code: promotionalGrant.plan_code,
          granted_by: "growth_campaign",
          campaign_id: "camp-1",
          granted_at: iso(-10),
          expires_at: promotionalGrant.expires_at,
          revoked_at: promotionalGrant.revoked_at ?? null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------

describe("automatic grant", () => {
  it("grants the campaign plan and duration to every new shop", () => {
    const decision = resolveRegistrationGrant({ campaign: campaign(), nowMs: NOW });
    expect(decision).toEqual({
      planCode: "business",
      durationDays: 180,
      grantedBy: "growth_campaign",
      campaignId: "camp-1",
      referralCodeId: null,
    });
  });

  it("computes expiry from granted-at plus duration", () => {
    expect(computeGrantExpiry(iso(0), 180)).toBe(iso(180));
  });
});

describe("referral grant", () => {
  const referralCampaign = campaign({ grantMode: "referral_based" });

  it("grants only with a matching enabled code (case-insensitive)", () => {
    const decision = resolveRegistrationGrant({
      campaign: referralCampaign,
      referralCodes: [referralCode()],
      usedReferralCode: " uga2026 ",
      nowMs: NOW,
    });
    expect(decision?.grantedBy).toBe("referral_code");
    expect(decision?.planCode).toBe("business");
    expect(decision?.durationDays).toBe(180);
    expect(decision?.referralCodeId).toBe("code-1");
  });

  it("uses the code's own plan and duration (agent code)", () => {
    const agent = referralCode({ id: "code-2", code: "AGENT001", planCode: "starter", durationDays: 90 });
    const decision = resolveRegistrationGrant({
      campaign: referralCampaign,
      referralCodes: [agent],
      usedReferralCode: "AGENT001",
      nowMs: NOW,
    });
    expect(decision?.planCode).toBe("starter");
    expect(decision?.durationDays).toBe(90);
  });

  it("denies without a code, with an unknown code, or with a disabled code", () => {
    const codes = [referralCode({ enabled: false })];
    expect(resolveRegistrationGrant({ campaign: referralCampaign, referralCodes: codes, nowMs: NOW })).toBeNull();
    expect(
      resolveRegistrationGrant({
        campaign: referralCampaign,
        referralCodes: codes,
        usedReferralCode: "NOPE",
        nowMs: NOW,
      }),
    ).toBeNull();
    expect(
      resolveRegistrationGrant({
        campaign: referralCampaign,
        referralCodes: codes,
        usedReferralCode: "UGA2026",
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});

describe("manual grant", () => {
  it("never grants at registration in manual mode", () => {
    const decision = resolveRegistrationGrant({
      campaign: campaign({ grantMode: "manual" }),
      usedReferralCode: "UGA2026",
      referralCodes: [referralCode()],
      nowMs: NOW,
    });
    expect(decision).toBeNull();
  });

  it("extends from current expiry when still active, and from now when already expired", () => {
    const active = grant({ expiresAt: iso(10) });
    expect(extendGrantExpiry(active, 30, NOW)).toBe(iso(40));

    const expired = grant({ expiresAt: iso(-5) });
    expect(extendGrantExpiry(expired, 30, NOW)).toBe(iso(30));
  });
});

describe("grant expiry", () => {
  it("is active before expiry, inactive after, and inactive when revoked", () => {
    expect(isGrantActive(grant({ expiresAt: iso(1) }), NOW)).toBe(true);
    expect(isGrantActive(grant({ expiresAt: iso(-1) }), NOW)).toBe(false);
    expect(isGrantActive(grant({ expiresAt: iso(10), revokedAt: iso(-1) }), NOW)).toBe(false);
  });
});

describe("subscription resolution & fallback", () => {
  it("free shop + business grant resolves to business permissions", () => {
    const snap = remote({ plan_code: "free", status: "active" }, { plan_code: "business", expires_at: iso(170) });
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("business");
    expect(hasEffectivePermission("owner", "owner.dashboard", snap, "supabase")).toBe(true);
    expect(hasCommercialSubscription(snap)).toBe(true);
  });

  it("falls back to the paid subscription when the grant expires", () => {
    const snap = remote(
      { plan_code: "starter", status: "active", current_period_end: iso(20) },
      { plan_code: "business", expires_at: iso(-1) },
    );
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("starter");
  });

  it("falls back to free when the grant expires and there is no paid subscription", () => {
    const snap = remote({ plan_code: "free", status: "active" }, { plan_code: "business", expires_at: iso(-1) });
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("free");
  });

  it("a revoked grant gives no premium access", () => {
    const snap = remote(
      { plan_code: "free", status: "active" },
      { plan_code: "business", expires_at: iso(100), revoked_at: iso(0) },
    );
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("free");
  });

  it("never downgrades a higher paid tier during a campaign (no feature loss)", () => {
    const snap = remote(
      { plan_code: "waka_plus", status: "active", current_period_end: iso(20) },
      { plan_code: "starter", expires_at: iso(100) },
    );
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("waka_plus");
  });

  it("grant applies even when there is no subscription row at all", () => {
    const snap: SubscriptionSnapshot = {
      kind: "none",
      promotionalGrant: {
        id: "g1",
        plan_code: "business",
        granted_by: "growth_campaign",
        campaign_id: "camp-1",
        granted_at: iso(-1),
        expires_at: iso(100),
        revoked_at: null,
      },
    };
    expect(resolveEffectivePlanTier(snap, NOW)).toBe("business");
  });
});

describe("campaign disable", () => {
  it("computed Campaign Active follows enabled flag and date window", () => {
    expect(isCampaignActive(campaign(), NOW)).toBe(true);
    expect(isCampaignActive(campaign({ enabled: false }), NOW)).toBe(false);
    expect(isCampaignActive(campaign({ startsAt: iso(1) }), NOW)).toBe(false);
    expect(isCampaignActive(campaign({ endsAt: iso(-1) }), NOW)).toBe(false);
    expect(isCampaignActive(campaign({ startsAt: null, endsAt: null }), NOW)).toBe(true);
  });

  it("a disabled campaign stops granting but existing grants keep running until expiry", () => {
    const disabled = campaign({ enabled: false });
    expect(resolveRegistrationGrant({ campaign: disabled, nowMs: NOW })).toBeNull();

    // Existing grant stays valid — disabling the campaign is not a revoke.
    const existing = grant({ expiresAt: iso(50) });
    expect(isGrantActive(existing, NOW)).toBe(true);
  });
});

describe("audit logging", () => {
  it("covers all required growth audit actions", () => {
    expect(GROWTH_AUDIT_ACTIONS).toEqual([
      "growth_campaign_created",
      "growth_campaign_updated",
      "promotional_access_granted",
      "promotional_access_extended",
      "promotional_access_revoked",
      "referral_code_created",
      "referral_code_used",
    ]);
  });

  it("builds normalized audit events with admin, shop, campaign, plan, duration, reason", () => {
    const event = buildGrowthAuditEvent({
      action: "promotional_access_granted",
      at: iso(0),
      adminId: "admin-1",
      shopId: "shop-1",
      campaignId: "camp-1",
      planCode: "business",
      durationDays: 180,
      reason: "launch promo",
    });
    expect(event).toEqual({
      action: "promotional_access_granted",
      at: iso(0),
      adminId: "admin-1",
      shopId: "shop-1",
      campaignId: "camp-1",
      planCode: "business",
      durationDays: 180,
      reason: "launch promo",
      summary: "promotional_access_granted plan=business days=180",
    });
  });

  it("defaults optional fields to null and stamps a timestamp", () => {
    const event = buildGrowthAuditEvent({ action: "growth_campaign_created" });
    expect(event.adminId).toBeNull();
    expect(event.shopId).toBeNull();
    expect(event.reason).toBeNull();
    expect(Number.isFinite(new Date(event.at).getTime())).toBe(true);
  });
});

describe("conversion metrics", () => {
  const grants = [
    grant({ id: "g1", organizationId: "org-1", expiresAt: iso(50) }),
    grant({ id: "g2", organizationId: "org-2", expiresAt: iso(-5) }),
    grant({ id: "g3", organizationId: "org-3", expiresAt: iso(-5) }),
    grant({ id: "g4", organizationId: "org-4", campaignId: "camp-other", expiresAt: iso(50) }),
  ];
  const subs: CampaignSubscriptionRow[] = [
    // org-2 converted: real paid business subscription after grant expiry
    {
      organizationId: "org-2",
      planCode: "business",
      status: "active",
      currentPeriodEnd: iso(20),
      paid: true,
      monthlyPriceUgx: 30_000,
    },
    // org-3 has a free row → not converted
    {
      organizationId: "org-3",
      planCode: "free",
      status: "active",
      currentPeriodEnd: null,
      paid: false,
      monthlyPriceUgx: 0,
    },
  ];

  it("computes campaign shops, active/expired, conversions, rate, and MRR", () => {
    const m = computeCampaignMetrics(grants, subs, { campaignId: "camp-1", nowMs: NOW });
    expect(m.campaignShops).toBe(3);
    expect(m.activePromotionalShops).toBe(1);
    expect(m.expiredPromotionalShops).toBe(2);
    expect(m.convertedToPaid).toBe(1);
    expect(m.conversionRatePct).toBeCloseTo(33.3, 1);
    expect(m.mrrFromConvertedUgx).toBe(30_000);
  });

  it("filters by date range", () => {
    const m = computeCampaignMetrics(grants, subs, {
      campaignId: "camp-1",
      fromMs: NOW + DAY,
      nowMs: NOW,
    });
    expect(m.campaignShops).toBe(0);
    expect(m.conversionRatePct).toBe(0);
  });

  it("ignores manual-admin 'paid' rows so VIP grants don't count as conversions", () => {
    const vipSubs: CampaignSubscriptionRow[] = [
      {
        organizationId: "org-1",
        planCode: "waka_plus",
        status: "active",
        currentPeriodEnd: iso(20),
        paid: false,
        monthlyPriceUgx: 50_000,
      },
    ];
    const m = computeCampaignMetrics(grants, vipSubs, { campaignId: "camp-1", nowMs: NOW });
    expect(m.convertedToPaid).toBe(0);
    expect(m.mrrFromConvertedUgx).toBe(0);
  });
});
