/**
 * Enterprise Subscription Engine — Phase 17.4
 *
 * Canonical write path for all subscription mutations.
 * Calls existing Supabase RPCs — no business logic duplication.
 * Reads use resolveEffectiveSubscription (Phase 16.4).
 */

import { fetchActivePromotionalGrant } from "./fetchShopSubscription";
import { resolveEffectiveSubscription, type EffectiveSubscription } from "./effectiveSubscription";
import { notifyInternalOpsChanged } from "./internalAdminActionRunner";
import {
  fetchPlatformSubscriptionSettings,
  resolveGrantDurationDays,
} from "./platformSubscriptionSettings";
import { logInternalAdminAudit } from "./rescueSupportActions";
import {
  buildSubscriptionAuditPayload,
  type SubscriptionAuditPayload,
  type SubscriptionAuditSource,
} from "./subscriptionAuditPayload";
import {
  evaluateExpiryCandidates,
  evaluateGracePeriodCandidates,
  evaluateRenewalReminderCandidates,
  type AutomationRunSummary,
  type SubscriptionRowCandidate,
} from "./subscriptionAutomation";
import {
  emitGracePeriodNotice,
  emitRenewalReminder,
  emitSubscriptionExpired,
} from "./subscriptionNotifications";
import type { BillingCycle } from "./effectiveSubscription";
import type { PromotionalPlanCode } from "./growthCampaigns";
import type { RemoteSubscriptionRow, SubscriptionPlanCode, SubscriptionSnapshot } from "./subscriptionEntitlements";
import { maxDevicesHintForTier, normalizePlanCode } from "./subscriptionEntitlements";
import { supabase } from "./supabase";

function client() {
  if (!supabase) return null;
  return supabase;
}

export const SUBSCRIPTION_ENGINE_VERSION = "17.4";

export const ADMIN_PLAN_CODES = ["free", "starter", "business", "waka_plus"] as const;
export type AdminPlanCode = (typeof ADMIN_PLAN_CODES)[number];

export type SubscriptionEngineResult = {
  ok: boolean;
  message?: string;
  audit?: SubscriptionAuditPayload;
};

type RpcOutcome = { ok: boolean; message?: string };

type MutationContext = {
  action: string;
  shopId?: string | null;
  source: SubscriptionAuditSource;
  reason?: string | null;
  durationDays?: number | null;
  billingCycle?: BillingCycle | null;
  actorId?: string | null;
  /** When shop snapshot cannot be loaded (e.g. referral-only mutations). */
  before?: EffectiveSubscription | null;
};

// ---------------------------------------------------------------------------
// Extension points (Phase 17.4+ — not implemented)
// ---------------------------------------------------------------------------

/** Flutterwave / Stripe / MTN MoMo / Airtel Money webhooks call this after payment verification. */
export type PaymentSuccessInput = {
  shopId: string;
  planCode: SubscriptionPlanCode;
  amountUgx: number;
  provider: "flutterwave" | "stripe" | "mtn_momo" | "airtel_money" | "manual";
  externalReference: string;
  billingCycle?: BillingCycle;
  durationDays?: number;
};

/** Daily cron / edge function calls this to expire subscriptions and downgrade to free. */
export type ProcessExpiryInput = {
  /** When set, process only this organization (admin repair). */
  organizationId?: string;
};

/** Platform trial master switch reads settings then calls onSignup for new users. */
export type OnSignupInput = {
  referralCode?: string | null;
};

/** Payment failure webhook — Phase 17.4 stub. */
export type PaymentFailureInput = {
  shopId: string;
  provider: PaymentSuccessInput["provider"];
  externalReference: string;
  reason?: string;
};

/** Refund webhook — Phase 17.4 stub. */
export type RefundWebhookInput = {
  shopId: string;
  provider: PaymentSuccessInput["provider"];
  externalReference: string;
  amountUgx: number;
  reason?: string;
};

export const SUBSCRIPTION_ENGINE_EXTENSION_POINTS = {
  onPaymentSuccess: "subscriptionEngine.onPaymentSuccess",
  onPaymentFailure: "subscriptionEngine.onPaymentFailure",
  onRefund: "subscriptionEngine.onRefund",
  processExpiry: "subscriptionEngine.processExpiry",
  processGracePeriod: "subscriptionEngine.processGracePeriod",
  processRenewalReminder: "subscriptionEngine.processRenewalReminder",
  platformTrialSwitch: "get_platform_subscription_settings().automaticTrialEnabled",
} as const;

