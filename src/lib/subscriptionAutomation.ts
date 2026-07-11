/**
 * Subscription lifecycle automation — Phase 17.4
 * Pure evaluation logic for expiry, grace period, and renewal reminders.
 */

import type { PlatformSubscriptionSettings } from "./platformSubscriptionSettings";
import { resolveEffectiveSubscription, type EffectiveSubscription } from "./effectiveSubscription";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

export type SubscriptionRowCandidate = {
  subscriptionId: string;
  shopId: string | null;
  organizationId: string;
  status: string;
  trialEndsAt: string | null;
  periodEndAt: string | null;
};

export type ExpiryCandidate = SubscriptionRowCandidate & {
  reason: "trial_ended" | "period_ended";
  effectiveBefore: EffectiveSubscription;
};

export type GraceCandidate = SubscriptionRowCandidate & {
  graceEndsAt: string;
  effectiveBefore: EffectiveSubscription;
};

export type RenewalReminderCandidate = {
  shopId: string;
  subscriptionId: string;
  daysRemaining: number;
  effective: EffectiveSubscription;
};

const MS_DAY = 86400000;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function snapshotFromCandidate(row: SubscriptionRowCandidate): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: row.subscriptionId,
      organization_id: row.organizationId,
      shop_id: row.shopId,
      status: row.status,
      trial_ends_at: row.trialEndsAt,
      current_period_start: null,
      current_period_end: row.periodEndAt,
      plan_code: "business",
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
    },
    promotionalGrant: null,
  };
}

/** Subscriptions that should transition to expired (resolver agrees, row not yet expired). */
export function evaluateExpiryCandidates(
  rows: SubscriptionRowCandidate[],
  nowMs: number = Date.now(),
): ExpiryCandidate[] {
  const out: ExpiryCandidate[] = [];
  for (const row of rows) {
    const st = (row.status ?? "").toLowerCase();
    if (st === "expired" || st === "cancelled" || st === "paused") continue;

    const trialMs = parseMs(row.trialEndsAt);
    const periodMs = parseMs(row.periodEndAt);

    const isTrial = st === "trial" || st === "trialing";
    if (isTrial && trialMs !== null && trialMs <= nowMs) {
      const snap = snapshotFromCandidate(row);
      const effectiveBefore = resolveEffectiveSubscription(snap, nowMs);
      if (effectiveBefore.isExpired) {
        out.push({ ...row, reason: "trial_ended", effectiveBefore });
      }
      continue;
    }

    if (!isTrial && periodMs !== null && periodMs <= nowMs && st === "active") {
      const snap = snapshotFromCandidate(row);
      const effectiveBefore = resolveEffectiveSubscription(snap, nowMs);
      if (effectiveBefore.isExpired) {
        out.push({ ...row, reason: "period_ended", effectiveBefore });
      }
    }
  }
  return out;
}

/** Rows in grace window after period end (only when gracePeriodDays > 0). */
export function evaluateGracePeriodCandidates(
  rows: SubscriptionRowCandidate[],
  settings: PlatformSubscriptionSettings,
  nowMs: number = Date.now(),
): GraceCandidate[] {
  if (settings.gracePeriodDays <= 0) return [];
  const out: GraceCandidate[] = [];
  for (const row of rows) {
    const st = (row.status ?? "").toLowerCase();
    if (st !== "active" && st !== "past_due") continue;
    const periodMs = parseMs(row.periodEndAt);
    if (periodMs === null || periodMs > nowMs) continue;
    const graceEndMs = periodMs + settings.gracePeriodDays * MS_DAY;
    if (nowMs > graceEndMs) continue;
    const snap = snapshotFromCandidate(row);
    const effectiveBefore = resolveEffectiveSubscription(snap, nowMs);
    out.push({
      ...row,
      graceEndsAt: new Date(graceEndMs).toISOString(),
      effectiveBefore,
    });
  }
  return out;
}

/** Shops that should receive renewal reminders today. */
export function evaluateRenewalReminderCandidates(
  rows: SubscriptionRowCandidate[],
  settings: PlatformSubscriptionSettings,
  nowMs: number = Date.now(),
): RenewalReminderCandidate[] {
  const reminderDays = settings.subscriptionReminderDays;
  if (!reminderDays.length) return [];
  const out: RenewalReminderCandidate[] = [];

  for (const row of rows) {
    if (!row.shopId) continue;
    const st = (row.status ?? "").toLowerCase();
    if (st === "expired" || st === "cancelled" || st === "paused") continue;

    const snap = snapshotFromCandidate(row);
    const effective = resolveEffectiveSubscription(snap, nowMs);
    const days = effective.daysRemaining;
    if (days == null || days <= 0) continue;
    if (!reminderDays.includes(days)) continue;

    out.push({
      shopId: row.shopId,
      subscriptionId: row.subscriptionId,
      daysRemaining: days,
      effective,
    });
  }
  return out;
}

export type AutomationRunSummary = {
  expired: number;
  graceMarked: number;
  reminders: number;
  errors: string[];
};
