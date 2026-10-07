import { describe, expect, it } from "vitest";
import { runInitiateFlow, type RpcResult } from "../../supabase/functions/_shared/payment/ledger.ts";
import { FakePaymentAdapter } from "../../supabase/functions/_shared/payment/fakeAdapter.ts";
import type { PaymentRow } from "../../supabase/functions/_shared/payment/types.ts";

/**
 * M3-G — server-side initiation claim semantics (unit, mock ledger).
 *
 * Proves the property the claim exists for: when a concurrent initiate holds
 * the claim (or a provider call is already recorded), THIS request never
 * reaches the provider. Real DB-level claim races are covered by
 * subscriptionPaymentConcurrency.sql.integration.test.ts (two-session PG).
 */

function makeRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    subscription_id: "22222222-2222-4222-8222-222222222222",
    organization_id: "33333333-3333-4333-8333-333333333333",
    shop_id: "44444444-4444-4444-8444-444444444444",
    provider: "pesapal",
    reference: "client-ref-1",
    status: "pending",
    status_reason: null,
    amount_ugx: 36_000,
    currency: "UGX",
    created_at: "2026-10-07T10:00:00+00:00",
    confirmed_at: null,
    metadata: {},
    ...overrides,
  };
}

type Deps = Parameters<typeof runInitiateFlow>[0];

function makeDeps(claim: () => Promise<RpcResult>, fake: FakePaymentAdapter, row = makeRow()): Deps {
  return {
    authorize: async () => ({ ok: true }),
    fetchRow: async () => row,
    attach: async () => ({ ok: true, provider_reference: "fake-tx-0001" }),
    fail: async () => ({ ok: true }),
    resolveAdapter: () => fake,
    claim,
    phone: "+256781234567",
    timeoutMs: 500,
  };
}

describe("M3-G initiate claim (runInitiateFlow)", () => {
  it("1. claim granted → provider called exactly once", async () => {
    const fake = new FakePaymentAdapter();
    const r = await runInitiateFlow(makeDeps(async () => ({ ok: true, claimed: true }), fake));
    expect(r.ok).toBe(true);
    expect(fake.initiateCalls).toHaveLength(1);
  });

  it("2. concurrent initiate holds the claim → in_progress, provider NEVER called", async () => {
    const fake = new FakePaymentAdapter();
    const r = await runInitiateFlow(
      makeDeps(async () => ({ ok: true, claimed: false, in_progress: true }), fake),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("initiate_in_progress");
    expect(r.retryable).toBe(true);
    expect(r.status).toBe("pending");
    expect(fake.initiateCalls, "the loser must not start a second provider transaction").toHaveLength(0);
  });

  it("3. attach already recorded (lost race to completion) → idempotent observation, no provider call", async () => {
    const fake = new FakePaymentAdapter();
    const r = await runInitiateFlow(
      makeDeps(
        async () => ({ ok: true, claimed: false, already_initiated: true }),
        fake,
        makeRow({ metadata: { initiated_at: "2026-10-07T10:00:05+00:00" } }),
      ),
    );
    // Row-level idempotency (step 3) already short-circuits; claim must not
    // change that and must never reach the provider.
    expect(r.ok).toBe(true);
    expect(r.already_initiated).toBe(true);
    expect(fake.initiateCalls).toHaveLength(0);
  });

  it("4. claim infrastructure failure → fail closed, provider untouched", async () => {
    const fake = new FakePaymentAdapter();
    const r = await runInitiateFlow(
      makeDeps(async () => ({ ok: false, error: "rpc_failed" }), fake),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("rpc_failed");
    expect(r.retryable).toBe(true);
    expect(fake.initiateCalls).toHaveLength(0);
  });

  it("5. claim denied with a non-pending status observed → surfaced, provider untouched", async () => {
    const fake = new FakePaymentAdapter();
    const r = await runInitiateFlow(
      makeDeps(
        async () => ({ ok: false, error: "payment_not_pending", status: "cancelled" }),
        fake,
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("payment_not_pending");
    expect(fake.initiateCalls).toHaveLength(0);
  });

  it("6. no claim dep (pre-M3-G fixture) → previous behaviour: provider called", async () => {
    const fake = new FakePaymentAdapter();
    const legacy: Deps = { ...makeDeps(async () => ({ ok: true, claimed: true }), fake) };
    delete legacy.claim;
    const r = await runInitiateFlow(legacy);
    expect(r.ok).toBe(true);
    expect(fake.initiateCalls).toHaveLength(1);
  });

  it("7. timeout after a granted claim stays pending and retryable (never fake success)", async () => {
    const fake = new FakePaymentAdapter({ initiateDelayMs: 50, initiateOutcome: undefined });
    const r = await runInitiateFlow({
      ...makeDeps(async () => ({ ok: true, claimed: true }), fake),
      timeoutMs: 1, // force the timeout race
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("initiate_timeout");
    expect(r.retryable).toBe(true);
    expect(r.status).toBe("pending");
  });
});
