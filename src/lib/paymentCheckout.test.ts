/**
 * M3-D — customer checkout logic (pure state machine + mocked backend).
 *
 * No browser/component infrastructure: everything here exercises the reducer,
 * classifiers, recovery selector, display projection and poller with an
 * injected CheckoutBackend. Backend behaviour is proven by the M1/M3-A/M3-B/
 * M3-C/M3-E SQL suites; this suite proves the frontend contract:
 * server price only, honest provider-not-configured state, one reference per
 * attempt, refresh recovery, terminal-state polling, and no internal-field
 * leakage.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CANCEL_REASON,
  CHECKOUT_PLANS,
  CHECKOUT_PROVIDER_ID,
  POLL_MAX_DELAY_MS,
  canPayForPlan,
  checkoutActionKey,
  checkoutReducer,
  classifyCheckoutError,
  classifyInitiateResult,
  createCheckoutIntent,
  createPaymentPoller,
  displayPricingFor,
  initiateCheckoutPayment,
  initialCheckoutState,
  isDowngradePlan,
  isReconciliation,
  isValidE164,
  needsInitiateAction,
  needsStatusCheck,
  newAttemptReference,
  nextPollDelay,
  paymentStatusKey,
  planRank,
  quoteCheckout,
  recoverLatestPendingPayment,
  renewalNoteKey,
  shouldContinuePolling,
  toDisplayPayment,
  toDisplayPayments,
  type CheckoutBackend,
  type CheckoutQuote,
  type CheckoutState,
  type RpcLike,
} from "./paymentCheckout";

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHONE = "+256781234567";

function quoteResp(overrides: Record<string, unknown> = {}): RpcLike {
  return {
    ok: true,
    plan_code: "business",
    billing_interval: "month",
    amount_ugx: 36_000,
    campaign_id: null,
    quoted_at: "2026-10-07T10:00:00+00:00",
    is_current: false,
    current_plan_code: "starter",
    ...overrides,
  };
}

type Queue = Partial<Record<"quote" | "create" | "initiate" | "get" | "list" | "cancel", RpcLike[]>>;

function makeBackend(queue: Queue = {}): CheckoutBackend & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = { quote: [], create: [], initiate: [], get: [], list: [], cancel: [] };
  const next = (key: keyof Queue, fallback: RpcLike): RpcLike => {
    const list = queue[key];
    if (list && list.length > 0) return list.shift() as RpcLike;
    return fallback;
  };
  return {
    calls,
    async quote(i) {
      calls.quote.push([i]);
      return next("quote", quoteResp({ plan_code: i.planCode, billing_interval: i.cycle }));
    },
    async createIntent(i) {
      calls.create.push([i]);
      return next("create", {
        ok: true,
        idempotent: false,
        payment_id: "pay-1",
        amount_ugx: i.amountUgx,
        status: "pending",
        plan_code: i.planCode,
        billing_interval: i.cycle,
      });
    },
    async initiate(i) {
      calls.initiate.push([i]);
      return next("initiate", { ok: true, status: "pending" });
    },
    async getPayment(id) {
      calls.get.push([id]);
      return next("get", { ok: true, payment_id: id, status: "pending" });
    },
    async listPayments(shopId) {
      calls.list.push([shopId]);
      return next("list", { ok: true, payments: [], next_cursor: null });
    },
    async cancel(paymentId) {
      calls.cancel.push([paymentId]);
      // Default: the ledger accepts the cancellation and reports the status it
      // actually wrote. Tests that need a refusal queue `{ ok: false, ... }`.
      return next("cancel", { ok: true, idempotent: false, payment_id: paymentId, status: "cancelled" });
    },
  };
}

/**
 * Drive the reducer into a payment flow:
 *  - "creating_payment" (default): intent created, initiate not yet called;
 *  - "pending_provider": + initiate succeeded (for status/poll scenarios).
 */
function pendingState(target: "creating_payment" | "pending_provider" = "creating_payment"): CheckoutState {
  let s = initialCheckoutState();
  s = checkoutReducer(s, { type: "SELECT_PLAN", plan: "business" });
  s = checkoutReducer(s, { type: "QUOTE_STARTED" });
  s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({}) });
  s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "ref-1", phone: PHONE });
  s = checkoutReducer(s, { type: "INTENT_CREATED", paymentId: "pay-1", amountUgx: 36_000 });
  if (target === "pending_provider") {
    s = checkoutReducer(s, { type: "INITIATE_SUCCEEDED" });
  }
  return s;
}

