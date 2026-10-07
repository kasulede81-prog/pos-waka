/**
 * M3-C — provider-agnostic payment server foundation.
 *
 * Exercises the shared Edge modules directly (they are pure TypeScript with
 * injected dependencies, so node/vitest can run them):
 *   - provider adapter contract + normalization + empty production registry
 *   - payment-initiate flow (authorization-first, ledger-derived values,
 *     idempotent initiation, phone validation, timeout/rejection semantics)
 *   - payment-status flow (recovery through M1 RPCs only)
 *   - callback verification contract (raw body, fail closed, no ledger writes)
 *   - supabase/config.toml verify_jwt posture (no callback endpoints yet)
 *
 * MTN/Airtel are NOT implemented: the registry is empty and the fake adapter
 * is only ever passed directly to flows by these tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getProviderAdapter,
  settlementActionFor,
} from "../../supabase/functions/_shared/payment/adapter.ts";
import type { ProviderAdapter } from "../../supabase/functions/_shared/payment/adapter.ts";
import {
  attachProviderMeta,
  cancelPayment,
  confirmPayment,
  failPayment,
  fetchPaymentRow,
  runInitiateFlow,
  runStatusFlow,
} from "../../supabase/functions/_shared/payment/ledger.ts";
import { verifyCallbackWith } from "../../supabase/functions/_shared/payment/verifyCallback.ts";
import { FakePaymentAdapter } from "../../supabase/functions/_shared/payment/fakeAdapter.ts";
import type { PaymentRow } from "../../supabase/functions/_shared/payment/types.ts";

const PAY_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const SHOP_ID = "44444444-4444-4444-8444-444444444444";
const PHONE = "+256781234567";

function makeRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: PAY_ID,
    subscription_id: SUB_ID,
    organization_id: ORG_ID,
    shop_id: SHOP_ID,
    provider: "mtn_momo",
    reference: "waka-ref-0001",
    status: "pending",
    status_reason: null,
    amount_ugx: 36_000,
    currency: "UGX",
    created_at: "2026-10-07T10:00:00.000Z",
    confirmed_at: null,
    metadata: { created_via: "subscription_payment_create", checkout: { plan_code: "business" } },
    ...overrides,
  };
}

type Recorder = {
  authorizeCalls: number;
  fetchRowCalls: number;
  attachInputs: Array<{ provider_reference: string | null; phone: string }>;
  failReasons: string[];
  confirmCalls: number;
  cancelReasons: string[];
};

function makeRecorder(): Recorder {
  return {
    authorizeCalls: 0,
    fetchRowCalls: 0,
    attachInputs: [],
    failReasons: [],
    confirmCalls: 0,
    cancelReasons: [],
  };
}

/** Shared flow harness: authorize ok + row-backed ledger, all calls recorded. */
function makeInitiateDeps(
  rec: Recorder,
  row: PaymentRow | null,
  adapter: FakePaymentAdapter | null,
  opts: {
    authorizeError?: string;
    attachResult?: { ok: boolean; error?: string; provider_reference?: string | null };
    failResult?: { ok: boolean; error?: string };
    timeoutMs?: number;
  } = {},
) {
  return {
    authorize: async () => {
      rec.authorizeCalls += 1;
      return opts.authorizeError ? { ok: false, error: opts.authorizeError } : { ok: true };
    },
    fetchRow: async () => {
      rec.fetchRowCalls += 1;
      return row;
    },
    attach: async (input: { provider_reference: string | null; phone: string }) => {
      rec.attachInputs.push(input);
      return opts.attachResult ?? { ok: true, provider_reference: input.provider_reference };
    },
    fail: async (reason: string) => {
      rec.failReasons.push(reason);
      return opts.failResult ?? { ok: true, status: "failed" };
    },
    resolveAdapter: () => adapter,
    phone: PHONE,
    timeoutMs: opts.timeoutMs,
  };
}

