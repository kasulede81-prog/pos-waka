/**
 * M3-D — customer checkout orchestration (pure logic + thin backend).
 *
 * The backend is authoritative everywhere:
 *   quote  → subscription_payment_quote        (server price, campaign, currency)
 *   intent → subscription_payment_create       (server prices again; client amount only checked)
 *   start  → payment-initiate Edge Function    (provider_not_configured until PesaPal/M3-F)
 *   status → subscription_payment_get          (single payment)
 *   recover→ my_subscription_payments          (shop-scoped history, newest first)
 *
 * Nothing here computes an authoritative price; `amountUgx` in createIntent is
 * the SERVER-quoted value (a tamper/drift check, never a client calculation).
 *
 * CHECKOUT_PROVIDER_ID is only a provider label stored on the intent.
 * MTN MoMo (sandbox adapter) is the current checkout provider; payment-initiate
 * resolves that label against the server-side provider registry.
 *
 * Testable by design: the reducer, classifiers, recovery selector, poller and
 * projection helpers are pure/injectable; the UI never talks to supabase
 * directly for checkout.
 */

import { supabase, hasSupabaseConfig } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckoutPlanCode = "starter" | "business" | "waka_plus";
export type CheckoutCycle = "monthly" | "yearly";

export const CHECKOUT_PLANS: CheckoutPlanCode[] = ["starter", "business", "waka_plus"];

/** Current checkout provider label — resolved server-side against the provider registry (MTN MoMo sandbox adapter). */
export const CHECKOUT_PROVIDER_ID = "mtn_momo";

export type RpcLike = { ok?: boolean; error?: string } & Record<string, unknown>;

export type CheckoutQuote = {
  planCode: CheckoutPlanCode;
  cycle: CheckoutCycle;
  amountUgx: number;
  campaignId: string | null;
  quotedAt: string;
  isCurrent: boolean;
  currentPlanCode: string;
};

export type CheckoutIntent = {
  paymentId: string;
  reference: string;
  phone: string;
  planCode: CheckoutPlanCode;
  cycle: CheckoutCycle;
  amountUgx: number;
};

export type CheckoutPhase =
  | "idle"
  | "selecting"
  | "quoting"
  | "creating_payment"
  | "pending_provider"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "reconciliation_required"
  | "provider_not_configured";

export type CheckoutState = {
  phase: CheckoutPhase;
  planCode: CheckoutPlanCode | null;
  cycle: CheckoutCycle;
  quote: CheckoutQuote | null;
  quoteLoading: boolean;
  quoteErrorKey: string | null;
  downgradeConfirmed: boolean;
  intent: CheckoutIntent | null;
  initiated: boolean;
  initiateErrorKey: string | null;
  /** What the pending screen should offer next after an initiate outcome. */
  initiateAction: "retry" | "poll" | null;
  paymentStatus: string | null;
  statusReason: string | null;
  errorKey: string | null;
  /**
   * A failed user-initiated cancellation. Kept separate from `errorKey` so it
   * surfaces on the pending screen WITHOUT changing the phase: a cancellation
   * that did not happen must leave the payment looking exactly as pending as it
   * still is, and must never be mistaken for one that succeeded.
   */
  cancelErrorKey: string | null;
  pollAttempts: number;
  consecutivePollErrors: number;
};

export type CheckoutEvent =
  | { type: "RESET" }
  | { type: "SELECT_PLAN"; plan: CheckoutPlanCode }
  | { type: "SELECT_CYCLE"; cycle: CheckoutCycle }
  | { type: "QUOTE_STARTED" }
  | { type: "QUOTE_OK"; quote: CheckoutQuote }
  | { type: "QUOTE_FAILED"; errorKey: string }
  | { type: "DOWNGRADE_CONFIRMED" }
  | { type: "PAY_REQUESTED"; reference: string; phone: string }
  | { type: "INTENT_CREATED"; paymentId: string; amountUgx: number }
  | { type: "INTENT_CREATE_FAILED"; errorKey: string; retrySameReference: boolean }
  | { type: "REQUOTE_REQUIRED"; errorKey: string }
  | { type: "CHECKOUT_ABORTED"; errorKey: string }
  | { type: "INITIATE_SUCCEEDED" }
  | { type: "INITIATE_NOT_CONFIGURED" }
  | { type: "INITIATE_TIMEOUT"; errorKey: string }
  | { type: "INITIATE_RETRYABLE"; errorKey: string }
  | { type: "INITIATE_REJECTED"; errorKey: string }
  | { type: "INITIATE_ATTACH_FAILED"; errorKey: string }
  | { type: "INPUT_ERROR"; errorKey: string }
  | { type: "FATAL"; errorKey: string }
  | { type: "SYNC_REQUIRED"; errorKey: string }
  | {
      type: "RESUMED";
      paymentId: string;
      reference: string | null;
      amountUgx: number;
      planCode: CheckoutPlanCode | null;
      cycle: CheckoutCycle;
    }
  | { type: "POLL_RECEIVED"; status: string; statusReason: string | null }
  | { type: "POLL_ERROR" }
  | { type: "POLL_ERRORS_RESET" }
  /**
   * The payer answered the cancellation confirmation with "Cancel payment" and
   * the server refused. Deliberately carries no status: nothing about the
   * payment changed, so nothing about the pending screen may change either.
   */
  | { type: "CANCEL_FAILED"; errorKey: string }
  | { type: "SHOP_CHANGED" };