const PAYMENT_NOT_IMPLEMENTED =
  "Payment webhook integration not implemented — implement provider adapter in Payment Integration Phase.";

export async function onPaymentSuccess(_input: PaymentSuccessInput): Promise<SubscriptionEngineResult> {
  return { ok: false, message: PAYMENT_NOT_IMPLEMENTED };
}

export async function onPaymentFailure(_input: PaymentFailureInput): Promise<SubscriptionEngineResult> {
  return { ok: false, message: PAYMENT_NOT_IMPLEMENTED };
}

export async function onRefund(_input: RefundWebhookInput): Promise<SubscriptionEngineResult> {
  return { ok: false, message: PAYMENT_NOT_IMPLEMENTED };
}

async function fetchSubscriptionRowCandidates(organizationId?: string): Promise<SubscriptionRowCandidate[]> {
  const sb = client();
  if (!sb) return [];
  let query = sb
    .from("subscriptions")
    .select("id, organization_id, shop_id, status, trial_ends_at, current_period_end");
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => ({
    subscriptionId: row.id as string,
    shopId: (row.shop_id as string | null) ?? null,
    organizationId: row.organization_id as string,
    status: (row.status as string) ?? "",
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
    periodEndAt: (row.current_period_end as string | null) ?? null,
  }));
}

async function expireSubscriptionRow(
  candidate: SubscriptionRowCandidate,
  reason: string,
): Promise<SubscriptionEngineResult> {
  if (!candidate.shopId) {
    return { ok: false, message: "Missing shop id for expiry." };
  }
  return setSubscriptionStatus({
    subscriptionId: candidate.subscriptionId,
    shopId: candidate.shopId,
    status: "expired",
    reason,
    source: "system",
    action: "subscription.expire",
  });
}

async function markGracePeriod(
  candidate: SubscriptionRowCandidate,
  graceEndsAt: string,
): Promise<SubscriptionEngineResult> {
  if (!candidate.shopId) return { ok: false, message: "Missing shop id for grace period." };
  const st = (candidate.status ?? "").toLowerCase();
  if (st === "past_due") {
    emitGracePeriodNotice(candidate.shopId);
    return { ok: true, message: "Already in grace period." };
  }
  const result = await setSubscriptionStatus({
    subscriptionId: candidate.subscriptionId,
    shopId: candidate.shopId,
    status: "past_due",
    reason: `Grace period until ${graceEndsAt}`,
    source: "system",
    action: "subscription.grace_period",
  });
  if (result.ok) emitGracePeriodNotice(candidate.shopId);
  return result;
}

/** Expire subscriptions whose trial or period has ended (callable by future cron). */
export async function processExpiry(input: ProcessExpiryInput = {}): Promise<SubscriptionEngineResult & { summary?: AutomationRunSummary }> {
  const rows = await fetchSubscriptionRowCandidates(input.organizationId);
  const candidates = evaluateExpiryCandidates(rows);
  const summary: AutomationRunSummary = { expired: 0, graceMarked: 0, reminders: 0, errors: [] };

  for (const candidate of candidates) {
    const reason = candidate.reason === "trial_ended" ? "Trial ended" : "Subscription period ended";
    const result = await expireSubscriptionRow(candidate, reason);
    if (result.ok) {
      summary.expired += 1;
      if (candidate.shopId) emitSubscriptionExpired(candidate.shopId);
    } else if (result.message) {
      summary.errors.push(result.message);
    }
  }

  return {
    ok: summary.errors.length === 0,
    message: `Expired ${summary.expired} subscription(s).`,
    summary,
  };
}

/** Mark subscriptions in grace window as past_due (only when gracePeriodDays > 0). */
export async function processGracePeriod(input: ProcessExpiryInput = {}): Promise<SubscriptionEngineResult & { summary?: AutomationRunSummary }> {
  const { settings } = await fetchPlatformSubscriptionSettings();
  const rows = await fetchSubscriptionRowCandidates(input.organizationId);
  const candidates = evaluateGracePeriodCandidates(rows, settings);
  const summary: AutomationRunSummary = { expired: 0, graceMarked: 0, reminders: 0, errors: [] };

  for (const candidate of candidates) {
    const result = await markGracePeriod(candidate, candidate.graceEndsAt);
    if (result.ok) summary.graceMarked += 1;
    else if (result.message) summary.errors.push(result.message);
  }

  return {
    ok: summary.errors.length === 0,
    message: `Marked ${summary.graceMarked} subscription(s) in grace period.`,
    summary,
  };
}