function makeStatusDeps(
  rec: Recorder,
  row: PaymentRow | null,
  adapter: FakePaymentAdapter | null,
  opts: {
    authorizeError?: string;
    confirmResult?: { ok: boolean; error?: string; status?: string; idempotent?: boolean };
    failResult?: { ok: boolean; error?: string; status?: string };
    cancelResult?: { ok: boolean; error?: string; status?: string };
    timeoutMs?: number;
  } = {},
) {
  return {
    authorize: async () => {
      rec.authorizeCalls += 1;
      return opts.authorizeError ? { ok: false, error: opts.authorizeError } : { ok: true };
    },
    fetchRow: async () => {
      rec.fetchRowCalls += 1;
      return row;
    },
    confirm: async () => {
      rec.confirmCalls += 1;
      return opts.confirmResult ?? { ok: true, status: "confirmed" };
    },
    fail: async (reason: string) => {
      rec.failReasons.push(reason);
      return opts.failResult ?? { ok: true, status: "failed" };
    },
    cancel: async (reason: string) => {
      rec.cancelReasons.push(reason);
      return opts.cancelResult ?? { ok: true, status: "cancelled" };
    },
    resolveAdapter: () => adapter,
    timeoutMs: opts.timeoutMs,
  };
}

describe("M3-C — provider adapter contract", () => {
  it("normalizes the provider status vocabulary into M1 settlement states", () => {
    const fake = new FakePaymentAdapter();
    expect(fake.normalizeStatus("CONFIRMED")).toBe("confirmed");
    expect(fake.normalizeStatus("success")).toBe("confirmed");
    expect(fake.normalizeStatus("FAILED")).toBe("failed");
    expect(fake.normalizeStatus("declined")).toBe("failed");
    expect(fake.normalizeStatus("CANCELLED")).toBe("cancelled");
    expect(fake.normalizeStatus("EXPIRED")).toBe("cancelled");
    expect(fake.normalizeStatus("PENDING")).toBe("pending");
    expect(fake.normalizeStatus("PROCESSING")).toBe("pending");
    expect(fake.normalizeStatus("SOME_FUTURE_STATE")).toBeNull(); // unknown → stay pending
  });

  it("settlementActionFor maps normalized states onto the M1 RPCs", () => {
    expect(settlementActionFor("confirmed")).toEqual({ action: "confirm" });
    expect(settlementActionFor("failed")).toEqual({ action: "fail", reason: "provider_reported_failure" });
    expect(settlementActionFor("cancelled")).toEqual({ action: "cancel", reason: "provider_reported_cancellation" });
    expect(settlementActionFor("pending")).toEqual({ action: "none" });
    expect(settlementActionFor(null)).toEqual({ action: "none" });
  });

  it("production registry is empty — the fake adapter is unreachable from endpoints", () => {
    // payment-initiate/payment-status resolve through this registry; until
    // M3-F/M3-G register real adapters it must resolve to null (fail closed).
    expect(getProviderAdapter("mtn_momo")).toBeNull();
    expect(getProviderAdapter("airtel_money")).toBeNull();
    expect(getProviderAdapter("fake_provider")).toBeNull();
  });
});

