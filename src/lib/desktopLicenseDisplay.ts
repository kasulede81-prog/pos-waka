import { resolveEffectiveSubscription } from "./effectiveSubscription";
import {
  getPaidPlanRenewalCountdown,
  maxDevicesHintForTier,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";
import type { Language } from "../types";

export type DesktopLicenseStatus = "active" | "expiring_soon" | "expired";

const EXPIRING_SOON_DAYS = 15;

export type DesktopLicenseDisplay = {
  status: DesktopLicenseStatus;
  planTier: SubscriptionPlanCode;
  expiryAt: Date | null;
  daysRemaining: number | null;
  deviceLimit: number | null;
};

/** Subscription license strip for desktop terminal home — read-only display helpers. */
export function resolveDesktopLicenseDisplay(
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
  nowMs: number = Date.now(),
): DesktopLicenseDisplay {
  if (authMode === "local" || snapshot.kind === "local_full") {
    return {
      status: "active",
      planTier: "waka_plus",
      expiryAt: null,
      daysRemaining: null,
      deviceLimit: maxDevicesHintForTier("waka_plus"),
    };
  }

  const effective = resolveEffectiveSubscription(snapshot, nowMs, authMode);
  const planTier = effective.effectivePlan;
  const expiryAt = effective.expiresAt ? new Date(effective.expiresAt) : null;
  const deviceLimit = effective.deviceLimit ?? maxDevicesHintForTier(planTier);

  if (effective.isExpired) {
    return {
      status: "expired",
      planTier,
      expiryAt,
      daysRemaining: 0,
      deviceLimit,
    };
  }

  const renewal = getPaidPlanRenewalCountdown(snapshot, nowMs);
  const daysRemaining = renewal?.days ?? effective.daysRemaining;

  if (daysRemaining !== null && daysRemaining <= EXPIRING_SOON_DAYS) {
    return {
      status: "expiring_soon",
      planTier,
      expiryAt,
      daysRemaining,
      deviceLimit,
    };
  }

  return {
    status: "active",
    planTier,
    expiryAt,
    daysRemaining,
    deviceLimit,
  };
}

export function desktopPlanLabelKey(tier: SubscriptionPlanCode): string {
  if (tier === "starter") return "planStarterName";
  if (tier === "business") return "planBusinessName";
  if (tier === "waka_plus") return "planWakaPlusName";
  return "planFreeName";
}

export function formatDesktopLicenseDate(date: Date, lang: Language): string {
  const locale = lang === "lg" ? "lg-UG" : lang === "sw" ? "sw-UG" : "en-UG";
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
