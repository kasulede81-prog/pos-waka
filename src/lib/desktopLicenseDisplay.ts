import {
  getPaidPlanRenewalCountdown,
  resolveEffectivePlanTier,
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

function msToDays(ms: number): number {
  return Math.max(0, Math.ceil(ms / 86400000));
}

function resolveExpiryMs(snapshot: SubscriptionSnapshot, nowMs: number): number | null {
  if (snapshot.kind === "local_full") return null;
  const grant = snapshot.promotionalGrant;
  if (grant && !grant.revoked_at) {
    const grantEnd = new Date(grant.expires_at).getTime();
    if (Number.isFinite(grantEnd) && grantEnd > nowMs) return grantEnd;
  }
  if (snapshot.kind !== "remote") return null;
  const row = snapshot.row;
  if (row.trial_ends_at) {
    const trialEnd = new Date(row.trial_ends_at).getTime();
    if (Number.isFinite(trialEnd)) return trialEnd;
  }
  if (row.current_period_end) {
    const periodEnd = new Date(row.current_period_end).getTime();
    if (Number.isFinite(periodEnd)) return periodEnd;
  }
  return null;
}

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

  const planTier = resolveEffectivePlanTier(snapshot, nowMs);
  const row = snapshot.kind === "remote" ? snapshot.row : null;
  const st = (row?.status ?? "").trim().toLowerCase();
  const expiryMs = resolveExpiryMs(snapshot, nowMs);
  const expiryAt = expiryMs ? new Date(expiryMs) : null;

  if (st === "expired" || (expiryMs !== null && expiryMs <= nowMs && planTier !== "free")) {
    return {
      status: "expired",
      planTier,
      expiryAt,
      daysRemaining: 0,
      deviceLimit: row?.max_devices ?? maxDevicesHintForTier(planTier),
    };
  }

  const renewal = getPaidPlanRenewalCountdown(snapshot, nowMs);
  const daysRemaining =
    renewal?.days ?? (expiryMs !== null ? msToDays(expiryMs - nowMs) : null);

  if (daysRemaining !== null && daysRemaining <= EXPIRING_SOON_DAYS) {
    return {
      status: "expiring_soon",
      planTier,
      expiryAt,
      daysRemaining,
      deviceLimit: row?.max_devices ?? maxDevicesHintForTier(planTier),
    };
  }

  return {
    status: "active",
    planTier,
    expiryAt,
    daysRemaining,
    deviceLimit: row?.max_devices ?? maxDevicesHintForTier(planTier),
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