describe("M3-C — payment-initiate flow", () => {
  it("initiates with ledger-derived values only and records the linkage", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runInitiateFlow(makeInitiateDeps(rec, makeRow(), fake));

    expect(result.ok).toBe(true);
    expect(result.payment_id).toBe(PAY_ID);
    expect(result.status).toBe("pending");
    expect(result.provider_reference).toBe("fake-tx-0001");

    // EXACTLY the ledger-derived primitives — nothing client-authored.
    expect(fake.initiateCalls).toHaveLength(1);
    expect(fake.initiateCalls[0]).toEqual({
      reference: "waka-ref-0001",
      amountUgx: 36_000,
      currency: "UGX",
      phone: PHONE,
    });
    expect(rec.attachInputs).toEqual([{ provider_reference: "fake-tx-0001", phone: PHONE }]);
    expect(rec.failReasons).toEqual([]);
  });

  it("the flow's client-facing input surface carries no monetary fields", () => {
    const rec = makeRecorder();
    const deps = makeInitiateDeps(rec, makeRow(), new FakePaymentAdapter());
    // The only client-controlled values are payment identity (via authorize/
    // fetchRow) and phone — amount/currency/plan/shop/org cannot be passed in.
    expect(Object.keys(deps).sort()).toEqual(
      [
        "attach",
        "authorize",
        "fail",
        "fetchRow",
        "phone",
        "resolveAdapter",
        "timeoutMs",
      ].sort(),
    );
    expect(deps.phone).toBe(PHONE);
  });

  it("fails closed on a foreign payment before touching the ledger", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow(), fake, { authorizeError: "payment_not_found" }),
    );
    expect(result).toEqual({ ok: false, error: "payment_not_found" });
    expect(rec.fetchRowCalls).toBe(0);
    expect(fake.initiateCalls).toHaveLength(0);
  });

  it("refuses to initiate a terminal payment", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow({ status: "confirmed" }), fake),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("payment_not_pending");
    expect(result.status).toBe("confirmed");
    expect(fake.initiateCalls).toHaveLength(0);
    expect(rec.attachInputs).toHaveLength(0);
  });

  it("is idempotent once initiation is recorded — no second provider transaction", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const row = makeRow({
      metadata: {
        created_via: "subscription_payment_create",
        initiated_at: "2026-10-07T10:05:00.000Z",
        initiated_via: "payment_initiate",
        provider_reference: "prov-777",
        phone: PHONE,
      },
    });
    const result = await runInitiateFlow(makeInitiateDeps(rec, row, fake));
    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.already_initiated).toBe(true);
    expect(result.provider_reference).toBe("prov-777");
    expect(fake.initiateCalls).toHaveLength(0); // never re-initiated
    expect(rec.attachInputs).toHaveLength(0);
  });

  it("validates the phone (E.164) before any provider call", async () => {
    for (const bad of ["0771234567", "256781234567", "not-a-phone", "+0123456", ""]) {
      const rec = makeRecorder();
      const fake = new FakePaymentAdapter();
      const deps = makeInitiateDeps(rec, makeRow(), fake);
      const result = await runInitiateFlow({ ...deps, phone: bad });
      expect(result.ok, bad).toBe(false);
      expect(result.error).toBe("invalid_phone");
      expect(fake.initiateCalls).toHaveLength(0);
    }
    const ok = await runInitiateFlow(makeInitiateDeps(makeRecorder(), makeRow(), new FakePaymentAdapter()));
    expect(ok.ok).toBe(true);
  });

  it("requires a provider reference on the intent", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow({ reference: null }), fake),
    );
    expect(result.error).toBe("reference_missing");
    expect(fake.initiateCalls).toHaveLength(0);
  });

  it("fails closed with provider_not_configured while the registry is empty", async () => {
    const rec = makeRecorder();
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow(), null, {}),
    );
    // resolveAdapter returns null (no provider registered in M3-C).
    expect(result.ok).toBe(false);
    expect(result.error).toBe("provider_not_configured");
    expect(result.status).toBe("pending");
    expect(rec.attachInputs).toHaveLength(0);
    expect(rec.failReasons).toHaveLength(0);
  });

  it("definite provider rejection fails the payment with status_reason provider_error", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({
      initiateOutcome: { ok: false, error: "invalidMSISDN", retryable: false },
    });
    const result = await runInitiateFlow(makeInitiateDeps(rec, makeRow(), fake));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("provider_rejected");
    expect(result.status).toBe("failed");
    expect(rec.failReasons).toEqual(["provider_error"]);
    expect(rec.attachInputs).toHaveLength(0);
  });

  it("retryable provider errors leave the payment pending", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({
      initiateOutcome: { ok: false, error: "provider_busy", retryable: true },
    });
    const result = await runInitiateFlow(makeInitiateDeps(rec, makeRow(), fake));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("provider_busy");
    expect(result.status).toBe("pending");
    expect(result.retryable).toBe(true);
    expect(rec.failReasons).toHaveLength(0);
  });

  it("timeout leaves the payment pending — never auto-failed", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ initiateDelayMs: 3_000 });
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow(), fake, { timeoutMs: 25 }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("initiate_timeout");
    expect(result.status).toBe("pending");
    expect(result.retryable).toBe(true);
    expect(rec.failReasons).toHaveLength(0);
    expect(rec.attachInputs).toHaveLength(0);
  });

  it("a thrown transport error leaves the payment pending", async () => {
    const throwingAdapter: ProviderAdapter = {
      id: "mtn_momo",
      isConfigured: () => true,
      initiate: () => Promise.reject(new Error("socket hang up")),
      queryStatus: () => Promise.resolve({ ok: true, rawStatus: "PENDING" }),
      verifyCallback: () =>
        Promise.resolve({ ok: true as const, reference: "r", rawStatus: "CONFIRMED" }),
      normalizeStatus: () => null,
    };
    const rec = makeRecorder();
    const result = await runInitiateFlow({
      ...makeInitiateDeps(rec, makeRow(), null),
      resolveAdapter: () => throwingAdapter,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("provider_unavailable");
    expect(result.status).toBe("pending");
    expect(rec.failReasons).toHaveLength(0);
  });

  it("attach failure never fails the payment (money may be in flight)", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runInitiateFlow(
      makeInitiateDeps(rec, makeRow(), fake, {
        attachResult: { ok: false, error: "rpc_failed" },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("attach_failed");
    expect(result.status).toBe("pending");
    expect(rec.failReasons).toHaveLength(0); // recovery = payment-status, not fail
  });

  it("accepts a provider that issues no provider reference", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ initiateOutcome: { ok: true, providerReference: null } });
    const result = await runInitiateFlow(makeInitiateDeps(rec, makeRow(), fake));
    expect(result.ok).toBe(true);
    expect(result.provider_reference).toBeNull();
    expect(rec.attachInputs).toEqual([{ provider_reference: null, phone: PHONE }]);
  });
});

