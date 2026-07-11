/**
 * Subscription history — Phase 17.4
 * Parses audit rows into unified before → action → after history entries.
 */

import type { SubscriptionAuditPayload } from "./subscriptionAuditPayload";
import type { EffectiveSubscription } from "./effectiveSubscription";
import type { OpsAuditRow } from "./wakaInternalAdmin";

export type SubscriptionHistoryRow = {
  id: string;
  action: string;
  before: EffectiveSubscription | null;
  after: EffectiveSubscription | null;
  reason: string | null;
  source: string | null;
  operator: string | null;
  timestamp: string;
};

const SUBSCRIPTION_ACTION_PREFIX = "subscription.";

function parseSubscriptionAudit(payload: Record<string, unknown> | null): SubscriptionAuditPayload | null {
  if (!payload) return null;
  const raw = payload.subscriptionAudit;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.action !== "string") return null;
  return {
    action: o.action,
    before: (o.before as EffectiveSubscription | null) ?? null,
    after: (o.after as EffectiveSubscription | null) ?? null,
    reason: typeof o.reason === "string" ? o.reason : null,
    source: (o.source as SubscriptionAuditPayload["source"]) ?? "system",
    actorId: typeof o.actorId === "string" ? o.actorId : null,
    durationDays: typeof o.durationDays === "number" ? o.durationDays : null,
    billingCycle: (o.billingCycle as SubscriptionAuditPayload["billingCycle"]) ?? null,
    subscriptionType: (o.subscriptionType as SubscriptionAuditPayload["subscriptionType"]) ?? null,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : new Date().toISOString(),
  };
}

export function isSubscriptionAuditAction(action: string): boolean {
  return action.startsWith(SUBSCRIPTION_ACTION_PREFIX);
}

export function parseSubscriptionHistoryFromAuditRow(row: OpsAuditRow): SubscriptionHistoryRow | null {
  const audit = parseSubscriptionAudit(row.payload);
  if (!audit) return null;
  return {
    id: row.id,
    action: audit.action,
    before: audit.before,
    after: audit.after,
    reason: audit.reason,
    source: audit.source,
    operator: audit.actorId ?? row.actor,
    timestamp: audit.timestamp || row.created_at,
  };
}

export function parseSubscriptionHistoryRows(rows: OpsAuditRow[]): SubscriptionHistoryRow[] {
  const out: SubscriptionHistoryRow[] = [];
  for (const row of rows) {
    const parsed = parseSubscriptionHistoryFromAuditRow(row);
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export type BillingTimelineEventKind =
  | "trial_started"
  | "trial_extended"
  | "subscription_granted"
  | "renewed"
  | "paused"
  | "cancelled"
  | "expired"
  | "promotional_grant"
  | "promotional_revoked"
  | "plan_changed"
  | "grace_period"
  | "renewal_reminder"
  | "other";

export type BillingTimelineEvent = {
  id: string;
  kind: BillingTimelineEventKind;
  label: string;
  action: string;
  timestamp: string;
  reason: string | null;
  source: string | null;
  operator: string | null;
};

const ACTION_KIND_MAP: Record<string, BillingTimelineEventKind> = {
  "subscription.grant": "subscription_granted",
  "subscription.renew": "renewed",
  "subscription.extend_trial": "trial_extended",
  "subscription.pause": "paused",
  "subscription.cancel": "cancelled",
  "subscription.resume": "renewed",
  "subscription.expire": "expired",
  "subscription.grant_promotional": "promotional_grant",
  "subscription.revoke_promotional": "promotional_revoked",
  "subscription.grant_trial": "trial_started",
  "subscription.on_signup_grant": "trial_started",
  "subscription.mark_paid": "renewed",
  "subscription.reset_to_free": "plan_changed",
  "subscription.grace_period": "grace_period",
  "subscription.renewal_reminder": "renewal_reminder",
};

export function actionToTimelineKind(action: string): BillingTimelineEventKind {
  return ACTION_KIND_MAP[action] ?? "other";
}

export function buildBillingTimelineEvents(rows: SubscriptionHistoryRow[]): BillingTimelineEvent[] {
  return rows.map((row) => ({
    id: row.id,
    kind: actionToTimelineKind(row.action),
    label: row.action.replace(/^subscription\./, "").replace(/_/g, " "),
    action: row.action,
    timestamp: row.timestamp,
    reason: row.reason,
    source: row.source,
    operator: row.operator,
  }));
}

export function formatEffectivePlanLabel(effective: EffectiveSubscription | null): string {
  if (!effective) return "—";
  return effective.effectivePlan.replace(/_/g, " ");
}

export function formatSubscriptionTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatBillingStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}