function quote(overrides: Record<string, unknown> = {}): CheckoutQuote {
  return {
    planCode: "business",
    cycle: "monthly",
    amountUgx: 36_000,
    campaignId: null,
    quotedAt: "2026-10-07T10:00:00+00:00",
    isCurrent: false,
    currentPlanCode: "starter",
    ...overrides,
  } as CheckoutQuote;
}

// ---------------------------------------------------------------------------
// Poller scheduler (manual, deterministic)
// ---------------------------------------------------------------------------

function makeScheduler() {
  const entries: Array<{ fn: () => void; cancelled: boolean }> = [];
  return {
    api: {
      setTimeout: (fn: () => void) => {
        const entry = { fn, cancelled: false };
        entries.push(entry);
        return entry;
      },
      clearTimeout: (h: unknown) => {
        (h as { cancelled: boolean }).cancelled = true;
      },
    },
    get size() {
      return entries.filter((e) => !e.cancelled).length;
    },
    async runNext(): Promise<boolean> {
      const entry = entries.shift();
      if (!entry || entry.cancelled) return false;
      entry.fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// 1–7: state machine
// ---------------------------------------------------------------------------

describe("M3-D checkout state machine", () => {
  it("1. initial state is idle", () => {
    const s = initialCheckoutState();
    expect(s.phase).toBe("idle");
    expect(s.planCode).toBeNull();
    expect(s.quote).toBeNull();
    expect(s.intent).toBeNull();
    expect(checkoutReducer(s, { type: "POLL_ERROR" })).toEqual(s); // unknown-in-state events do not corrupt
  });

  it("2. plan selection moves to selecting and clears stale quote/intent", () => {
    let s = initialCheckoutState();
    s = checkoutReducer(s, { type: "SELECT_PLAN", plan: "starter" });
    expect(s.phase).toBe("selecting");
    expect(s.planCode).toBe("starter");
    s = checkoutReducer(s, { type: "QUOTE_STARTED" });
    s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({ planCode: "starter" }) });
    expect(s.quote?.amountUgx).toBe(36_000);
    s = checkoutReducer(s, { type: "SELECT_PLAN", plan: "waka_plus" });
    expect(s.quote).toBeNull();
    expect(s.intent).toBeNull();
  });

  it("3. cycle selection changes cycle and invalidates the quote", () => {
    let s = checkoutReducer(initialCheckoutState(), { type: "SELECT_PLAN", plan: "business" });
    s = checkoutReducer(s, { type: "QUOTE_STARTED" });
    s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({}) });
    s = checkoutReducer(s, { type: "SELECT_CYCLE", cycle: "yearly" });
    expect(s.cycle).toBe("yearly");
    expect(s.quote).toBeNull();
  });

  it("4. current plan uses Renew wording", () => {
    expect(checkoutActionKey(quote({ isCurrent: true, currentPlanCode: "business", planCode: "business" }))).toBe(
      "checkoutRenew",
    );
  });

  it("5. upgrade flow uses Upgrade wording", () => {
    expect(checkoutActionKey(quote({ currentPlanCode: "starter", planCode: "business" }))).toBe(
      "checkoutUpgrade",
    );
    expect(planRank("business")).toBeGreaterThan(planRank("starter"));
  });

  it("6. downgrade requires explicit confirmation before paying", () => {
    let s = checkoutReducer(initialCheckoutState(), { type: "SELECT_PLAN", plan: "starter" });
    s = checkoutReducer(s, { type: "QUOTE_STARTED" });
    s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({ currentPlanCode: "business", planCode: "starter" }) });
    expect(isDowngradePlan("business", "starter")).toBe(true);
    expect(checkoutActionKey(s.quote!)).toBe("checkoutDowngrade");

    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "r", phone: PHONE });
    expect(s.phase).toBe("selecting"); // blocked, no intent
    expect(s.errorKey).toBe("checkoutDowngradeConfirm");
    expect(s.intent).toBeNull();

    s = checkoutReducer(s, { type: "DOWNGRADE_CONFIRMED" });
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "r", phone: PHONE });
    expect(s.phase).toBe("creating_payment");
    expect(s.intent?.reference).toBe("r");
  });

  it("7. Free plan can never pay", () => {
    expect(CHECKOUT_PLANS).not.toContain("free");
    expect(canPayForPlan("free")).toBe(false);
    let s = checkoutReducer(initialCheckoutState(), { type: "SELECT_PLAN", plan: "free" as never });
    s = checkoutReducer(s, { type: "QUOTE_STARTED" });
    s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({ planCode: "free" as never }) });
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "r", phone: PHONE });
    expect(s.phase).not.toBe("creating_payment");
    expect(s.intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8–11: quote
// ---------------------------------------------------------------------------

describe("M3-D quote flow", () => {
  it("8. quote success maps the server payload", async () => {
    const backend = makeBackend();
    const r = await quoteCheckout(backend, { shopId: SHOP, planCode: "business", cycle: "monthly" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quote.amountUgx).toBe(36_000);
      expect(r.quote.planCode).toBe("business");
      expect(r.quote.cycle).toBe("monthly");
      expect(r.quote.currentPlanCode).toBe("starter");
    }
    expect(backend.calls.quote).toEqual([
      [{ shopId: SHOP, planCode: "business", cycle: "monthly" }],
    ]);
  });

  it("9. quote failures classify into requote vs fatal", async () => {
    const mismatch = await quoteCheckout(
      makeBackend({ quote: [{ ok: false, error: "shop_subscription_mismatch" }] }),
      { shopId: SHOP, planCode: "business", cycle: "monthly" },
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.errorKey).toBe("checkoutShopChanged");
      expect(mismatch.requote).toBe(true);
    }
    const forbidden = await quoteCheckout(
      makeBackend({ quote: [{ ok: false, error: "forbidden" }] }),
      { shopId: SHOP, planCode: "business", cycle: "monthly" },
    );
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.errorKey).toBe("checkoutUnavailable");
      expect(forbidden.requote).toBe(false);
    }
  });

  it("10. displayed price is the server quote — createIntent receives exactly it", async () => {
    const backend = makeBackend({ quote: [quoteResp({ amount_ugx: 27_000 })] });
    const quoted = await quoteCheckout(backend, { shopId: SHOP, planCode: "business", cycle: "monthly" });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.quote.amountUgx).toBe(27_000);

    const created = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference: "ref-10",
      planCode: "business",
      cycle: "monthly",
      amountUgx: quoted.quote.amountUgx, // what the UI renders is what is sent
    });
    expect(created.ok).toBe(true);
    const sent = backend.calls.create[0]![0] as { amountUgx: number; shopId: string };
    expect(sent.amountUgx).toBe(27_000);
    expect(sent.shopId).toBe(SHOP);
  });

  it("11. campaign discount is displayed from server data only", () => {
    const q = quote({ amountUgx: 27_000, campaignId: "campaign-1" });
    expect(q.campaignId).toBe("campaign-1");
    const display = displayPricingFor(q, { originalMonthlyUgx: 36_000, finalMonthlyUgx: 36_000 });
    expect(display.finalUgx).toBe(27_000); // final is always the quote
    expect(display.originalUgx).toBe(36_000);
    expect(display.discountUgx).toBe(9_000); // display-only delta
    // No public row → no fake discount.
    const plain = displayPricingFor(q, null);
    expect(plain.discountUgx).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12–14: intent creation / idempotency / double-click
// ---------------------------------------------------------------------------

describe("M3-D payment intent", () => {
  it("12. createIntent sends shop, plan, cycle, reference and server amount", async () => {
    const backend = makeBackend();
    const r = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference: "ref-12",
      planCode: "waka_plus",
      cycle: "yearly",
      amountUgx: 787_200,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paymentId).toBe("pay-1");
    expect(backend.calls.create[0]![0]).toEqual({
      shopId: SHOP,
      reference: "ref-12",
      planCode: "waka_plus",
      cycle: "yearly",
      amountUgx: 787_200,
    });
  });

  it("13. idempotent create reuses the existing payment and the same reference", async () => {
    const backend = makeBackend({
      create: [
        { ok: false, error: "offline" },
        { ok: true, idempotent: true, payment_id: "pay-existing", amount_ugx: 36_000 },
      ],
    });
    // Lost response → retrySameReference so the attempt can be replayed.
    const first = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference: "ref-13",
      planCode: "business",
      cycle: "monthly",
      amountUgx: 36_000,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.retrySameReference).toBe(true);

    const retry = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference: "ref-13", // SAME reference
      planCode: "business",
      cycle: "monthly",
      amountUgx: 36_000,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.idempotent).toBe(true);
      expect(retry.paymentId).toBe("pay-existing");
    }
    expect((backend.calls.create[1]![0] as { reference: string }).reference).toBe("ref-13");
  });

  it("14. duplicate Pay is prevented in pending and creating states", () => {
    let s = pendingState();
    expect(s.phase).toBe("creating_payment");
    const reference = s.intent!.reference;
    // Second click while creating: same intent/reference (in-flight guard is in
    // the component; the reducer keeps the attempt identical).
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "OTHER", phone: PHONE });
    expect(s.intent?.reference).toBe(reference);
    // After initiate succeeded, further Pay events are ignored entirely.
    s = checkoutReducer(s, { type: "INITIATE_SUCCEEDED" });
    expect(s.phase).toBe("pending_provider");
    const pending = s;
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference: "OTHER2", phone: PHONE });
    expect(s).toEqual(pending);
  });
});

