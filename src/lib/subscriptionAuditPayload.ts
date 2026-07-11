/**
 * Enterprise subscription audit payload — Phase 16.4
 *
 * Defines the standard audit shape for subscription mutations.
 * Phase 16.5 engine will emit this payload on every grant/extend/cancel/renew.
 */

import type { BillingCycle, EffectiveSubscription, SubscriptionType } from "./effectiveSubscription";

export type SubscriptionAuditSource = "admin" | "system" | "payment" | "agent";

/** Standard audit entry for any subscription lifecycle action. */
export type SubscriptionAuditPayload = {
  action: string;
  before: EffectiveSubscription | null;
  after: EffectiveSubscription | null;
  reason: string | null;
  source: SubscriptionAuditSource;
  actorId: string | null;
  durationDays: number | null;
  billingCycle: BillingCycle | null;
  subscriptionType: SubscriptionType | null;
  timestamp: string;
};

export type BuildSubscriptionAuditPayloadInput = {
  action: string;
  before: EffectiveSubscription | null;
  after: EffectiveSubscription | null;
  reason?: string | null;
  source: SubscriptionAuditSource;
  actorId?: string | null;
  durationDays?: number | null;
  billingCycle?: BillingCycle | null;
  subscriptionType?: SubscriptionType | null;
  timestamp?: string;
};

/** Build a normalized audit payload — mutations should call this in Phase 16.5+. */
export function buildSubscriptionAuditPayload(
  input: BuildSubscriptionAuditPayloadInput,
): SubscriptionAuditPayload {
  const after = input.after;
  return {
    action: input.action,
    before: input.before,
    after: input.after,
    reason: input.reason ?? null,
    source: input.source,
    actorId: input.actorId ?? null,
    durationDays: input.durationDays ?? null,
    billingCycle: input.billingCycle ?? after?.billingCycle ?? input.before?.billingCycle ?? null,
    subscriptionType: input.subscriptionType ?? after?.subscriptionType ?? input.before?.subscriptionType ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