export function initialCheckoutState(cycle: CheckoutCycle = "monthly"): CheckoutState {
  return {
    phase: "idle",
    planCode: null,
    cycle,
    quote: null,
    quoteLoading: false,
    quoteErrorKey: null,
    downgradeConfirmed: false,
    intent: null,
    initiated: false,
    initiateErrorKey: null,
    initiateAction: null,
    paymentStatus: null,
    statusReason: null,
    errorKey: null,
    cancelErrorKey: null,
    pollAttempts: 0,
    consecutivePollErrors: 0,
  };
}

const TERMINAL_STATUSES = new Set(["confirmed", "failed", "cancelled", "refunded"]);

export function isTerminalStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

/** A cancelled payment whose reason is a server reconciliation marker. */
export function isReconciliation(status: string | null, statusReason: string | null): boolean {
  if (status !== "cancelled") return false;
  return statusReason === "stale_replaced" || statusReason === "stale_success";
}

/**
 * Offer a provider (re)initiate only when the provider state is unknown —
 * timeout / retryable transport errors. An attach failure ("poll") must NEVER
 * re-initiate: the provider may already have accepted the payment.
 */
export function needsInitiateAction(state: CheckoutState): boolean {
  return state.phase === "pending_provider" && state.initiated === false && state.initiateAction === "retry";
}

/** Attach failed / unknown: provider may hold the payment → poll, don't re-push. */
export function needsStatusCheck(state: CheckoutState): boolean {
  return state.phase === "pending_provider" && state.initiated === false && state.initiateAction === "poll";
}

// ---------------------------------------------------------------------------
// Pure plan helpers
// ---------------------------------------------------------------------------

const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, business: 2, waka_plus: 3 };

export function planRank(plan: string): number {
  return PLAN_RANK[plan] ?? 99;
}

/** Free is visible but is never a payment checkout option. */
export function canPayForPlan(plan: string): boolean {
  return plan === "starter" || plan === "business" || plan === "waka_plus";
}

export function isDowngradePlan(currentPlan: string | null | undefined, nextPlan: string): boolean {
  if (!currentPlan || !canPayForPlan(nextPlan)) return false;
  if (!canPayForPlan(currentPlan)) return false; // free → paid is an upgrade, not a downgrade
  return planRank(nextPlan) < planRank(currentPlan);
}

/** i18n key for the primary action button. */
export function checkoutActionKey(quote: CheckoutQuote | null): string {
  if (quote?.isCurrent) return "checkoutRenew";
  if (quote && isDowngradePlan(quote.currentPlanCode, quote.planCode)) return "checkoutDowngrade";
  return "checkoutUpgrade";
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value.trim());
}

/** One reference per payment attempt; reuse on retry (M3-A idempotency). */
export function newAttemptReference(): string {
  return crypto.randomUUID();
}

/** Server price is the only price; this only derives display-only deltas. */
export function displayPricingFor(
  quote: CheckoutQuote,
  publicRow: { originalMonthlyUgx: number; finalMonthlyUgx: number } | null | undefined,
): { finalUgx: number; originalUgx: number; discountUgx: number } {
  const original = quote.cycle === "monthly" ? publicRow?.originalMonthlyUgx : undefined;
  const finalUgx = quote.amountUgx;
  const originalUgx = typeof original === "number" && original >= finalUgx ? original : finalUgx;
  return { finalUgx, originalUgx, discountUgx: originalUgx - finalUgx };
}

/** Renewal/trial anchoring copy (backend semantics are unchanged). */
export function renewalNoteKey(input: {
  effectiveStatus: string;
  hasFuturePeriodEnd: boolean;
}): string | null {
  if (input.effectiveStatus === "expired") return "checkoutExpiredNote";
  const trialLike = input.effectiveStatus === "trial" || input.effectiveStatus === "trialing";
  if (trialLike || input.hasFuturePeriodEnd) return "checkoutPeriodAnchored";
  return "checkoutPeriodFromNow";
}

export function paymentStatusKey(status: string): string {
  switch (status) {
    case "pending":
      return "checkoutStatusPending";
    case "confirmed":
      return "checkoutStatusConfirmed";
    case "failed":
      return "checkoutStatusFailed";
    case "cancelled":
      return "checkoutStatusCancelled";
    case "refunded":
      return "checkoutStatusRefunded";
    default:
      return "checkoutStatusPending";
  }
}