// ---------------------------------------------------------------------------
// 15–18: initiate outcomes
// ---------------------------------------------------------------------------

describe("M3-D provider initiation (no provider configured yet)", () => {
  it("15. provider pending transitions to pending_provider", () => {
    expect(classifyInitiateResult({ ok: true })).toEqual({ type: "INITIATE_SUCCEEDED" });
    const s = checkoutReducer(pendingState(), { type: "INITIATE_SUCCEEDED" });
    expect(s.phase).toBe("pending_provider");
    expect(s.initiated).toBe(true);
    expect(s.initiateAction).toBeNull();
  });

  it("16. provider_not_configured → honest prepared state (never success)", () => {
    expect(classifyInitiateResult({ ok: false, error: "provider_not_configured" })).toEqual({
      type: "INITIATE_NOT_CONFIGURED",
    });
    const s = checkoutReducer(pendingState(), { type: "INITIATE_NOT_CONFIGURED" });
    expect(s.phase).toBe("provider_not_configured");
    expect(s.phase).not.toBe("confirmed");
    expect(s.initiated).toBe(false);
    expect(CHECKOUT_PROVIDER_ID).toBe("mtn_momo"); // current checkout provider (MTN MoMo sandbox adapter)
  });

  it("17. initiate timeout leaves pending with a retry action", () => {
    expect(classifyInitiateResult({ ok: false, error: "initiate_timeout" })).toEqual({
      type: "INITIATE_TIMEOUT",
      errorKey: "checkoutNetworkError",
    });
    const s = checkoutReducer(pendingState(), { type: "INITIATE_TIMEOUT", errorKey: "checkoutNetworkError" });
    expect(s.phase).toBe("pending_provider");
    expect(s.initiated).toBe(false);
    expect(s.initiateAction).toBe("retry");
    expect(needsInitiateAction(s)).toBe(true);
    expect(needsStatusCheck(s)).toBe(false);
  });

  it("18. transport failure stays pending; attach-failure asks for a status check", async () => {
    expect(
      classifyInitiateResult({ ok: false, error: "provider_unavailable", retryable: true }),
    ).toEqual({ type: "INITIATE_RETRYABLE", errorKey: "checkoutNetworkError" });

    const throwing = makeBackend();
    throwing.initiate = async () => {
      throw new Error("network down");
    };
    const event = await initiateCheckoutPayment(throwing, { paymentId: "pay-1", phone: PHONE });
    expect(event).toEqual({ type: "INITIATE_TIMEOUT", errorKey: "checkoutNetworkError" });

    const attach = checkoutReducer(pendingState(), { type: "INITIATE_ATTACH_FAILED", errorKey: "checkoutNetworkError" });
    expect(attach.phase).toBe("pending_provider");
    expect(attach.initiateAction).toBe("poll");
    expect(needsStatusCheck(attach)).toBe(true);
    expect(needsInitiateAction(attach)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 19–22: payment status
// ---------------------------------------------------------------------------

describe("M3-D payment status handling", () => {
  it("19. confirmed", () => {
    const s = checkoutReducer(pendingState("pending_provider"), { type: "POLL_RECEIVED", status: "confirmed", statusReason: null });
    expect(s.phase).toBe("confirmed");
    expect(s.paymentStatus).toBe("confirmed");
  });

  it("20. failed", () => {
    const s = checkoutReducer(pendingState("pending_provider"), { type: "POLL_RECEIVED", status: "failed", statusReason: "provider_error" });
    expect(s.phase).toBe("failed");
    expect(s.statusReason).toBe("provider_error");
  });

  it("21. cancelled (ordinary)", () => {
    const s = checkoutReducer(pendingState("pending_provider"), { type: "POLL_RECEIVED", status: "cancelled", statusReason: "checkout abandoned" });
    expect(s.phase).toBe("cancelled");
    expect(s.paymentStatus).toBe("cancelled");
  });

  it("22. reconciliation (stale_replaced) is never a normal failure", () => {
    expect(isReconciliation("cancelled", "stale_replaced")).toBe(true);
    expect(isReconciliation("cancelled", "stale_success")).toBe(true);
    expect(isReconciliation("cancelled", "checkout abandoned")).toBe(false);
    expect(isReconciliation("failed", "stale_replaced")).toBe(false);
    const s = checkoutReducer(pendingState("pending_provider"), { type: "POLL_RECEIVED", status: "cancelled", statusReason: "stale_replaced" });
    expect(s.phase).toBe("reconciliation_required");
    expect(s.phase).not.toBe("failed");
    // pending and unknown statuses never leave the pending state.
    const still = checkoutReducer(pendingState("pending_provider"), { type: "POLL_RECEIVED", status: "pending", statusReason: null });
    expect(still.phase).toBe("pending_provider");
    expect(shouldContinuePolling("pending")).toBe(true);
    expect(shouldContinuePolling("confirmed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 23–26: refresh / recovery
// ---------------------------------------------------------------------------

describe("M3-D recovery", () => {
  const pendingRow = {
    payment_id: "pay-resume",
    status: "pending",
    amount_ugx: 36_000,
    reference: "ref-resume",
    checkout: { plan_code: "business", billing_interval: "year", quoted_amount: 36_000 },
  };

  it("23. refresh recovery adopts the newest pending intent from server history", async () => {
    const backend = makeBackend({ list: [{ ok: true, payments: [pendingRow], next_cursor: null }] });
    const list = await backend.listPayments(SHOP);
    const resume = recoverLatestPendingPayment(list);
    expect(resume).not.toBeNull();
    expect(resume!.paymentId).toBe("pay-resume");
    expect(resume!.reference).toBe("ref-resume");
    expect(resume!.planCode).toBe("business");
    expect(resume!.cycle).toBe("yearly");

    const s = checkoutReducer(initialCheckoutState(), {
      type: "RESUMED",
      paymentId: resume!.paymentId,
      reference: resume!.reference,
      amountUgx: resume!.amountUgx,
      planCode: resume!.planCode,
      cycle: resume!.cycle,
    });
    expect(s.phase).toBe("pending_provider");
    expect(s.intent?.paymentId).toBe("pay-resume");
    expect(s.initiated).toBe(false); // unknown → UI offers Continue payment
  });

  it("24. recovery ignores terminal and empty histories", () => {
    expect(
      recoverLatestPendingPayment({ ok: true, payments: [{ payment_id: "p", status: "confirmed" }], next_cursor: null }),
    ).toBeNull();
    expect(recoverLatestPendingPayment({ ok: true, payments: [], next_cursor: null })).toBeNull();
    expect(recoverLatestPendingPayment({ ok: false, error: "forbidden" })).toBeNull();
    // pending row is found even when listed behind a terminal one
    expect(
      recoverLatestPendingPayment({
        ok: true,
        payments: [{ payment_id: "old", status: "confirmed" }, pendingRow],
        next_cursor: null,
      })?.paymentId,
    ).toBe("pay-resume");
    // RESUMED never clobbers an in-flight creation.
    const creating = pendingState();
    const ignored = checkoutReducer(creating, {
      type: "RESUMED",
      paymentId: "other",
      reference: null,
      amountUgx: 1,
      planCode: null,
      cycle: "monthly",
    });
    expect(ignored).toBe(creating);
  });

  it("25. lost create response → retry with the same reference stays one attempt", async () => {
    const backend = makeBackend({
      create: [
        { ok: false, error: "failed to fetch" },
        { ok: true, idempotent: true, payment_id: "pay-25", amount_ugx: 36_000 },
      ],
    });
    let s = checkoutReducer(initialCheckoutState(), { type: "SELECT_PLAN", plan: "business" });
    s = checkoutReducer(s, { type: "QUOTE_STARTED" });
    s = checkoutReducer(s, { type: "QUOTE_OK", quote: quote({}) });
    const reference = newAttemptReference();
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference, phone: PHONE });

    const first = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference,
      planCode: "business",
      cycle: "monthly",
      amountUgx: 36_000,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.retrySameReference).toBe(true);
    s = checkoutReducer(s, { type: "INTENT_CREATE_FAILED", errorKey: "checkoutNetworkError", retrySameReference: true });
    expect(s.phase).toBe("creating_payment"); // stays for retry
    expect(s.intent?.reference).toBe(reference);

    // Retry (same reference) → idempotent success.
    s = checkoutReducer(s, { type: "PAY_REQUESTED", reference, phone: PHONE });
    expect(s.intent?.reference).toBe(reference);
    const second = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference,
      planCode: "business",
      cycle: "monthly",
      amountUgx: 36_000,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.paymentId).toBe("pay-25");
    expect(newAttemptReference()).not.toBe(reference); // fresh attempts get fresh refs
    expect(isValidE164(PHONE)).toBe(true);
    expect(isValidE164("0771234567")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 27–31: shop protection, conflicts, wording
// ---------------------------------------------------------------------------

describe("M3-D shop protection and conflicts", () => {
  it("27. active-shop switch abandons the checkout context", () => {
    const s = checkoutReducer(pendingState(), { type: "SHOP_CHANGED" });
    expect(s.intent).toBeNull();
    expect(s.phase).not.toBe("pending_provider");
    expect(s.errorKey).toBe("checkoutShopChanged");
  });

  it("28. shop mismatch surfaces as a re-quote, never a forced shop", async () => {
    const backend = makeBackend({ create: [{ ok: false, error: "shop_subscription_mismatch" }] });
    const r = await createCheckoutIntent(backend, {
      shopId: SHOP,
      reference: "ref-28",
      planCode: "business",
      cycle: "monthly",
      amountUgx: 36_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKey).toBe("checkoutShopChanged");
      expect(r.requote).toBe(true);
    }
    expect(classifyCheckoutError("shop_not_found")).toEqual({
      errorKey: "checkoutShopChanged",
      kind: "requote",
    });
  });

  it("29. subscription_conflict classifies as a sync/refresh condition", () => {
    expect(classifyCheckoutError("subscription_conflict")).toEqual({
      errorKey: "checkoutSyncRequired",
      kind: "sync",
    });
    expect(classifyCheckoutError("amount_mismatch").kind).toBe("requote");
    expect(classifyCheckoutError("provider_not_configured").kind).toBe("preparing");
    expect(classifyCheckoutError("forbidden").kind).toBe("fatal");
  });

  it("30. expired subscription wording", () => {
    expect(renewalNoteKey({ effectiveStatus: "expired", hasFuturePeriodEnd: false })).toBe("checkoutExpiredNote");
    expect(renewalNoteKey({ effectiveStatus: "active", hasFuturePeriodEnd: false })).toBe("checkoutPeriodFromNow");
  });

  it("31. trial → paid wording explains the anchored period", () => {
    expect(renewalNoteKey({ effectiveStatus: "trialing", hasFuturePeriodEnd: true })).toBe("checkoutPeriodAnchored");
    expect(renewalNoteKey({ effectiveStatus: "trial", hasFuturePeriodEnd: false })).toBe("checkoutPeriodAnchored");
    expect(renewalNoteKey({ effectiveStatus: "active", hasFuturePeriodEnd: true })).toBe("checkoutPeriodAnchored");
  });
});

// ---------------------------------------------------------------------------
// 32–33: payment history projection
// ---------------------------------------------------------------------------

describe("M3-D payment history projection", () => {
  const serverRow = {
    payment_id: "pay-h",
    subscription_id: "sub-h",
    shop_id: "shop-h",
    organization_id: "org-h",
    status: "confirmed",
    status_reason: null,
    amount_ugx: 36_000,
    currency: "UGX",
    provider: "pesapal",
    reference: "ref-h",
    created_at: "2026-10-07T10:00:00+00:00",
    confirmed_at: "2026-10-07T10:00:05+00:00",
    checkout: {
      plan_code: "business",
      billing_interval: "month",
      quoted_amount: 36_000,
      campaign_id: null,
      quoted_at: "2026-10-07T09:59:00+00:00",
    },
    // Internal fields that must NEVER surface:
    note: "internal note with staff text",
    recorded_by: "internal-user-uuid",
    metadata: { phone: "+256771234567", callback: { secret: "raw" } },
  };

  it("32. history projection carries every safe display field", () => {
    const d = toDisplayPayment(serverRow);
    expect(d).not.toBeNull();
    expect(d!.status).toBe("confirmed");
    expect(d!.amountUgx).toBe(36_000);
    expect(d!.currency).toBe("UGX");
    expect(d!.provider).toBe("pesapal");
    expect(d!.reference).toBe("ref-h");
    expect(d!.createdAt).toBe("2026-10-07T10:00:00+00:00");
    expect(d!.confirmedAt).toBe("2026-10-07T10:00:05+00:00");
    expect(d!.planCode).toBe("business");
    expect(d!.billingInterval).toBe("month");
    expect(d!.quotedAmount).toBe(36_000);
    expect(d!.quotedAt).toBe("2026-10-07T09:59:00+00:00");
    expect(d!.statusReason).toBeNull();
    expect(paymentStatusKey(d!.status)).toBe("checkoutStatusConfirmed");
  });

  it("33. internal fields are never surfaced", () => {
    const d = toDisplayPayment(serverRow)!;
    expect(Object.keys(d).sort()).toEqual(
      [
        "amountUgx",
        "billingInterval",
        "confirmedAt",
        "createdAt",
        "currency",
        "planCode",
        "provider",
        "quotedAmount",
        "quotedAt",
        "reference",
        "status",
        "statusReason",
      ].sort(),
    );
    expect(d).not.toHaveProperty("note");
    expect(d).not.toHaveProperty("recorded_by");
    expect(d).not.toHaveProperty("metadata");
    expect(d).not.toHaveProperty("organizationId");
    expect(d).not.toHaveProperty("paymentId");
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("+256771234567"); // phone stays server-side
    expect(serialized).not.toContain("raw"); // callback payload stays server-side
    expect(serialized).not.toContain("internal note");

    const list = toDisplayPayments({ ok: true, payments: [serverRow, { status: "pending" }] });
    expect(list).toHaveLength(2);
    expect(toDisplayPayment({})).toBeNull();
    expect(toDisplayPayment(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 34–36: polling
// ---------------------------------------------------------------------------

describe("M3-D payment polling", () => {
  it("34. polling stops immediately on a terminal status", async () => {
    const scheduler = makeScheduler();
    const seen: string[] = [];
    let calls = 0;
    const poller = createPaymentPoller({
      getPayment: async () => {
        calls += 1;
        return { ok: true, payment_id: "p", status: "confirmed" };
      },
      onPoll: (r) => seen.push(r.status ?? ""),
      schedule: scheduler.api,
    });
    poller.start("p");
    expect(scheduler.size).toBe(1); // first tick queued
    await scheduler.runNext();
    expect(seen).toEqual(["confirmed"]);
    expect(calls).toBe(1);
    expect(scheduler.size).toBe(0); // terminal → no further polls
  });

  it("35. backoff grows and polling gives up after repeated errors", async () => {
    expect(nextPollDelay(0)).toBe(4_000); // 3–5s initial window
    expect(nextPollDelay(1)).toBe(6_000);
    expect(nextPollDelay(2)).toBe(9_000);
    expect(nextPollDelay(10)).toBe(POLL_MAX_DELAY_MS); // capped

    const scheduler = makeScheduler();
    let errors = 0;
    const poller = createPaymentPoller({
      getPayment: async () => ({ ok: false, error: "offline" }),
      onPoll: () => {
        errors += 1;
      },
      schedule: scheduler.api,
    });
    poller.start("p");
    for (let i = 0; i < 5; i += 1) {
      const ran = await scheduler.runNext();
      if (!ran) break;
    }
    expect(errors).toBe(3); // stops after POLL_MAX_CONSECUTIVE_ERRORS
    expect(scheduler.size).toBe(0);
  });

  it("36. stop() cancels the scheduled tick — no callbacks after unmount", async () => {
    const scheduler = makeScheduler();
    let seen = 0;
    const poller = createPaymentPoller({
      getPayment: async () => ({ ok: true, status: "pending" }),
      onPoll: () => {
        seen += 1;
      },
      schedule: scheduler.api,
    });
    poller.start("p");
    poller.stop(); // component unmount
    const ran = await scheduler.runNext();
    expect(ran).toBe(false);
    expect(seen).toBe(0);
    // A late manual invocation of a cleared tick must also be inert.
    expect(scheduler.size).toBe(0);
  });
});

/**
 * G3 — abandoning a pending payment.
 *
 * The payer must never be trapped on "Payment pending". These pin the part of
 * that guarantee the state machine owns: a cancel that the SERVER refused must
 * leave the payment looking exactly as pending as it still is, and an
 * abandoned payment must never be mistaken for a settled one.
 */
describe("G3 — cancel a pending payment", () => {
  it("a refused cancellation stays pending and records why", () => {
    const before = pendingState("pending_provider");
    const after = checkoutReducer(before, { type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" });

    // Nothing about the payment changed — only the reason we could not end it.
    expect(after.phase).toBe("pending_provider");
    expect(after.paymentStatus).toBe(before.paymentStatus);
    expect(after.cancelErrorKey).toBe("checkoutCancelFailed");
    // Specifically: no hint that it was cancelled.
    expect(after.phase).not.toBe("cancelled");
  });

  it("a refused cancellation outside the pending phase is ignored", () => {
    const idle = initialCheckoutState();
    const after = checkoutReducer(idle, { type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" });
    expect(after).toEqual(idle);
  });

  it("an authoritative status clears a stale cancellation error", () => {
    let s = pendingState("pending_provider");
    s = checkoutReducer(s, { type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" });
    // The server says it is still live: that supersedes "we couldn't cancel".
    s = checkoutReducer(s, { type: "POLL_RECEIVED", status: "pending", statusReason: null });
    expect(s.cancelErrorKey).toBeNull();
    expect(s.phase).toBe("pending_provider");
  });

  it("the payer's own abandonment is NOT a reconciliation marker", () => {
    // A reconciliation marker would send them to the "under review" screen and
    // imply the server is investigating — but this is their own decision.
    expect(isReconciliation("cancelled", CHECKOUT_CANCEL_REASON)).toBe(false);
  });

  it("an abandoned payment settles as cancelled, and grants nothing", () => {
    let s = pendingState("pending_provider");
    s = checkoutReducer(s, {
      type: "POLL_RECEIVED",
      status: "cancelled",
      statusReason: CHECKOUT_CANCEL_REASON,
    });

    expect(s.phase).toBe("cancelled");
    expect(s.paymentStatus).toBe("cancelled");
    // Never a confirmed/entitled state — the checkout has no path from cancelled
    // to confirmed, so no subscription is granted by cancelling.
    expect(s.phase).not.toBe("confirmed");
  });

  it("a server-flagged cancellation is sent to review, not silently buried", () => {
    // While still pending, a cancellation carrying a reconciliation marker means
    // the SERVER flagged this payment (stale replacement), not that the payer
    // chose to leave — so it must surface as "under review".
    let s = pendingState("pending_provider");
    s = checkoutReducer(s, { type: "POLL_RECEIVED", status: "cancelled", statusReason: "stale_success" });
    expect(s.phase).toBe("reconciliation_required");
    expect(s.phase).not.toBe("confirmed");
  });

  it("a LATE provider success cannot resurrect an abandoned payment", () => {
    let s = pendingState("pending_provider");
    s = checkoutReducer(s, { type: "POLL_RECEIVED", status: "cancelled", statusReason: CHECKOUT_CANCEL_REASON });
    expect(s.phase).toBe("cancelled");

    // A late `confirmed` must not move an abandoned payment into an entitled
    // state. Status transitions are only accepted while the checkout is pending;
    // after that the server's stale-success refusal is the authority
    // (paymentCallbackFoundation T19), never client-side timing.
    s = checkoutReducer(s, { type: "POLL_RECEIVED", status: "confirmed", statusReason: null });
    expect(s.phase).toBe("cancelled");
    expect(s.phase).not.toBe("confirmed");
  });

  it("cancelling never reuses or re-creates a payment intent", () => {
    const s = pendingState("pending_provider");
    const after = checkoutReducer(s, { type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" });
    // Same intent, same id — the cancel path has no intent-creation branch at all.
    expect(after.intent?.paymentId).toBe(s.intent?.paymentId);
    expect(after.intent?.reference).toBe(s.intent?.reference);
  });
});