describe("M3-C — payment-status flow", () => {
  it("confirmed: queries the provider and settles through confirmPayment", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "CONFIRMED" });
    const row = makeRow({
      metadata: { initiated_at: "2026-10-07T10:05:00.000Z", provider_reference: "prov-1" },
    });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(rec.confirmCalls).toBe(1);
    expect(rec.failReasons).toEqual([]);
    expect(rec.cancelReasons).toEqual([]);
    expect(fake.queryCalls[0]).toEqual({ reference: "waka-ref-0001", providerReference: "prov-1" });
  });

  it("failed: settles through failPayment with a normalized reason", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "DECLINED" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.status).toBe("failed");
    expect(rec.failReasons).toEqual(["provider_reported_failure"]);
    expect(rec.confirmCalls).toBe(0);
  });

  it("cancelled/expired: settles through cancelPayment", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "EXPIRED" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.status).toBe("cancelled");
    expect(rec.cancelReasons).toEqual(["provider_reported_cancellation"]);
    expect(rec.confirmCalls).toBe(0);
  });

  it("unknown provider status leaves the ledger untouched", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "SOME_FUTURE_STATE" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.provider_status).toBe("SOME_FUTURE_STATE");
    expect(rec.confirmCalls + rec.failReasons.length + rec.cancelReasons.length).toBe(0);
  });

  it("still-pending provider status leaves the ledger untouched", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "PENDING" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.provider_status).toBe("PENDING");
    expect(rec.confirmCalls + rec.failReasons.length + rec.cancelReasons.length).toBe(0);
  });

  it("terminal payment: returns ledger state without querying the provider", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "CONFIRMED" });
    const row = makeRow({ status: "refunded", status_reason: "requested" });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("refunded");
    expect(result.status_reason).toBe("requested");
    expect(fake.queryCalls).toHaveLength(0); // provider untouched
    expect(rec.confirmCalls).toBe(0);
  });

  it("fails closed on a foreign payment before touching the ledger", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runStatusFlow(
      makeStatusDeps(rec, makeRow(), fake, { authorizeError: "payment_not_found" }),
    );
    expect(result).toEqual({ ok: false, error: "payment_not_found" });
    expect(rec.fetchRowCalls).toBe(0);
    expect(fake.queryCalls).toHaveLength(0);
  });

  it("refuses to query a payment that was never initiated", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter();
    const result = await runStatusFlow(makeStatusDeps(rec, makeRow(), fake));
    expect(result.error).toBe("not_initiated");
    expect(result.status).toBe("pending");
    expect(fake.queryCalls).toHaveLength(0);
  });

  it("provider query failure leaves the ledger untouched", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({
      queryOutcome: { ok: false, error: "provider_down" },
    });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, fake));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("provider_down");
    expect(result.status).toBe("pending");
    expect(result.retryable).toBe(true);
    expect(rec.confirmCalls + rec.failReasons.length + rec.cancelReasons.length).toBe(0);
  });

  it("provider query timeout leaves the ledger untouched", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryDelayMs: 3_000 });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(
      makeStatusDeps(rec, row, fake, { timeoutMs: 25 }),
    );
    expect(result.error).toBe("provider_query_timeout");
    expect(result.status).toBe("pending");
    expect(rec.confirmCalls).toBe(0);
  });

  it("a refused settlement surfaces the error and the true ledger state", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "CONFIRMED" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(
      makeStatusDeps(rec, row, fake, {
        confirmResult: { ok: false, error: "subscription_conflict" },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("subscription_conflict");
    expect(result.status).toBe("pending"); // re-read: nothing changed
    expect(rec.fetchRowCalls).toBe(2); // initial + post-failure truth check
  });

  it("duplicate status calls settle exactly once (callback/status race)", async () => {
    const rec = makeRecorder();
    const fake = new FakePaymentAdapter({ queryRawStatus: "CONFIRMED" });
    const row = makeRow({ metadata: { initiated_at: "t" } });
    // First call settles and flips the ledger row (as the M1 confirm would).
    const confirmResult = async () => {
      rec.confirmCalls += 1;
      row.status = "confirmed";
      row.confirmed_at = "2026-10-07T11:00:00.000Z";
      return { ok: true, status: "confirmed" };
    };
    const deps = makeStatusDeps(rec, row, fake);
    const first = await runStatusFlow({ ...deps, confirm: confirmResult });
    expect(first.ok).toBe(true);
    expect(first.status).toBe("confirmed");

    const second = await runStatusFlow({ ...deps, confirm: confirmResult });
    expect(second.ok).toBe(true);
    expect(second.status).toBe("confirmed");
    expect(rec.confirmCalls).toBe(1); // settled exactly once
    expect(fake.queryCalls).toHaveLength(1); // second call never reached the provider
  });

  it("fails closed when no provider is configured", async () => {
    const rec = makeRecorder();
    const row = makeRow({ metadata: { initiated_at: "t" } });
    const result = await runStatusFlow(makeStatusDeps(rec, row, null));
    expect(result.error).toBe("provider_not_configured");
    expect(result.status).toBe("pending");
  });
});