// ---------------------------------------------------------------------------
// Error classification (deterministic, backend vocabulary only)
// ---------------------------------------------------------------------------

export type ClassifiedError = {
  errorKey: string;
  kind: "requote" | "fatal" | "preparing" | "retryable" | "field" | "sync";
};

export function classifyCheckoutError(error: string | undefined | null): ClassifiedError {
  switch (error) {
    case "provider_not_configured":
      return { errorKey: "checkoutPreparingTitle", kind: "preparing" };
    case "amount_mismatch":
      return { errorKey: "checkoutPriceUpdated", kind: "requote" };
    case "shop_subscription_mismatch":
    case "shop_not_found":
      return { errorKey: "checkoutShopChanged", kind: "requote" };
    case "invalid_phone":
      return { errorKey: "checkoutPhoneInvalid", kind: "field" };
    case "payment_not_pending":
    case "subscription_not_found":
      return { errorKey: "checkoutSyncRequired", kind: "sync" };
    case "initiate_timeout":
    case "provider_unavailable":
    case "attach_failed":
      return { errorKey: "checkoutNetworkError", kind: "retryable" };
    case "provider_rejected":
      return { errorKey: "checkoutFailedTitle", kind: "fatal" };
    case "subscription_conflict":
      return { errorKey: "checkoutSyncRequired", kind: "sync" };
    case "plan_not_available":
    case "invalid_billing_interval":
    case "forbidden":
    case "payment_not_found":
    case "reference_missing":
    case "invalid_provider":
    case "offline":
    case "unauthorized":
      return { errorKey: "checkoutUnavailable", kind: "fatal" };
    default:
      return { errorKey: "checkoutUnavailable", kind: "fatal" };
  }
}

