import {
  resolveEffectiveSubscription,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "../subscriptionEntitlements";
import {
  parseShopVisionSettings,
  visionCapacityForWakaPlan,
  type ShopVisionSettings,
} from "./shopVisionSettings";

export type VisionAuthMode = "cloud" | "local_bypass";

/** UI / route status derived from WAKA subscription + Admin kill-switch. */
export type VisionAccessStatus =
  | "included"
  | "trial"
  | "local_bypass"
  | "subscription_expired"
  | "subscription_required"
  | "admin_disabled"
  | "no_shop"
  | "no_permission";

export type VisionAccess = {
  /** Vision software available (paid/trial WAKA, not admin-disabled). */
  enabled: boolean;
  status: VisionAccessStatus;
  /** WAKA plan driving capacity. */
  planCode: SubscriptionPlanCode;
  /** Human label for Settings / Admin. */
  planLabel: string;
  /** Included with the WAKA subscription (not a separate SKU). */
  includedWithSubscription: boolean;
  /** Active WAKA trial (Vision follows the same trial). */
  onWakaTrial: boolean;
  trialDaysRemaining: number | null;
  /** Paid or trial subscription currently active. */
  subscriptionActive: boolean;
  /** Subscription/trial ended — registry preserved, Live/Monitor locked. */
  subscriptionExpired: boolean;
  maxDvrs: number | null;
  maxCameras: number | null;
  /** Core Vision — same for every paid plan. */
  canUseLiveView: boolean;
  canUseMonitoring: boolean;
  canUsePosTimeline: boolean;
  canManageDvrs: boolean;
  canAssignCameras: boolean;
  /** Aliases used by existing Vision pages. */
  canLive: boolean;
  canMonitor: boolean;
  /** Future premium add-ons (optional; default off). */
  canUseRemoteAccess: boolean;
  canUseAiAnalytics: boolean;
  /** Camera / DVR registry always readable when shop exists (config preserved). */
  canManageRegistry: boolean;
  messageKey: string;
  reason:
    | "ok"
    | "local_bypass"
    | "no_shop"
    | "admin_disabled"
    | "subscription_required"
    | "subscription_expired"
    | "no_permission";
};

const PLAN_LABELS: Record<SubscriptionPlanCode, string> = {
  free: "Free",
  starter: "Starter",
  business: "Business",
  waka_plus: "Enterprise",
};

function messageKeyFor(status: VisionAccessStatus): string {
  switch (status) {
    case "subscription_expired":
      return "visionLicSubExpired";
    case "admin_disabled":
      return "visionLicAdminDisabled";
    case "no_permission":
      return "visionLicNotActivated";
    case "no_shop":
      return "visionLicNotActivated";
    case "subscription_required":
      return "visionLicNotActivated";
    default:
      return "visionLicIncluded";
  }
}

export function resolveVisionAccess(input: {
  settings: ShopVisionSettings | null | undefined;
  shopId: string | null | undefined;
  authMode: VisionAuthMode;
  snapshot: SubscriptionSnapshot | null | undefined;
  hasSettingsView?: boolean;
}): VisionAccess {
  const base = (partial: Partial<VisionAccess> & Pick<VisionAccess, "status" | "reason">): VisionAccess => {
    const merged: VisionAccess = {
      enabled: false,
      planCode: "free",
      planLabel: PLAN_LABELS.free,
      includedWithSubscription: true,
      onWakaTrial: false,
      trialDaysRemaining: null,
      subscriptionActive: false,
      subscriptionExpired: false,
      maxDvrs: 0,
      maxCameras: 0,
      canUseLiveView: false,
      canUseMonitoring: false,
      canUsePosTimeline: false,
      canManageDvrs: false,
      canAssignCameras: false,
      canLive: false,
      canMonitor: false,
      canUseRemoteAccess: false,
      canUseAiAnalytics: false,
      canManageRegistry: false,
      messageKey: "",
      ...partial,
    };
    merged.canLive = merged.canUseLiveView;
    merged.canMonitor = merged.canUseMonitoring;
    merged.messageKey = messageKeyFor(merged.status);
    return merged;
  };

  if (input.hasSettingsView === false) {
    return base({ status: "no_permission", reason: "no_permission" });
  }

  if (input.authMode === "local_bypass" || input.snapshot?.kind === "local_full") {
    return base({
      enabled: true,
      status: "local_bypass",
      reason: "local_bypass",
      planCode: "waka_plus",
      planLabel: PLAN_LABELS.waka_plus,
      subscriptionActive: true,
      maxDvrs: null,
      maxCameras: null,
      canUseLiveView: true,
      canUseMonitoring: true,
      canUsePosTimeline: true,
      canManageDvrs: true,
      canAssignCameras: true,
      canManageRegistry: true,
    });
  }

  const shopId = String(input.shopId ?? "").trim();
  if (!shopId) {
    return base({ status: "no_shop", reason: "no_shop" });
  }

  const settings = input.settings ?? null;
  const sub = resolveEffectiveSubscription(input.snapshot ?? { kind: "none" });
  const planCode = sub.effectivePlan;
  const planLabel = PLAN_LABELS[planCode];
  const onWakaTrial = sub.isTrial && !sub.isExpired;
  const subscriptionActive = (!sub.isExpired && planCode !== "free") || onWakaTrial;
  const subscriptionExpired = sub.isExpired;

  const planCap = visionCapacityForWakaPlan(subscriptionActive ? planCode : "free");
  const maxDvrs = settings?.max_dvrs != null ? settings.max_dvrs : planCap.max_dvrs;
  const maxCameras = settings?.max_cameras != null ? settings.max_cameras : planCap.max_cameras;

  if (settings?.admin_disabled) {
    return base({
      status: "admin_disabled",
      reason: "admin_disabled",
      planCode,
      planLabel,
      onWakaTrial,
      trialDaysRemaining: onWakaTrial ? sub.daysRemaining : null,
      subscriptionActive,
      subscriptionExpired,
      maxDvrs,
      maxCameras,
      canManageRegistry: true,
    });
  }

  if (!subscriptionActive) {
    const inactiveStatus = subscriptionExpired ? "subscription_expired" : "subscription_required";
    return base({
      status: inactiveStatus,
      reason: inactiveStatus,
      planCode,
      planLabel,
      subscriptionActive: false,
      subscriptionExpired,
      maxDvrs,
      maxCameras,
      canManageRegistry: true,
    });
  }

  // Paid / trial WAKA → full core Vision; capacity only differs by plan / Admin override.
  return base({
    enabled: true,
    status: onWakaTrial ? "trial" : "included",
    reason: "ok",
    planCode,
    planLabel,
    onWakaTrial,
    trialDaysRemaining: onWakaTrial ? sub.daysRemaining : null,
    subscriptionActive: true,
    subscriptionExpired: false,
    maxDvrs,
    maxCameras,
    canUseLiveView: true,
    canUseMonitoring: true,
    canUsePosTimeline: true,
    canManageDvrs: true,
    canAssignCameras: true,
    canUseRemoteAccess: settings?.feature_remote_access === true,
    canUseAiAnalytics: settings?.feature_ai_analytics === true,
    canManageRegistry: true,
  });
}

export function withinVisionLimit(current: number, max: number | null | undefined): boolean {
  if (max == null) return true;
  return current < max;
}

export function visionLimitLabel(max: number | null | undefined): string {
  if (max == null) return "Unlimited";
  return String(max);
}

export function wouldExceedVisionCameraLimit(
  access: Pick<VisionAccess, "maxCameras">,
  currentCount: number,
  adding: number,
): boolean {
  if (access.maxCameras == null) return false;
  return currentCount + adding > access.maxCameras;
}

export function wouldExceedVisionDvrLimit(
  access: Pick<VisionAccess, "maxDvrs">,
  currentCount: number,
  adding: number,
): boolean {
  if (access.maxDvrs == null) return false;
  return currentCount + adding > access.maxDvrs;
}

/** @deprecated Use resolveVisionAccess with WAKA subscription snapshot. */
export function canUseVisionFromSettings(
  settings: ShopVisionSettings | null | undefined,
  opts?: { shopId?: string | null; authMode?: VisionAuthMode; hasSettingsView?: boolean },
): VisionAccess {
  return resolveVisionAccess({
    settings: settings ?? null,
    shopId: opts?.shopId,
    authMode: opts?.authMode ?? "cloud",
    snapshot: null,
    hasSettingsView: opts?.hasSettingsView,
  });
}

export function parseVisionSettingsSafe(raw: unknown, shopId: string): ShopVisionSettings | null {
  return parseShopVisionSettings(raw, shopId);
}