describe("M3-C — callback verification contract", () => {
  it("verifies the RAW body and passes the result through untouched", async () => {
    const raw = '{"event":"payment","id":"abc"}'; // exact bytes, no re-format
    const headers = { "x-signature": "sig-1" };
    const fake = new FakePaymentAdapter({
      callbackReference: "waka-ref-0001",
      callbackRawStatus: "CONFIRMED",
    });
    const result = await verifyCallbackWith(fake, { rawBody: raw, headers });
    expect(result).toEqual({
      ok: true,
      reference: "waka-ref-0001",
      rawStatus: "CONFIRMED",
    });
    expect(fake.verifyCalls[0]!.rawBody).toBe(raw); // byte-identical
    expect(fake.verifyCalls[0]!.headers).toEqual(headers);
  });

  it("rejects an invalid signature before any settlement decision", async () => {
    const fake = new FakePaymentAdapter({ callbackShouldFail: true });
    const result = await verifyCallbackWith(fake, { rawBody: "{}", headers: {} });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe("bad_signature");
  });

  it("treats a throwing verifier as a failed verification (fail closed)", async () => {
    const throwing: ProviderAdapter = {
      id: "mtn_momo",
      isConfigured: () => true,
      initiate: () => Promise.resolve({ ok: true as const }),
      queryStatus: () => Promise.resolve({ ok: true as const, rawStatus: "PENDING" }),
      verifyCallback: () => Promise.reject(new Error("boom")),
      normalizeStatus: () => null,
    };
    const result = await verifyCallbackWith(throwing, { rawBody: "{}", headers: {} });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe("verification_failed");
  });

  it("rejects empty bodies and callbacks without a payment reference", async () => {
    const empty = await verifyCallbackWith(new FakePaymentAdapter(), {
      rawBody: "",
      headers: {},
    });
    expect(empty.ok).toBe(false);
    if (empty.ok === false) expect(empty.error).toBe("empty_callback_body");

    const noRef = await verifyCallbackWith(
      new FakePaymentAdapter({ callbackReference: "" }),
      { rawBody: "{}", headers: {} },
    );
    expect(noRef.ok).toBe(false);
    if (noRef.ok === false) expect(noRef.error).toBe("callback_missing_reference");
  });

  it("a verified callback maps onto settlement without any ledger dependency", async () => {
    const fake = new FakePaymentAdapter({ callbackRawStatus: "SUCCESS" });
    const verified = await verifyCallbackWith(fake, { rawBody: "{}", headers: {} });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      const action = settlementActionFor(fake.normalizeStatus(verified.rawStatus));
      expect(action).toEqual({ action: "confirm" });
    }
  });
});