/** Emit in-app renewal reminders for subscriptions matching reminder days. */
export async function processRenewalReminder(input: ProcessExpiryInput = {}): Promise<SubscriptionEngineResult & { summary?: AutomationRunSummary }> {
  const { settings } = await fetchPlatformSubscriptionSettings();
  const rows = await fetchSubscriptionRowCandidates(input.organizationId);
  const candidates = evaluateRenewalReminderCandidates(rows, settings);
  const summary: AutomationRunSummary = { expired: 0, graceMarked: 0, reminders: 0, errors: [] };

  for (const candidate of candidates) {
    emitRenewalReminder(candidate.shopId, candidate.daysRemaining, candidate.effective.effectivePlan);
    summary.reminders += 1;
  }

  return {
    ok: true,
    message: `Sent ${summary.reminders} renewal reminder(s).`,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Refresh pipeline (single entry)
// ---------------------------------------------------------------------------

/** Dispatches waka:internal-ops-changed + waka:subscription-updated for all listeners. */
export function notifySubscriptionMutationChanged(): void {
  notifyInternalOpsChanged();
}

// ---------------------------------------------------------------------------
// Snapshot helpers (for audit before/after)
// ---------------------------------------------------------------------------

async function fetchSubscriptionRowForOrganization(
  organizationId: string,
  shopId: string | null,
): Promise<RemoteSubscriptionRow | null> {
  const sb = client();
  if (!sb) return null;

  const { data: sub, error: subErr } = await sb
    .from("subscriptions")
    .select("id, organization_id, shop_id, status, trial_ends_at, current_period_start, current_period_end, plan_id, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subErr || !sub?.plan_id) return null;

  const { data: plan, error: pErr } = await sb
    .from("subscription_plans")
    .select("code, max_pos_users, max_shops, features")
    .eq("id", sub.plan_id)
    .maybeSingle();
  if (pErr || !plan?.code) return null;

  const features = plan.features as Record<string, unknown> | null;
  const devicesRaw = features?.devices;
  const tier = normalizePlanCode(plan.code);
  const maxDevicesFromFeatures =
    typeof devicesRaw === "number" && Number.isFinite(devicesRaw) && devicesRaw > 0
      ? Math.floor(devicesRaw)
      : null;

  return {
    id: sub.id,
    organization_id: sub.organization_id,
    shop_id: sub.shop_id ?? shopId,
    status: sub.status,
    trial_ends_at: sub.trial_ends_at ?? null,
    current_period_start: sub.current_period_start ?? null,
    current_period_end: sub.current_period_end ?? null,
    plan_code: plan.code,
    max_pos_users: plan.max_pos_users ?? null,
    max_shops: plan.max_shops ?? null,
    max_devices: maxDevicesFromFeatures ?? maxDevicesHintForTier(tier),
  };
}

export async function fetchSubscriptionSnapshotForShop(shopId: string): Promise<SubscriptionSnapshot> {
  const sb = client();
  if (!sb || !shopId) return { kind: "none" };

  const { data: shop, error } = await sb
    .from("shops")
    .select("organization_id")
    .eq("id", shopId)
    .maybeSingle();
  if (error || !shop?.organization_id) return { kind: "none" };

  const orgId = shop.organization_id as string;
  const [row, grant] = await Promise.all([
    fetchSubscriptionRowForOrganization(orgId, shopId),
    fetchActivePromotionalGrant(orgId),
  ]);
  if (row) return { kind: "remote", row, promotionalGrant: grant };
  return { kind: "none", promotionalGrant: grant };
}

export async function resolveEffectiveSubscriptionForShop(
  shopId: string,
): Promise<EffectiveSubscription | null> {
  const snapshot = await fetchSubscriptionSnapshotForShop(shopId);
  if (snapshot.kind === "none" && !snapshot.promotionalGrant) return null;
  return resolveEffectiveSubscription(snapshot);
}

async function resolveActorId(): Promise<string | null> {
  const sb = client();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

async function runMutation(
  ctx: MutationContext,
  rpc: () => Promise<RpcOutcome>,
): Promise<SubscriptionEngineResult> {
  const before =
    ctx.before ??
    (ctx.shopId ? await resolveEffectiveSubscriptionForShop(ctx.shopId) : null);

  const rpcResult = await rpc();
  const actorId = ctx.actorId ?? (await resolveActorId());

  let after: EffectiveSubscription | null = before;
  if (rpcResult.ok && ctx.shopId) {
    after = await resolveEffectiveSubscriptionForShop(ctx.shopId);
  }

  const audit = buildSubscriptionAuditPayload({
    action: ctx.action,
    before,
    after: rpcResult.ok ? after : before,
    reason: ctx.reason ?? null,
    source: ctx.source,
    actorId,
    durationDays: ctx.durationDays ?? null,
    billingCycle: ctx.billingCycle ?? null,
  });

  await logInternalAdminAudit({
    shopId: ctx.shopId ?? null,
    action: ctx.action,
    result: rpcResult.ok ? "ok" : "failed",
    reason: rpcResult.message ?? null,
    metadata: { subscriptionAudit: audit, engineVersion: SUBSCRIPTION_ENGINE_VERSION },
  });

  if (rpcResult.ok) notifySubscriptionMutationChanged();

  return { ok: rpcResult.ok, message: rpcResult.message, audit };
}

function parseRpcJson(data: unknown): RpcOutcome {
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok === true) return { ok: true };
  return { ok: false, message: j.error ?? "Request failed." };
}

// ---------------------------------------------------------------------------
// Subscription row mutations (admin_shop / admin_subscription RPCs)
// ---------------------------------------------------------------------------

export async function grant(input: {
  shopId: string;
  planCode: AdminPlanCode;
  days: number;
  reason?: string | null;
  source?: SubscriptionAuditSource;
  billingCycle?: BillingCycle | null;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const days = Math.max(1, Math.floor(input.days || 30));
  return runMutation(
    {
      action: "subscription.grant",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
      durationDays: days,
      billingCycle: input.billingCycle ?? (days >= 330 ? "yearly" : days >= 20 ? "monthly" : "custom"),
    },
    async () => {
      const { data, error } = await sb.rpc("admin_shop_set_subscription_plan", {
        p_shop_id: input.shopId,
        p_plan_code: input.planCode,
        p_days: days,
      });
      if (error) {
        const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
        return {
          ok: false,
          message: missingFn
            ? "Admin VIP function is missing on Supabase. Apply migration 043_repair_admin_shop_plan_rpc.sql, then reload the app."
            : error.message,
        };
      }
      return parseRpcJson(data);
    },
  );
}

/** Re-grant plan for a new period (same RPC as grant). */
export async function renew(input: {
  shopId: string;
  planCode: AdminPlanCode;
  days: number;
  reason?: string | null;
  source?: SubscriptionAuditSource;
  billingCycle?: BillingCycle | null;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const days = Math.max(1, Math.floor(input.days || 30));
  return runMutation(
    {
      action: "subscription.renew",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
      durationDays: days,
      billingCycle: input.billingCycle ?? (days >= 330 ? "yearly" : days >= 20 ? "monthly" : "custom"),
    },
    async () => {
      const { data, error } = await sb.rpc("admin_shop_set_subscription_plan", {
        p_shop_id: input.shopId,
        p_plan_code: input.planCode,
        p_days: days,
      });
      if (error) {
        const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
        return {
          ok: false,
          message: missingFn
            ? "Admin VIP function is missing on Supabase. Apply migration 043_repair_admin_shop_plan_rpc.sql, then reload the app."
            : error.message,
        };
      }
      return parseRpcJson(data);
    },
  );
}

export async function extend(input: {
  subscriptionId: string;
  shopId: string;
  extraDays: number;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const extraDays = Math.max(1, Math.floor(input.extraDays || 1));
  return runMutation(
    {
      action: "subscription.extend_trial",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
      durationDays: extraDays,
    },
    async () => {
      const { error } = await sb.rpc("admin_extend_subscription_trial", {
        p_subscription_id: input.subscriptionId,
        p_extra_days: extraDays,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
  );
}

export async function cancel(input: {
  subscriptionId: string;
  shopId: string;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  return setSubscriptionStatus({
    subscriptionId: input.subscriptionId,
    shopId: input.shopId,
    status: "cancelled",
    reason: input.reason,
    source: input.source,
    action: "subscription.cancel",
  });
}

export async function pause(input: {
  subscriptionId: string;
  shopId: string;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  return setSubscriptionStatus({
    subscriptionId: input.subscriptionId,
    shopId: input.shopId,
    status: "paused",
    reason: input.reason,
    source: input.source,
    action: "subscription.pause",
  });
}

export async function resume(input: {
  subscriptionId: string;
  shopId: string;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  return setSubscriptionStatus({
    subscriptionId: input.subscriptionId,
    shopId: input.shopId,
    status: "active",
    reason: input.reason,
    source: input.source,
    action: "subscription.resume",
  });
}

async function setSubscriptionStatus(input: {
  subscriptionId: string;
  shopId: string;
  status: "trial" | "trialing" | "active" | "expired" | "past_due" | "cancelled" | "paused";
  reason?: string | null;
  source?: SubscriptionAuditSource;
  action: string;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: input.action,
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
    },
    async () => {
      const { error } = await sb.rpc("admin_subscription_set_status", {
        p_subscription_id: input.subscriptionId,
        p_status: input.status,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
  );
}

export async function markPaid(input: {
  subscriptionId: string;
  shopId: string;
  amountUgx: number;
  note?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const amount = Math.max(0, Math.floor(input.amountUgx));
  return runMutation(
    {
      action: "subscription.mark_paid",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.note ?? null,
    },
    async () => {
      const { error } = await sb.rpc("admin_subscription_mark_payment", {
        p_subscription_id: input.subscriptionId,
        p_amount_ugx: amount,
        p_note: input.note ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Promotional grant mutations
// ---------------------------------------------------------------------------

export async function grantPromotionalAccess(input: {
  shopId: string;
  planCode: PromotionalPlanCode;
  days: number;
  reason: string;
  campaignId?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const days = Math.max(1, Math.floor(input.days || 30));
  return runMutation(
    {
      action: "subscription.grant_promotional",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason || null,
      durationDays: days,
    },
    async () => {
      const { data, error } = await sb.rpc("admin_grant_promotional_access", {
        p_shop_id: input.shopId,
        p_plan_code: input.planCode,
        p_days: days,
        p_reason: input.reason || null,
        p_campaign_id: input.campaignId ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

export async function extendPromotionalAccess(input: {
  grantId: string;
  shopId: string;
  extraDays: number;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const extraDays = Math.max(1, Math.floor(input.extraDays || 1));
  return runMutation(
    {
      action: "subscription.extend_promotional",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
      durationDays: extraDays,
    },
    async () => {
      const { data, error } = await sb.rpc("admin_extend_promotional_access", {
        p_grant_id: input.grantId,
        p_extra_days: extraDays,
        p_reason: input.reason ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

export async function revokePromotionalGrant(input: {
  grantId: string;
  shopId: string;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: "subscription.revoke_promotional",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
    },
    async () => {
      const { data, error } = await sb.rpc("admin_revoke_promotional_access", {
        p_grant_id: input.grantId,
        p_reason: input.reason ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

// ---------------------------------------------------------------------------
// Billing queue / trial requests / annual offers
// ---------------------------------------------------------------------------

export async function approveTrialRequest(input: {
  requestId: string;
  shopId?: string | null;
  note?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: "subscription.approve_trial_request",
      shopId: input.shopId ?? null,
      source: input.source ?? "admin",
      reason: input.note ?? null,
    },
    async () => {
      const { data, error } = await sb.rpc("internal_ops_subscription_request_set_status", {
        p_request_id: input.requestId,
        p_status: "approved",
        p_note: input.note ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

export async function rejectTrialRequest(input: {
  requestId: string;
  shopId?: string | null;
  note?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: "subscription.reject_trial_request",
      shopId: input.shopId ?? null,
      source: input.source ?? "admin",
      reason: input.note ?? null,
    },
    async () => {
      const { data, error } = await sb.rpc("internal_ops_subscription_request_set_status", {
        p_request_id: input.requestId,
        p_status: "rejected",
        p_note: input.note ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

export async function fulfillAnnualOffer(input: {
  offerId: string;
  shopId?: string | null;
  note?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: "subscription.fulfill_annual_offer",
      shopId: input.shopId ?? null,
      source: input.source ?? "admin",
      reason: input.note ?? null,
      durationDays: 365,
      billingCycle: "yearly",
    },
    async () => {
      const { data, error } = await sb.rpc("internal_ops_org_billing_offer_fulfill", {
        p_offer_id: input.offerId,
        p_note: input.note ?? null,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

// ---------------------------------------------------------------------------
// Marketing agent / signup hooks
// ---------------------------------------------------------------------------

export async function agentGrantPlan(input: {
  referralId: string;
  planCode: "starter" | "business" | "waka_plus";
  days?: number;
  shopId?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  const days = Math.max(1, Math.floor(input.days ?? 30));
  return runMutation(
    {
      action: "subscription.agent_grant",
      shopId: input.shopId ?? null,
      source: input.source ?? "agent",
      durationDays: days,
    },
    async () => {
      const { data, error } = await sb.rpc("marketing_agent_upgrade_referral_plan", {
        p_referral_id: input.referralId,
        p_plan_code: input.planCode,
        p_days: days,
      });
      if (error) return { ok: false, message: error.message };
      const row = (data ?? {}) as { ok?: boolean; error?: string };
      if (!row.ok) return { ok: false, message: row.error ?? "unknown" };
      return { ok: true };
    },
  );
}

/** Post-signup growth campaign / referral promotional grant (idempotent). */
export async function onSignup(input: OnSignupInput = {}): Promise<{
  granted: boolean;
  planCode?: string;
  result?: SubscriptionEngineResult;
}> {
  if (!supabase) return { granted: false };
  const sb = supabase;
  try {
    const { data, error } = await sb.rpc("apply_growth_campaign_grant", {
      p_referral_code: input.referralCode ?? null,
    });
    if (error || !data) return { granted: false };
    const obj = data as Record<string, unknown>;
    if (obj.granted !== true) return { granted: false };

    const audit = buildSubscriptionAuditPayload({
      action: "subscription.on_signup_grant",
      before: null,
      after: null,
      reason: "growth_campaign_auto",
      source: "system",
      actorId: null,
      durationDays: null,
    });

    await logInternalAdminAudit({
      action: "subscription.on_signup_grant",
      result: "ok",
      metadata: {
        subscriptionAudit: audit,
        planCode: obj.plan_code,
        engineVersion: SUBSCRIPTION_ENGINE_VERSION,
      },
    });

    notifySubscriptionMutationChanged();

    return {
      granted: true,
      planCode: typeof obj.plan_code === "string" ? obj.plan_code : undefined,
    };
  } catch {
    return { granted: false };
  }
}

/** Grant trial using platform default trial plan and duration. */
export async function grantTrial(input: {
  shopId: string;
  planCode?: AdminPlanCode;
  days?: number;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  const { settings } = await fetchPlatformSubscriptionSettings();
  const planCode = input.planCode ?? settings.defaultTrialPlan;
  const days =
    input.days ??
    resolveGrantDurationDays(settings, "trial");
  return grant({
    shopId: input.shopId,
    planCode,
    days,
    reason: input.reason,
    source: input.source,
    billingCycle: "custom",
  });
}

/** Reset shop subscription to free tier. */
export async function resetToFree(input: {
  shopId: string;
  reason?: string | null;
  source?: SubscriptionAuditSource;
}): Promise<SubscriptionEngineResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const sb = supabase;
  return runMutation(
    {
      action: "subscription.reset_to_free",
      shopId: input.shopId,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
    },
    async () => {
      const { data, error } = await sb.rpc("admin_shop_set_subscription_plan", {
        p_shop_id: input.shopId,
        p_plan_code: "free",
        p_days: 1,
      });
      if (error) return { ok: false, message: error.message };
      return parseRpcJson(data);
    },
  );
}

/** Canonical engine export for Phase 16.5+. */
export const subscriptionEngine = {
  grant,
  extend,
  renew,
  cancel,
  pause,
  resume,
  markPaid,
  grantPromotionalAccess,
  extendPromotionalAccess,
  revokePromotionalGrant,
  approveTrialRequest,
  rejectTrialRequest,
  fulfillAnnualOffer,
  agentGrantPlan,
  onSignup,
  grantTrial,
  resetToFree,
  onPaymentSuccess,
  onPaymentFailure,
  onRefund,
  processExpiry,
  processGracePeriod,
  processRenewalReminder,
  notifySubscriptionMutationChanged,
  resolveEffectiveSubscriptionForShop,
  fetchSubscriptionSnapshotForShop,
};
