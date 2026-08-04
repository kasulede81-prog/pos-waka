import type { SubscriptionPlanCode } from "../subscriptionEntitlements";

/** @deprecated Kept for DB/API compat — Vision is not a separate SKU. */
export type VisionLicenseTier = "none" | "starter" | "business" | "enterprise";

export type ShopVisionSettings = {
  shop_id: string;
  /** @deprecated Ignored for enablement — use admin_disabled + WAKA subscription. */
  vision_enabled: boolean;
  /** Support kill-switch: when true, Vision is off even with a paid plan. */
  admin_disabled: boolean;
  /** @deprecated Ignored — capacity comes from WAKA plan (+ optional overrides). */
  license_tier: VisionLicenseTier;
  /** Null = use plan default capacity. */
  max_dvrs: number | null;
  /** Null = use plan default capacity. */
  max_cameras: number | null;
  /** @deprecated Core features follow subscription; kept for forward-compat. */
  feature_live_view: boolean;
  feature_monitoring: boolean;
  feature_pos_timeline: boolean;
  /** Future premium add-ons (not part of core Vision). */
  feature_remote_access: boolean;
  feature_ai_analytics: boolean;
  /** @deprecated Vision trial follows WAKA trial — ignored. */
  trial_enabled: boolean;
  trial_expires_at: string | null;
  installer_label: string | null;
  created_at?: string;
  updated_at?: string;
};

export const DEFAULT_SHOP_VISION_SETTINGS: Omit<ShopVisionSettings, "shop_id"> = {
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
};

/** Capacity included with each WAKA subscription plan. */
export const VISION_CAPACITY_BY_WAKA_PLAN: Record<
  SubscriptionPlanCode,
  { max_dvrs: number | null; max_cameras: number | null }
> = {
  free: { max_dvrs: 0, max_cameras: 0 },
  starter: { max_dvrs: 1, max_cameras: 4 },
  business: { max_dvrs: 2, max_cameras: 16 },
  waka_plus: { max_dvrs: null, max_cameras: null },
};

/** @deprecated Use VISION_CAPACITY_BY_WAKA_PLAN */
export const VISION_LICENSE_DEFAULTS: Record<
  VisionLicenseTier,
  { max_dvrs: number | null; max_cameras: number | null }
> = {
  none: { max_dvrs: 0, max_cameras: 0 },
  starter: { max_dvrs: 1, max_cameras: 4 },
  business: { max_dvrs: 2, max_cameras: 16 },
  enterprise: { max_dvrs: null, max_cameras: null },
};

export function parseShopVisionSettings(raw: unknown, shopIdFallback = ""): ShopVisionSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const shopId = String(obj.shop_id ?? shopIdFallback).trim();
  if (!shopId) return null;

  const tierRaw = String(obj.license_tier ?? "none");
  const license_tier: VisionLicenseTier =
    tierRaw === "starter" || tierRaw === "business" || tierRaw === "enterprise" || tierRaw === "none"
      ? tierRaw
      : "none";

  const numOrNull = (k: string): number | null => {
    if (!(k in obj) || obj[k] == null || obj[k] === "") return null;
    const n = Number(obj[k]);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };

  return {
    shop_id: shopId,
    vision_enabled: obj.vision_enabled !== false,
    // Enablement follows WAKA subscription; this is only a support kill-switch.
    admin_disabled: obj.admin_disabled === true,
    license_tier,
    max_dvrs: numOrNull("max_dvrs"),
    max_cameras: numOrNull("max_cameras"),
    feature_live_view: obj.feature_live_view !== false,
    feature_monitoring: obj.feature_monitoring !== false,
    feature_pos_timeline: obj.feature_pos_timeline !== false,
    feature_remote_access: obj.feature_remote_access === true,
    feature_ai_analytics: obj.feature_ai_analytics === true,
    trial_enabled: obj.trial_enabled === true,
    trial_expires_at: obj.trial_expires_at != null ? String(obj.trial_expires_at) : null,
    installer_label: obj.installer_label != null ? String(obj.installer_label) : null,
    created_at: obj.created_at != null ? String(obj.created_at) : undefined,
    updated_at: obj.updated_at != null ? String(obj.updated_at) : undefined,
  };
}

export function visionCapacityForWakaPlan(
  plan: SubscriptionPlanCode,
): { max_dvrs: number | null; max_cameras: number | null } {
  return { ...VISION_CAPACITY_BY_WAKA_PLAN[plan] };
}
