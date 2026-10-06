/**
 * M1 — payment settlement through the subscription engine extension points.
 *
 * The provider adapters (MTN / Airtel) are a later phase; what is asserted
 * here is that onPaymentSuccess / onPaymentFailure / onRefund drive the
 * server-side payment RPCs with a server-checked amount, stay idempotent on
 * replay, and never confirm a payment the server refused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onPaymentFailure, onPaymentSuccess, onRefund } from "./subscriptionEngine";

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type RpcCall = { name: string; args: Record<string, unknown> };

const net = vi.hoisted(() => {
  const calls: RpcCall[] = [];
  const queue: Array<{ data?: unknown; error?: { message: string } }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const next = queue.shift();
    if (!next) return { data: null, error: null };
    return { data: next.data ?? null, error: next.error ?? null };
  });
  const from = vi.fn();
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
  };
  return { calls, queue, rpc, from, auth };
});

vi.mock("./supabase", () => ({
  supabase: { rpc: net.rpc, from: net.from, auth: net.auth },
  hasSupabaseConfig: true,
}));

vi.mock("./internalAdminActionRunner", () => ({
  notifyInternalOpsChanged: vi.fn(),
}));

vi.mock("./rescueSupportActions", () => ({
  logInternalAdminAudit: vi.fn(async () => undefined),
}));

vi.mock("./fetchShopSubscription", () => ({
  fetchActivePromotionalGrant: vi.fn(async () => null),
}));

/** Chainable PostgREST query stub resolving to a single row (or none). */
function queryFor(row: Record<string, unknown> | null) {
  const result = Promise.resolve({ data: row, error: null, count: null });
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "eq", "neq", "in", "is", "gte", "lte", "order", "limit", "single"]) {
    chain[key] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => result);
  chain.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => (result as Promise<unknown>).then(onFulfilled, onRejected);
  return chain;
}

const TABLES: Record<string, Record<string, unknown>> = {
  shops: { organization_id: ORG },
  subscriptions: {
    id: SUB,
    organization_id: ORG,
    shop_id: SHOP,
    status: "trialing",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    plan_id: PLAN,
    created_at: "2026-01-01T00:00:00Z",
  },
  subscription_plans: {
    id: PLAN,
    code: "business",
    max_pos_users: 4,
    max_shops: 1,
    features: { devices: 4 },
  },
};

function respondWith(payload: unknown): void {
  net.queue.push({ data: payload });
}

function respondWithError(message: string): void {
  net.queue.push({ error: { message } });
}

function callsTo(name: string): RpcCall[] {
  return net.calls.filter((c) => c.name === name);
}