describe("M3-C — M1 RPC argument wrappers", () => {
  const captured: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpcClient = {
    rpc: (name: string, args: Record<string, unknown>) => {
      captured.push({ name, args });
      return Promise.resolve({ data: { ok: true, status: "confirmed" }, error: null });
    },
  };

  it("routes attach/confirm/fail/cancel to the exact M1/M3-C RPCs", async () => {
    captured.length = 0;
    await attachProviderMeta(rpcClient, {
      payment_id: PAY_ID,
      provider_reference: "prov-1",
      phone: PHONE,
    });
    await confirmPayment(rpcClient, PAY_ID);
    await failPayment(rpcClient, PAY_ID, "provider_error");
    await cancelPayment(rpcClient, PAY_ID, "provider_reported_cancellation");

    expect(captured.map((c) => c.name)).toEqual([
      "subscription_payment_provider_attach",
      "subscription_payment_confirm",
      "subscription_payment_fail",
      "subscription_payment_cancel",
    ]);
    expect(captured[0]!.args).toEqual({
      p_payment_id: PAY_ID,
      p_provider_reference: "prov-1",
      p_phone: PHONE,
      p_initiated_at: null,
    });
    expect(captured[2]!.args).toEqual({ p_payment_id: PAY_ID, p_reason: "provider_error" });
  });

  it("fetchPaymentRow maps the ledger row (server-only metadata included)", async () => {
    const fakeQuery = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: PAY_ID,
                  subscription_id: SUB_ID,
                  organization_id: ORG_ID,
                  shop_id: SHOP_ID,
                  provider: "mtn_momo",
                  reference: "waka-ref-0001",
                  status: "pending",
                  status_reason: null,
                  amount_ugx: 36000,
                  currency: "UGX",
                  created_at: "2026-10-07T10:00:00.000Z",
                  confirmed_at: null,
                  metadata: { phone: PHONE },
                },
                error: null,
              }),
          }),
        }),
      }),
    };
    const row = await fetchPaymentRow(fakeQuery, PAY_ID);
    expect(row).not.toBeNull();
    expect(row!.amount_ugx).toBe(36_000);
    expect(row!.metadata.phone).toBe(PHONE);

    const missingQuery = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    };
    const missing = await fetchPaymentRow(missingQuery, PAY_ID);
    expect(missing).toBeNull();
  });
});

describe("M3-C — configuration posture", () => {
  const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

  it("payment-initiate and payment-status are authenticated endpoints", () => {
    const initiate = config.split("[functions.payment-initiate]")[1];
    const status = config.split("[functions.payment-status]")[1];
    expect(initiate, "payment-initiate missing from config.toml").toBeTruthy();
    expect(status, "payment-status missing from config.toml").toBeTruthy();
    expect(initiate!.split("[functions")[0]).toContain("verify_jwt = true");
    expect(status!.split("[functions")[0]).toContain("verify_jwt = true");
  });

  it("no provider callback endpoints are configured yet", () => {
    expect(config).not.toContain("[functions.payment-callback");
    expect(config).not.toContain("[functions.payment-webhook");
  });

  it("no provider credentials exist as browser-visible VITE_ variables", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(envExample).not.toMatch(/VITE_(MTN|AIRTEL|FLUTTERWAVE|STRIPE)/i);
  });
});