/** Maps an initiate() outcome (HTTP body from payment-initiate) to an event. */
export function classifyInitiateResult(result: {
  ok?: boolean;
  error?: string;
  retryable?: boolean;
}): CheckoutEvent {
  if (result.ok === true) return { type: "INITIATE_SUCCEEDED" };
  const error = result.error ?? "";
  switch (error) {
    case "provider_not_configured":
      return { type: "INITIATE_NOT_CONFIGURED" };
    case "initiate_timeout":
      return { type: "INITIATE_TIMEOUT", errorKey: "checkoutNetworkError" };
    case "attach_failed":
      return { type: "INITIATE_ATTACH_FAILED", errorKey: "checkoutNetworkError" };
    case "provider_rejected":
      return { type: "INITIATE_REJECTED", errorKey: "checkoutFailedTitle" };
    case "invalid_phone":
      return { type: "INPUT_ERROR", errorKey: "checkoutPhoneInvalid" };
    case "payment_not_pending":
    case "payment_not_found":
      return { type: "SYNC_REQUIRED", errorKey: "checkoutSyncRequired" };
    default:
      if (result.retryable === true) {
        return { type: "INITIATE_RETRYABLE", errorKey: "checkoutNetworkError" };
      }
      return { type: "FATAL", errorKey: classifyCheckoutError(error).errorKey };
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case "RESET":
      return initialCheckoutState(state.cycle);
    case "SHOP_CHANGED":
      // Shop context changed mid-checkout: abandon (server keeps the old
      // intent pinned to its original shop — never rebind).
      return { ...initialCheckoutState(state.cycle), errorKey: "checkoutShopChanged" };
    case "SELECT_PLAN":
      if (state.planCode === event.plan) return state;
      return {
        ...state,
        planCode: event.plan,
        quote: null,
        quoteErrorKey: null,
        downgradeConfirmed: false,
        intent: null,
        initiated: false,
        initiateErrorKey: null,
        errorKey: null,
        paymentStatus: null,
        statusReason: null,
        phase: "selecting",
      };
    case "SELECT_CYCLE":
      if (state.cycle === event.cycle) return state;
      return {
        ...state,
        cycle: event.cycle,
        quote: null,
        quoteErrorKey: null,
        intent: null,
        initiated: false,
        initiateErrorKey: null,
        errorKey: null,
        paymentStatus: null,
        statusReason: null,
        phase: state.phase === "idle" ? "idle" : "selecting",
      };
    case "QUOTE_STARTED":
      if (!state.planCode) return state;
      return { ...state, phase: "quoting", quoteLoading: true, quoteErrorKey: null };
    case "QUOTE_OK":
      // Ignore a stale quote for a plan/cycle the user has since changed.
      if (state.phase !== "quoting" && state.phase !== "selecting") return state;
      if (event.quote.planCode !== state.planCode || event.quote.cycle !== state.cycle) return state;
      return {
        ...state,
        phase: "selecting",
        quoteLoading: false,
        quote: event.quote,
        quoteErrorKey: null,
        errorKey: null,
      };
    case "QUOTE_FAILED":
      return { ...state, phase: "selecting", quoteLoading: false, quoteErrorKey: event.errorKey };
    case "DOWNGRADE_CONFIRMED":
      return { ...state, downgradeConfirmed: true };
    case "PAY_REQUESTED": {
      if (state.phase !== "selecting" && state.phase !== "creating_payment") return state;
      if (!state.planCode || !state.quote) {
        return { ...state, errorKey: "checkoutSelectPlanFirst" };
      }
      if (!canPayForPlan(state.planCode)) return state; // Free never pays
      // A 100% admin discount prices the plan at zero. There is no payment to
      // make, and this must be caught HERE: the server accepts a 0 amount, so
      // pressing on creates a pending payment row, sends it to the provider,
      // and the provider rejects it — consuming the intent and marking it
      // failed without ever activating the subscription.
      if (state.quote.amountUgx <= 0) {
        return { ...state, errorKey: "checkoutFullyDiscounted" };
      }
      if (isDowngradePlan(state.quote.currentPlanCode, state.planCode) && !state.downgradeConfirmed) {
        return { ...state, errorKey: "checkoutDowngradeConfirm" };
      }
      return {
        ...state,
        phase: "creating_payment",
        errorKey: null,
        initiateErrorKey: null,
        initiated: false,
        paymentStatus: "pending",
        statusReason: null,
        intent: {
          paymentId: state.intent?.paymentId ?? "",
          // One reference per attempt: an existing attempt's reference always
          // wins over any newly supplied value (M3-A idempotency).
          reference: state.intent?.reference || event.reference || newAttemptReference(),
          phone: event.phone,
          planCode: state.planCode,
          cycle: state.cycle,
          amountUgx: state.quote.amountUgx,
        },
      };
    }
    case "INTENT_CREATED":
      if (state.phase !== "creating_payment" || !state.intent) return state;
      return {
        ...state,
        intent: { ...state.intent, paymentId: event.paymentId, amountUgx: event.amountUgx },
        errorKey: null,
      };
    case "INTENT_CREATE_FAILED":
      if (state.phase !== "creating_payment") return state;
      // retrySameReference keeps us in creating_payment with the SAME intent
      // (M3-A idempotency); otherwise fall back to plan selection.
      if (event.retrySameReference) {
        return { ...state, errorKey: event.errorKey };
      }
      return {
        ...state,
        phase: "selecting",
        intent: null,
        errorKey: event.errorKey,
      };
    case "REQUOTE_REQUIRED":
      return {
        ...state,
        phase: "selecting",
        intent: null,
        quote: null,
        quoteLoading: false,
        errorKey: event.errorKey,
      };
    case "CHECKOUT_ABORTED":
      return {
        ...state,
        phase: "selecting",
        intent: null,
        initiated: false,
        errorKey: event.errorKey,
      };
    case "INITIATE_SUCCEEDED":
      if (state.phase !== "creating_payment") return state;
      return {
        ...state,
        phase: "pending_provider",
        initiated: true,
        initiateErrorKey: null,
        initiateAction: null,
        errorKey: null,
      };
    case "INITIATE_NOT_CONFIGURED":
      if (state.phase !== "creating_payment" && state.phase !== "pending_provider") return state;
      return {
        ...state,
        phase: "provider_not_configured",
        initiated: false,
        initiateErrorKey: null,
        initiateAction: null,
      };
    case "INITIATE_TIMEOUT":
    case "INITIATE_RETRYABLE":
      if (state.phase !== "creating_payment" && state.phase !== "pending_provider") return state;
      // Provider state unknown → the intent stays pending; retry reuses it.
      return {
        ...state,
        phase: "pending_provider",
        initiated: false,
        initiateErrorKey: event.errorKey,
        initiateAction: "retry",
      };
    case "INITIATE_ATTACH_FAILED":
      if (state.phase !== "creating_payment" && state.phase !== "pending_provider") return state;
      // Provider may have accepted: never auto-retry the provider call; poll status.
      return {
        ...state,
        phase: "pending_provider",
        initiated: false,
        initiateErrorKey: event.errorKey,
        initiateAction: "poll",
      };
    case "INITIATE_REJECTED":
      if (state.phase !== "creating_payment" && state.phase !== "pending_provider") return state;
      return {
        ...state,
        phase: "failed",
        initiated: false,
        paymentStatus: "failed",
        statusReason: "provider_error",
        errorKey: event.errorKey,
      };
    case "INPUT_ERROR":
      return { ...state, errorKey: event.errorKey };
    case "FATAL":
      return { ...state, phase: "selecting", intent: null, initiated: false, errorKey: event.errorKey };
    case "SYNC_REQUIRED":
      return { ...state, errorKey: event.errorKey };
    case "RESUMED":
      // Never clobber a locally in-flight intent creation.
      if (state.phase === "creating_payment") return state;
      // Recovery: server history is authoritative; adopt the newest pending
      // intent without touching the parent's plan selection lifecycle.
      return {
        ...state,
        phase: "pending_provider",
        planCode: event.planCode ?? state.planCode,
        cycle: event.cycle,
        quote: state.quote,
        intent: {
          paymentId: event.paymentId,
          reference: event.reference ?? state.intent?.reference ?? newAttemptReference(),
          phone: state.intent?.phone ?? "",
          planCode: event.planCode ?? state.planCode ?? "business",
          cycle: event.cycle,
          amountUgx: event.amountUgx,
        },
        initiated: false,
        initiateAction: null,
        paymentStatus: "pending",
        statusReason: null,
        errorKey: null,
        quoteErrorKey: null,
      };
    case "POLL_RECEIVED": {
      if (state.phase !== "pending_provider") return state;
      const status = event.status;
      // Any authoritative status from the server supersedes a stale local
      // cancellation error — including another `pending`, which is the server
      // saying the payment is still live and the "we couldn't cancel" note is
      // no longer the latest word.
      const live = { ...state, cancelErrorKey: null };
      if (status === "pending" || !isTerminalStatus(status)) {
        return { ...live, paymentStatus: status, statusReason: event.statusReason, pollAttempts: state.pollAttempts + 1, consecutivePollErrors: 0 };
      }
      if (status === "confirmed") {
        return { ...live, phase: "confirmed", paymentStatus: "confirmed", statusReason: event.statusReason };
      }
      if (status === "failed") {
        return { ...live, phase: "failed", paymentStatus: "failed", statusReason: event.statusReason };
      }
      if (status === "refunded") {
        return { ...live, phase: "cancelled", paymentStatus: "refunded", statusReason: event.statusReason };
      }
      // cancelled
      if (isReconciliation(status, event.statusReason)) {
        return { ...live, phase: "reconciliation_required", paymentStatus: status, statusReason: event.statusReason };
      }
      return { ...live, phase: "cancelled", paymentStatus: "cancelled", statusReason: event.statusReason };
    }
    case "CANCEL_FAILED":
      if (state.phase !== "pending_provider") return state;
      // Stay pending. The payment is exactly as unresolved as it was — only the
      // reason we could not end it is new.
      return { ...state, cancelErrorKey: event.errorKey };
    case "POLL_ERROR":
      if (state.phase !== "pending_provider") return state;
      return { ...state, consecutivePollErrors: state.consecutivePollErrors + 1 };
    case "POLL_ERRORS_RESET":
      if (state.phase !== "pending_provider") return state;
      return { ...state, consecutivePollErrors: 0 };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Backend interface + real implementation
// ---------------------------------------------------------------------------

export type CheckoutBackend = {
  quote(i: { shopId: string; planCode: string; cycle: CheckoutCycle }): Promise<RpcLike>;
  createIntent(i: {
    shopId: string;
    reference: string;
    planCode: string;
    cycle: CheckoutCycle;
    amountUgx: number;
  }): Promise<RpcLike>;
  initiate(i: { paymentId: string; phone: string }): Promise<RpcLike>;
  /**
   * ASK THE PROVIDER. This is `payment-status`, not the ledger read below: it
   * authorizes the caller, queries MTN for the transaction, and settles through
   * the existing confirm/fail/cancel RPCs. The browser never learns a provider
   * credential or endpoint — only the payment id goes out.
   */
  checkStatus(paymentId: string): Promise<RpcLike>;
  /** Ledger read only (`subscription_payment_get`). Never contacts the provider. */
  getPayment(paymentId: string): Promise<RpcLike>;
  listPayments(shopId: string): Promise<RpcLike>;
  /**
   * Server-authoritative cancellation of a pending payment. The RPC decides
   * whether it is still cancellable (only `pending` is), so a payment the
   * provider has already settled cannot be cancelled from here.
   */
  cancel(paymentId: string): Promise<RpcLike>;
};

/**
 * Reason recorded on the ledger when the payer abandons a pending checkout.
 *
 * Deliberately NOT one of the reconciliation markers (`stale_replaced` /
 * `stale_success`): this is the payer's own decision, not the server flagging a
 * payment for review, and it must not send them to the "under review" screen.
 */
export const CHECKOUT_CANCEL_REASON = "customer_abandoned_checkout";

function cycleToRpc(cycle: CheckoutCycle): string {
  return cycle === "yearly" ? "yearly" : "monthly";
}

export function createCheckoutBackend(): CheckoutBackend {
  return {
    async quote(i) {
      if (!supabase) return { ok: false, error: "offline" };
      const { data, error } = await supabase.rpc("subscription_payment_quote", {
        p_shop_id: i.shopId,
        p_plan_code: i.planCode,
        p_billing_cycle: cycleToRpc(i.cycle),
      });
      if (error) return { ok: false, error: "offline" };
      return (data ?? {}) as RpcLike;
    },
    async createIntent(i) {
      if (!supabase) return { ok: false, error: "offline" };
      const { data, error } = await supabase.rpc("subscription_payment_create", {
        p_shop_id: i.shopId,
        p_provider: CHECKOUT_PROVIDER_ID,
        p_reference: i.reference,
        p_amount_ugx: i.amountUgx, // server-quoted value; the server re-checks it
        p_note: null,
        p_payment_id: null,
        p_subscription_id: null,
        p_plan_code: i.planCode,
        p_billing_cycle: cycleToRpc(i.cycle),
      });
      if (error) return { ok: false, error: "offline" };
      return (data ?? {}) as RpcLike;
    },
    async cancel(paymentId) {
      if (!supabase) return { ok: false, error: "offline" };
      // No direct table write: the RPC owns the transition, its eligibility
      // check and its audit/history rows. A refusal comes back as ok:false and
      // is surfaced as a failure — never as a cancellation.
      const { data, error } = await supabase.rpc("subscription_payment_cancel", {
        p_payment_id: paymentId,
        p_reason: CHECKOUT_CANCEL_REASON,
      });
      if (error) return { ok: false, error: "offline" };
      return (data ?? {}) as RpcLike;
    },
    async initiate(i) {
      if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
      const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
      const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!base || !anon || !token) return { ok: false, error: "unauthorized" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`${base}/functions/v1/payment-initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anon,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ payment_id: i.paymentId, phone: i.phone }),
          signal: controller.signal,
        });
        const text = await res.text();
        if (!text) return { ok: false, error: "initiate_timeout", retryable: true };
        try {
          return JSON.parse(text) as RpcLike;
        } catch {
          return { ok: false, error: "initiate_timeout", retryable: true };
        }
      } catch {
        return { ok: false, error: "initiate_timeout", retryable: true };
      } finally {
        clearTimeout(timer);
      }
    },
    async checkStatus(paymentId) {
      if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
      const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
      const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      // No session, no provider query: payment-status authorizes the caller with
      // this JWT, so sending nothing would only earn a 401.
      if (!base || !anon || !token) return { ok: false, error: "unauthorized" };

      const controller = new AbortController();
      // Above the server's own 12s provider budget, so a slow MTN leg surfaces
      // as the server's `provider_query_timeout` rather than as our abort.
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`${base}/functions/v1/payment-status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anon,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ payment_id: paymentId }),
          signal: controller.signal,
        });
        const text = await res.text();
        if (!text) return { ok: false, error: "provider_query_timeout", retryable: true };
        try {
          return JSON.parse(text) as RpcLike;
        } catch {
          return { ok: false, error: "provider_query_failed", retryable: true };
        }
      } catch {
        // Transport failure — NEVER a payment failure. The ledger is untouched
        // and the row stays pending; the caller may simply try again.
        return { ok: false, error: "provider_query_failed", retryable: true };
      } finally {
        clearTimeout(timer);
      }
    },
    async getPayment(paymentId) {
      if (!supabase) return { ok: false, error: "offline" };
      const { data, error } = await supabase.rpc("subscription_payment_get", { p_payment_id: paymentId });
      if (error) return { ok: false, error: "offline" };
      return (data ?? {}) as RpcLike;
    },
    async listPayments(shopId) {
      if (!supabase) return { ok: false, error: "offline" };
      const { data, error } = await supabase.rpc("my_subscription_payments", {
        p_shop_id: shopId,
        p_limit: 10,
        p_before: null,
      });
      if (error) return { ok: false, error: "offline" };
      return (data ?? {}) as RpcLike;
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration helpers (used by the component, unit-testable with any backend)
// ---------------------------------------------------------------------------

function quoteFromRpc(rpc: RpcLike, planCode: CheckoutPlanCode, cycle: CheckoutCycle): CheckoutQuote | null {
  if (rpc.ok !== true || typeof rpc.amount_ugx !== "number") return null;
  return {
    planCode: String(rpc.plan_code ?? planCode) as CheckoutPlanCode,
    // Server interval wins; the requested cycle is only a fallback.
    cycle: (
      rpc.billing_interval === "year"
        ? "yearly"
        : rpc.billing_interval === "month"
          ? "monthly"
          : cycle
    ) as CheckoutCycle,
    amountUgx: Number(rpc.amount_ugx),
    campaignId: typeof rpc.campaign_id === "string" ? rpc.campaign_id : null,
    quotedAt: String(rpc.quoted_at ?? ""),
    isCurrent: rpc.is_current === true,
    currentPlanCode: String(rpc.current_plan_code ?? planCode),
  };
}

export async function quoteCheckout(
  backend: CheckoutBackend,
  i: { shopId: string; planCode: CheckoutPlanCode; cycle: CheckoutCycle },
): Promise<{ ok: true; quote: CheckoutQuote } | { ok: false; errorKey: string; requote: boolean }> {
  try {
    const rpc = await backend.quote(i);
    if (rpc.ok !== true) {
      const c = classifyCheckoutError(typeof rpc.error === "string" ? rpc.error : undefined);
      return { ok: false, errorKey: c.errorKey, requote: c.kind === "requote" };
    }
    const quote = quoteFromRpc(rpc, i.planCode, i.cycle);
    if (!quote) return { ok: false, errorKey: "checkoutUnavailable", requote: false };
    return { ok: true, quote };
  } catch {
    return { ok: false, errorKey: "checkoutUnavailable", requote: false };
  }
}

export async function createCheckoutIntent(
  backend: CheckoutBackend,
  i: {
    shopId: string;
    reference: string;
    planCode: CheckoutPlanCode;
    cycle: CheckoutCycle;
    amountUgx: number;
  },
): Promise<
  | { ok: true; paymentId: string; amountUgx: number; idempotent: boolean }
  | { ok: false; errorKey: string; requote: boolean; retrySameReference: boolean }
> {
  // Defence in depth for any caller: a fully-discounted plan has no provider
  // payment to create. `subscription_payment_create` would happily write a
  // pending row with amount_ugx = 0, which the provider then rejects — so
  // never ask for one.
  if (!Number.isFinite(i.amountUgx) || i.amountUgx <= 0) {
    return { ok: false, errorKey: "checkoutFullyDiscounted", requote: false, retrySameReference: false };
  }
  try {
    const rpc = await backend.createIntent(i);
    if (rpc.ok === true && typeof rpc.payment_id === "string") {
      return {
        ok: true,
        paymentId: rpc.payment_id,
        amountUgx: typeof rpc.amount_ugx === "number" ? rpc.amount_ugx : i.amountUgx,
        idempotent: rpc.idempotent === true,
      };
    }
    const error = typeof rpc.error === "string" ? rpc.error : undefined;
    const c = classifyCheckoutError(error);
    if (c.kind === "requote") {
      return { ok: false, errorKey: c.errorKey, requote: true, retrySameReference: false };
    }
    // Timeout/transport during create: retry with the SAME reference (the
    // payment may exist — M3-A create is idempotent on reference).
    const retrySameReference =
      error === undefined || error === "offline" || /timeout|network|failed to fetch/i.test(error);
    return { ok: false, errorKey: c.errorKey, requote: false, retrySameReference };
  } catch {
    return {
      ok: false,
      errorKey: "checkoutNetworkError",
      requote: false,
      retrySameReference: true,
    };
  }
}

export async function initiateCheckoutPayment(
  backend: CheckoutBackend,
  i: { paymentId: string; phone: string },
): Promise<CheckoutEvent> {
  try {
    const result = await backend.initiate(i);
    return classifyInitiateResult({
      ok: result.ok === true,
      error: typeof result.error === "string" ? result.error : undefined,
      retryable: result.retryable === true,
    });
  } catch {
    return { type: "INITIATE_TIMEOUT", errorKey: "checkoutNetworkError" };
  }
}

export type ResumeTarget = {
  paymentId: string;
  reference: string | null;
  planCode: CheckoutPlanCode | null;
  cycle: CheckoutCycle;
  amountUgx: number;
};

/** Server history is the source of truth for recovery (newest row first). */
export function recoverLatestPendingPayment(
  listResult: RpcLike,
): ResumeTarget | null {
  if (listResult.ok !== true || !Array.isArray(listResult.payments)) return null;
  for (const raw of listResult.payments as Array<Record<string, unknown>>) {
    if (raw.status !== "pending" || typeof raw.payment_id !== "string") continue;
    const checkout = (raw.checkout ?? {}) as Record<string, unknown>;
    return {
      paymentId: raw.payment_id,
      reference: typeof raw.reference === "string" ? raw.reference : null,
      planCode:
        typeof checkout.plan_code === "string" &&
        (CHECKOUT_PLANS as string[]).includes(checkout.plan_code)
          ? (checkout.plan_code as CheckoutPlanCode)
          : null,
      cycle: checkout.billing_interval === "year" ? "yearly" : "monthly",
      amountUgx: Number(raw.amount_ugx ?? 0),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Safe display projection (defense in depth on top of M3-B's server projection)
// ---------------------------------------------------------------------------

export type DisplayPayment = {
  status: string;
  statusReason: string | null;
  amountUgx: number;
  currency: string;
  provider: string | null;
  reference: string | null;
  createdAt: string;
  confirmedAt: string | null;
  planCode: string | null;
  billingInterval: string | null;
  quotedAmount: number | null;
  quotedAt: string | null;
};

/** Only the §12 whitelist — never note/recorded_by/metadata/phone/organization_id. */
export function toDisplayPayment(raw: unknown): DisplayPayment | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.status !== "string") return null;
  const checkout = (row.checkout ?? {}) as Record<string, unknown>;
  return {
    status: row.status,
    statusReason: typeof row.status_reason === "string" ? row.status_reason : null,
    amountUgx: Number(row.amount_ugx ?? 0),
    currency: typeof row.currency === "string" ? row.currency : "UGX",
    provider: typeof row.provider === "string" ? row.provider : null,
    reference: typeof row.reference === "string" ? row.reference : null,
    createdAt: String(row.created_at ?? ""),
    confirmedAt: typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    planCode: typeof checkout.plan_code === "string" ? checkout.plan_code : null,
    billingInterval: typeof checkout.billing_interval === "string" ? checkout.billing_interval : null,
    quotedAmount: typeof checkout.quoted_amount === "number" ? checkout.quoted_amount : null,
    quotedAt: typeof checkout.quoted_at === "string" ? checkout.quoted_at : null,
  };
}

export function toDisplayPayments(listResult: RpcLike): DisplayPayment[] {
  if (!Array.isArray(listResult.payments)) return [];
  return (listResult.payments as unknown[])
    .map(toDisplayPayment)
    .filter((p): p is DisplayPayment => p !== null);
}

// ---------------------------------------------------------------------------
// Polling (injected scheduler → deterministic tests; component owns lifecycle)
// ---------------------------------------------------------------------------

export type PollScheduler = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PollerDeps = {
  getPayment: (paymentId: string) => Promise<RpcLike>;
  onPoll: (result: { ok: boolean; status?: string; statusReason?: string | null; error?: string }) => void;
  schedule?: PollScheduler;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxConsecutiveErrors?: number;
};

export const POLL_INITIAL_DELAY_MS = 4_000;
export const POLL_MAX_DELAY_MS = 15_000;
export const POLL_MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Cadence for polling that reaches the PROVIDER (`payment-status` → MTN), as
 * opposed to a local ledger read.
 *
 * Same poller, same backoff shape — deliberately gentler numbers, because each
 * attempt is now a real MTN transaction-status query rather than a database
 * read. Slower to start (the push has just been accepted, so the first seconds
 * are usually still pending) and it settles at 30s instead of 15s, which keeps
 * a long-pending payment to a couple of queries a minute rather than four.
 */
export const POLL_PROVIDER_INITIAL_DELAY_MS = 6_000;
export const POLL_PROVIDER_MAX_DELAY_MS = 30_000;

export function nextPollDelay(attempt: number, initial = POLL_INITIAL_DELAY_MS, max = POLL_MAX_DELAY_MS): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(max, Math.round(initial * Math.pow(1.5, n)));
}

export function shouldContinuePolling(status: string | null | undefined): boolean {
  return !isTerminalStatus(status);
}

export type PaymentPoller = { start(paymentId: string): void; stop(): void };

export function createPaymentPoller(deps: PollerDeps): PaymentPoller {
  const schedule: PollScheduler = deps.schedule ?? {
    setTimeout: (fn) => globalThis.setTimeout(fn, 0) as unknown,
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const initial = deps.initialDelayMs ?? POLL_INITIAL_DELAY_MS;
  const max = deps.maxDelayMs ?? POLL_MAX_DELAY_MS;
  const maxErrors = deps.maxConsecutiveErrors ?? POLL_MAX_CONSECUTIVE_ERRORS;

  let stopped = true;
  let handle: unknown = null;
  let attempt = 0;
  let errors = 0;
  let paymentId = "";

  const run = async () => {
    handle = null;
    if (stopped) return;
    let status: string | undefined;
    let ok: boolean;
    let statusReason: string | null | undefined;
    let error: string | undefined;
    try {
      const r = await deps.getPayment(paymentId);
      ok = r.ok === true;
      status = typeof r.status === "string" ? r.status : undefined;
      statusReason = typeof r.status_reason === "string" ? r.status_reason : null;
      if (!ok) error = typeof r.error === "string" ? r.error : "poll_failed";
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : "poll_failed";
    }
    if (stopped) return;
    deps.onPoll({ ok, status, statusReason, error });
    if (ok) {
      errors = 0;
      if (!shouldContinuePolling(status)) return; // terminal → stop for good
      attempt += 1;
    } else {
      errors += 1;
      if (errors >= maxErrors) return; // give up; UI offers manual refresh
    }
    if (stopped) return;
    handle = schedule.setTimeout(() => {
      void run();
    }, nextPollDelay(attempt, initial, max));
  };

  return {
    start(id: string) {
      if (!stopped && handle !== null) return; // already polling
      stopped = false;
      paymentId = id;
      attempt = 0;
      errors = 0;
      handle = schedule.setTimeout(() => {
        void run();
      }, 0); // first poll immediately, then backoff
    },
    stop() {
      stopped = true;
      if (handle !== null) {
        schedule.clearTimeout(handle);
        handle = null;
      }
    },
  };
}