describe("M1 — subscription engine payment extension points", () => {
  beforeEach(() => {
    net.calls.length = 0;
    net.queue.length = 0;
    net.rpc.mockClear();
    net.from.mockReset();
    net.from.mockImplementation((table: string) => queryFor(TABLES[table] ?? null));
  });

  it("onPaymentSuccess creates a pending payment then confirms it server-side", async () => {
    respondWith({
      ok: true,
      idempotent: false,
      payment_id: "pay-1",
      subscription_id: SUB,
      status: "pending",
      amount_ugx: 36000,
    });
    respondWith({ ok: true, idempotent: false, status: "confirmed", payment_id: "pay-1" });

    const result = await onPaymentSuccess({
      shopId: SHOP,
      planCode: "business",
      amountUgx: 36000,
      provider: "mtn_momo",
      externalReference: "REF-1",
    });

    expect(result.ok).toBe(true);
    expect(net.calls.map((c) => c.name)).toEqual([
      "subscription_payment_create",
      "subscription_payment_confirm",
    ]);

    const createArgs = net.calls[0]!.args;
    expect(createArgs.p_shop_id).toBe(SHOP);
    expect(createArgs.p_provider).toBe("mtn_momo");
    expect(createArgs.p_reference).toBe("REF-1");
    expect(createArgs.p_amount_ugx).toBe(36000);

    const confirmArgs = net.calls[1]!.args;
    expect(confirmArgs.p_payment_id).toBe("pay-1");
    expect(confirmArgs.p_reference).toBe("REF-1");
  });

  it("onPaymentSuccess does not confirm a payment the server refused", async () => {
    respondWith({
      ok: false,
      error: "amount_mismatch",
      expected_amount_ugx: 36000,
    });

    const result = await onPaymentSuccess({
      shopId: SHOP,
      planCode: "business",
      amountUgx: 1,
      provider: "mtn_momo",
      externalReference: "REF-BAD",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("amount_mismatch");
    expect(callsTo("subscription_payment_confirm")).toHaveLength(0);
  });

  it("onPaymentSuccess replays as idempotent and does not settle twice", async () => {
    respondWith({
      ok: true,
      idempotent: true,
      payment_id: "pay-1",
      subscription_id: SUB,
      status: "confirmed",
      amount_ugx: 36000,
    });

    const result = await onPaymentSuccess({
      shopId: SHOP,
      planCode: "business",
      amountUgx: 36000,
      provider: "mtn_momo",
      externalReference: "REF-1",
    });

    expect(result.ok).toBe(true);
    expect(callsTo("subscription_payment_confirm")).toHaveLength(0);
  });

  it("onPaymentFailure fails an existing pending payment", async () => {
    respondWith({ ok: true, payment_id: "pay-2", status: "pending", amount_ugx: 36000 });
    respondWith({ ok: true, status: "failed", payment_id: "pay-2" });

    const result = await onPaymentFailure({
      shopId: SHOP,
      provider: "airtel_money",
      externalReference: "REF-FAIL",
      reason: "declined",
    });

    expect(result.ok).toBe(true);
    expect(net.calls.map((c) => c.name)).toEqual([
      "subscription_payment_lookup",
      "subscription_payment_fail",
    ]);
    expect(net.calls[1]!.args).toEqual({ p_payment_id: "pay-2", p_reason: "declined" });
  });

  it("onPaymentFailure is a no-op when no payment exists for the reference", async () => {
    respondWith({ ok: false, error: "payment_not_found" });

    const result = await onPaymentFailure({
      shopId: SHOP,
      provider: "mtn_momo",
      externalReference: "REF-MISSING",
    });

    expect(result.ok).toBe(true);
    expect(callsTo("subscription_payment_fail")).toHaveLength(0);
  });

  it("onRefund refunds only when the amount matches the ledger row", async () => {
    respondWith({ ok: true, payment_id: "pay-3", status: "confirmed", amount_ugx: 36000 });
    const mismatch = await onRefund({
      shopId: SHOP,
      provider: "mtn_momo",
      externalReference: "REF-1",
      amountUgx: 1000,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toBe("refund_amount_mismatch");
    expect(callsTo("subscription_payment_refund")).toHaveLength(0);

    net.calls.length = 0;
    respondWith({ ok: true, payment_id: "pay-3", status: "confirmed", amount_ugx: 36000 });
    respondWith({ ok: true, status: "refunded", payment_id: "pay-3" });
    const refunded = await onRefund({
      shopId: SHOP,
      provider: "mtn_momo",
      externalReference: "REF-1",
      amountUgx: 36000,
      reason: "requested by merchant",
    });
    expect(refunded.ok).toBe(true);
    expect(net.calls.map((c) => c.name)).toEqual([
      "subscription_payment_lookup",
      "subscription_payment_refund",
    ]);
  });

  it("onRefund surfaces a missing payment instead of silently succeeding", async () => {
    respondWith({ ok: false, error: "payment_not_found" });
    const result = await onRefund({
      shopId: SHOP,
      provider: "mtn_momo",
      externalReference: "REF-NOPE",
      amountUgx: 36000,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("payment_not_found");
  });

  it("transport errors from the payment RPCs are surfaced as failures", async () => {
    respondWithError("permission denied for function subscription_payment_create");
    const result = await onPaymentSuccess({
      shopId: SHOP,
      planCode: "business",
      amountUgx: 36000,
      provider: "mtn_momo",
      externalReference: "REF-1",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/permission denied/);
  });
});
