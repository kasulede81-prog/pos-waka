import { describe, expect, it } from "vitest";
import {
  resolveVisionAccess,
  wouldExceedVisionCameraLimit,
  wouldExceedVisionDvrLimit,
} from "./canUseVision";
import type { ShopVisionSettings } from "./shopVisionSettings";
import type { SubscriptionSnapshot } from "../subscriptionEntitlements";

const baseSettings = (partial: Partial<ShopVisionSettings> = {}): ShopVisionSettings => ({
  shop_id: "shop-1",
  vision_enabled: true,
  admin_disabled: false,
  license_tier: "none",
  max_dvrs: null,
  max_cameras: null,
  feature_live_view: true,
  feature_monitoring: true,
  feature_pos_timeline: true,
  feature_remote_access: false,
  feature_ai_analytics: false,
  trial_enabled: false,
  trial_expires_at: null,
  installer_label: null,
  ...partial,
});

function remoteSnap(
  plan: "starter" | "business" | "waka_plus" | "free",
  status: string,
  extras: Partial<{ trial_ends_at: string | null; current_period_end: string | null }> = {},
): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "sub-1",
      organization_id: "org-1",
      shop_id: "shop-1",
      status,
      trial_ends_at: extras.trial_ends_at ?? null,
      current_period_start: "2026-01-01T00:00:00.000Z",
      current_period_end: extras.current_period_end ?? "2027-01-01T00:00:00.000Z",
      plan_code: plan,
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
    },
  };
}

describe("resolveVisionAccess (V1.4.6 subscription-included)", () => {
  it("includes Vision for paid Starter with starter capacity", () => {
    const a = resolveVisionAccess({
      settings: baseSettings(),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("starter", "active"),
    });
    expect(a.enabled).toBe(true);
    expect(a.status).toBe("included");
    expect(a.planCode).toBe("starter");
    expect(a.canLive).toBe(true);
    expect(a.canMonitor).toBe(true);
    expect(a.maxDvrs).toBe(1);
    expect(a.maxCameras).toBe(4);
  });

  it("applies Business capacity defaults", () => {
    const a = resolveVisionAccess({
      settings: baseSettings(),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("business", "active"),
    });
    expect(a.maxDvrs).toBe(2);
    expect(a.maxCameras).toBe(16);
  });

  it("applies Enterprise unlimited capacity", () => {
    const a = resolveVisionAccess({
      settings: baseSettings(),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("waka_plus", "active"),
    });
    expect(a.maxDvrs).toBeNull();
    expect(a.maxCameras).toBeNull();
  });

  it("Admin capacity overrides beat plan defaults", () => {
    const a = resolveVisionAccess({
      settings: baseSettings({ max_dvrs: 5, max_cameras: 40 }),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("starter", "active"),
    });
    expect(a.maxDvrs).toBe(5);
    expect(a.maxCameras).toBe(40);
  });

  it("disables Live/Monitor when subscription expired but keeps registry", () => {
    const a = resolveVisionAccess({
      settings: baseSettings({ max_cameras: 8 }),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("business", "expired", {
        current_period_end: "2020-01-01T00:00:00.000Z",
      }),
    });
    expect(a.status).toBe("subscription_expired");
    expect(a.canManageRegistry).toBe(true);
    expect(a.canLive).toBe(false);
    expect(a.canMonitor).toBe(false);
  });

  it("respects Admin kill-switch", () => {
    const a = resolveVisionAccess({
      settings: baseSettings({ admin_disabled: true }),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("business", "active"),
    });
    expect(a.status).toBe("admin_disabled");
    expect(a.enabled).toBe(false);
    expect(a.canLive).toBe(false);
    expect(a.canManageRegistry).toBe(true);
  });

  it("ignores legacy Vision license_tier for enablement", () => {
    const a = resolveVisionAccess({
      settings: baseSettings({ license_tier: "enterprise", vision_enabled: false }),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("starter", "active"),
    });
    expect(a.enabled).toBe(true);
    expect(a.status).toBe("included");
  });

  it("local bypass without shop id", () => {
    const a = resolveVisionAccess({
      settings: null,
      shopId: null,
      authMode: "local_bypass",
      snapshot: { kind: "local_full" },
    });
    expect(a.status).toBe("local_bypass");
    expect(a.canLive).toBe(true);
    expect(a.maxCameras).toBeNull();
  });

  it("enforces camera and DVR caps", () => {
    const a = resolveVisionAccess({
      settings: baseSettings(),
      shopId: "shop-1",
      authMode: "cloud",
      snapshot: remoteSnap("starter", "active"),
    });
    expect(wouldExceedVisionCameraLimit(a, 4, 1)).toBe(true);
    expect(wouldExceedVisionCameraLimit(a, 3, 1)).toBe(false);
    expect(wouldExceedVisionDvrLimit(a, 1, 1)).toBe(true);
    expect(wouldExceedVisionDvrLimit(a, 0, 1)).toBe(false);
  });
});
