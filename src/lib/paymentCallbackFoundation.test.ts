/**
 * M3-E — generic callback settlement core (provider-agnostic).
 *
 * Exercises `runCallbackSettlement` end-to-end with a local test verifier
 * (no MTN/Airtel code, no credentials): raw-body verification before any
 * ledger lookup, deterministic response taxonomy, amount/currency
 * cross-checks against the immutable ledger, settlement exclusively through
 * the injected M1 RPC wrappers, Option A reconciliation signals for
 * charged-but-unsettled cases, and no raw payload echo/persistence.
 *
 * The real ledger-once guarantees (replay ×100, exactly one period advance)
 * are proven against the real SQL RPCs in
 * subscriptionStaleReplaceGuard.sql.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settlementActionFor } from "../../supabase/functions/_shared/payment/adapter.ts";
import type { ProviderAdapter } from "../../supabase/functions/_shared/payment/adapter.ts";
import {
  runCallbackSettlement,
  type CallbackSettleDeps,
  type LookupOutcome,
  type RpcResultLike,
} from "../../supabase/functions/_shared/payment/callbackSettle.ts";
import type {
  CallbackRequest,
  VerifiedCallback,
} from "../../supabase/functions/_shared/payment/types.ts";

type VerifierConfig = {
  reference?: string;
  rawStatus?: string;
  failSignature?: boolean;
  throwOnVerify?: boolean;
  amountUgx?: number;
  currency?: string;
};

/** Local test verifier — full control over what a "provider" claims. */
class TestVerifierAdapter implements ProviderAdapter {
  readonly id = "mtn_momo";
  verifyCalls: CallbackRequest[] = [];
  private cfg: VerifierConfig;

  constructor(cfg: VerifierConfig = {}) {
    this.cfg = cfg;
  }

  isConfigured(): boolean {
    return true;
  }

  initiate(): Promise<never> {
    return Promise.reject(new Error("not used by callbacks"));
  }

  queryStatus(): Promise<never> {
    return Promise.reject(new Error("not used by callbacks"));
  }

  async verifyCallback(req: CallbackRequest): Promise<VerifiedCallback> {
    this.verifyCalls.push({ rawBody: req.rawBody, headers: { ...req.headers } });
    if (this.cfg.throwOnVerify) throw new Error("verifier exploded");
    if (this.cfg.failSignature) return { ok: false, error: "bad_signature" };
    const result: Extract<VerifiedCallback, { ok: true }> = {
      ok: true,
      reference: this.cfg.reference ?? "waka-ref-0001",
      rawStatus: this.cfg.rawStatus ?? "CONFIRMED",
    };
    if (this.cfg.amountUgx !== undefined) result.reportedAmountUgx = this.cfg.amountUgx;
    if (this.cfg.currency !== undefined) result.reportedCurrency = this.cfg.currency;
    return result;
  }

  normalizeStatus(rawStatus: string): "pending" | "confirmed" | "failed" | "cancelled" | null {
    const s = rawStatus.trim().toUpperCase();
    if (s === "CONFIRMED" || s === "SUCCESS") return "confirmed";
    if (s === "FAILED" || s === "DECLINED") return "failed";
    if (s === "CANCELLED" || s === "EXPIRED") return "cancelled";
    if (s === "PENDING") return "pending";
    return null;
  }
}

type Rec = {
  lookupCalls: Array<[string, string]>;
  confirmIds: string[];
  failCalls: Array<[string, string]>;
  cancelCalls: Array<[string, string]>;
  emits: string[];
};

function makeRec(): Rec {
  return { lookupCalls: [], confirmIds: [], failCalls: [], cancelCalls: [], emits: [] };
}

type DepsOptions = {
  adapter?: ProviderAdapter | null;
  lookupResult?: LookupOutcome;
  confirmResult?: RpcResultLike;
  failResult?: RpcResultLike;
  cancelResult?: RpcResultLike;
  method?: string;
  rawBody?: string;
  headers?: Record<string, string>;
  provider?: string;
  rateLimit?: CallbackSettleDeps["rateLimit"];
  maxBodyBytes?: number;
};

function makeDeps(rec: Rec, opts: DepsOptions = {}): CallbackSettleDeps {
  return {
    provider: opts.provider ?? "mtn_momo",
    method: opts.method ?? "POST",
    rawBody: opts.rawBody ?? '{"event":"payment","reference":"waka-ref-0001"}',
    headers: opts.headers ?? { "x-signature": "sig-1" },
    adapter: opts.adapter === undefined ? new TestVerifierAdapter() : opts.adapter,
    lookup: async (provider, reference) => {
      rec.lookupCalls.push([provider, reference]);
      return opts.lookupResult ?? {
        ok: true,
        payment_id: "pay-lookup",
        status: "pending",
        amount_ugx: 36_000,
        currency: "UGX",
        reference: "waka-ref-0001",
      };
    },
    confirm: async (paymentId) => {
      rec.confirmIds.push(paymentId);
      return opts.confirmResult ?? { ok: true, status: "confirmed" };
    },
    fail: async (paymentId, reason) => {
      rec.failCalls.push([paymentId, reason]);
      return opts.failResult ?? { ok: true, status: "failed" };
    },
    cancel: async (paymentId, reason) => {
      rec.cancelCalls.push([paymentId, reason]);
      return opts.cancelResult ?? { ok: true, status: "cancelled" };
    },
    rateLimit: opts.rateLimit,
    maxBodyBytes: opts.maxBodyBytes,
  };
}

function settleSettledNothing(rec: Rec): boolean {
  return rec.confirmIds.length + rec.failCalls.length + rec.cancelCalls.length === 0;
}

function emittedReasons(rec: Rec): string[] {
  return rec.emits.map((line) => {
    const json = line.replace(/^\[payment-callback\] /, "");
    return String((JSON.parse(json) as { reason?: string }).reason ?? "");
  });
}

describe("M3-E — callback settlement core", () => {
  let rec: Rec;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rec = makeRec();
    errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      rec.emits.push(String(args[0]));
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("T1 valid callback confirms exactly through the M1 wrapper", async () => {
    const result = await runCallbackSettlement(makeDeps(rec));
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      reason: "confirmed",
      payment_id: "pay-lookup",
      status: "confirmed",
      provider_status: "CONFIRMED",
    });
    expect(rec.lookupCalls).toEqual([["mtn_momo", "waka-ref-0001"]]);
    expect(rec.confirmIds).toEqual(["pay-lookup"]);
  });

  it("T2 invalid signature → 401 before ANY ledger lookup or settlement", async () => {
    const adapter = new TestVerifierAdapter({ failSignature: true });
    const result = await runCallbackSettlement(makeDeps(rec, { adapter }));
    expect(result.httpStatus).toBe(401);
    expect(result.body).toEqual({ ok: false, reason: "invalid_signature" });
    expect(rec.lookupCalls).toEqual([]);
    expect(settleSettledNothing(rec)).toBe(true);
    expect(adapter.verifyCalls).toHaveLength(1); // raw body handed over first
    expect(emittedReasons(rec)).toContain("invalid_signature");
  });

  it("T3 a throwing verifier fails closed as a signature failure", async () => {
    const adapter = new TestVerifierAdapter({ throwOnVerify: true });
    const result = await runCallbackSettlement(makeDeps(rec, { adapter }));
    expect(result.httpStatus).toBe(401);
    expect(result.body.reason).toBe("invalid_signature");
    expect(rec.lookupCalls).toEqual([]);
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T4 empty body is rejected before verification", async () => {
    const result = await runCallbackSettlement(makeDeps(rec, { rawBody: "" }));
    expect(result.httpStatus).toBe(400);
    expect(result.body).toEqual({ ok: false, reason: "invalid_callback" });
    expect(rec.lookupCalls).toEqual([]);
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T5 oversized body → 413 before any verification or lookup", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { rawBody: "x".repeat(65), maxBodyBytes: 64 }),
    );
    expect(result.httpStatus).toBe(413);
    expect(result.body).toEqual({ ok: false, reason: "invalid_callback" });
    expect(rec.lookupCalls).toEqual([]);
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T6 verified-but-malformed callbacks (missing reference/status) → 400", async () => {
    const noRef = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ reference: "" }) }),
    );
    expect(noRef.httpStatus).toBe(400);
    expect(noRef.body.reason).toBe("invalid_callback");

    const noStatus = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ rawStatus: "" }) }),
    );
    expect(noStatus.httpStatus).toBe(400);
    expect(noStatus.body.reason).toBe("invalid_callback");
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T7 non-POST is rejected", async () => {
    const result = await runCallbackSettlement(makeDeps(rec, { method: "GET" }));
    expect(result.httpStatus).toBe(405);
    expect(result.body.reason).toBe("invalid_callback");
    expect(rec.lookupCalls).toEqual([]);
  });

  it("T8 unknown reference → 200 unknown_reference, nothing created or settled", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { lookupResult: { ok: false, error: "payment_not_found" } }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "unknown_reference" });
    expect(result.body).not.toHaveProperty("payment_id");
    // The core has no create path at all; lookup is read-only; no settlement.
    expect(settleSettledNothing(rec)).toBe(true);
    expect(emittedReasons(rec)).toContain("unknown_reference");
  });

  it("T9 callback amount mismatch → no settlement", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ amountUgx: 1_000 }) }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("amount_mismatch");
    expect(settleSettledNothing(rec)).toBe(true);
    expect(emittedReasons(rec)).toContain("amount_mismatch");
  });

  it("T10 matching amount settles; matching currency settles", async () => {
    const amountOk = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ amountUgx: 36_000, currency: "UGX" }) }),
    );
    expect(amountOk.httpStatus).toBe(200);
    expect(amountOk.body.reason).toBe("confirmed");

    const currencyMismatch = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ amountUgx: 36_000, currency: "USD" }) }),
    );
    expect(currencyMismatch.httpStatus).toBe(200);
    expect(currencyMismatch.body.reason).toBe("amount_mismatch");
    expect(rec.confirmIds).toHaveLength(1); // only the matching one settled
  });

  it("T11 a provider that supplies no amounts settles (PROVIDER DOCUMENTATION REQUIRED path)", async () => {
    const result = await runCallbackSettlement(makeDeps(rec));
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("confirmed");
    expect(rec.confirmIds).toEqual(["pay-lookup"]);
  });

  it("T12 duplicate success responses surface idempotency without double settlement logic", async () => {
    const first = await runCallbackSettlement(makeDeps(rec));
    const second = await runCallbackSettlement(
      makeDeps(rec, { confirmResult: { ok: true, status: "confirmed", idempotent: true } }),
    );
    expect(first.body.reason).toBe("confirmed");
    expect(second.body.reason).toBe("confirmed");
    expect(second.body.idempotent).toBe(true);
    // Ledger-side exactly-once is proven by the SQL replay ×100 test.
  });

  it("T13 duplicate failure response", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, {
        adapter: new TestVerifierAdapter({ rawStatus: "DECLINED" }),
        failResult: { ok: true, status: "failed", idempotent: true },
      }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("failed");
    expect(result.body.idempotent).toBe(true);
    expect(rec.failCalls).toEqual([["pay-lookup", "provider_reported_failure"]]);
  });

  it("T14 success then failure: the failure leg is refused and classified", async () => {
    await runCallbackSettlement(makeDeps(rec)); // success
    const after = await runCallbackSettlement(
      makeDeps(rec, {
        adapter: new TestVerifierAdapter({ rawStatus: "DECLINED" }),
        failResult: { ok: false, error: "payment_not_confirmable" },
      }),
    );
    expect(after.httpStatus).toBe(200);
    expect(after.body.reason).toBe("settle_refused");
    expect(after.body.error).toBe("payment_not_confirmable");
    expect(emittedReasons(rec)).toContain("settle_refused");
  });

  it("T15 failure then success: provider success on a terminal payment → stale_success", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, {
        lookupResult: {
          ok: true,
          payment_id: "pay-failed",
          status: "failed",
          amount_ugx: 36_000,
          currency: "UGX",
        },
        confirmResult: { ok: false, error: "payment_not_confirmable" },
      }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("stale_success");
    expect(result.body.payment_id).toBe("pay-failed");
    expect(rec.failCalls).toEqual([]);
    expect(rec.cancelCalls).toEqual([]);
    expect(emittedReasons(rec)).toContain("stale_success");
  });

  it("T16 cancellation callback settles through cancel", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ rawStatus: "EXPIRED" }) }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("cancelled");
    expect(rec.cancelCalls).toEqual([["pay-lookup", "provider_reported_cancellation"]]);
    expect(rec.confirmIds).toEqual([]);
  });

  it("T17 pending provider status leaves the ledger untouched", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ rawStatus: "PENDING" }) }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      reason: "pending",
      payment_id: "pay-lookup",
      status: "pending",
      provider_status: "PENDING",
    });
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T18 unknown provider status leaves the ledger untouched", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { adapter: new TestVerifierAdapter({ rawStatus: "FUTURE_STATE_X" }) }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("pending");
    expect(result.body.provider_status).toBe("FUTURE_STATE_X");
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T19 stale/cancelled payment receiving success → stale_success, no state change", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, {
        lookupResult: {
          ok: true,
          payment_id: "pay-cancelled",
          status: "cancelled",
          amount_ugx: 36_000,
          currency: "UGX",
        },
        confirmResult: { ok: false, error: "payment_not_confirmable" },
      }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "stale_success",
      payment_id: "pay-cancelled",
    });
    expect(rec.failCalls).toEqual([]);
    expect(rec.cancelCalls).toEqual([]);
    expect(emittedReasons(rec)).toContain("stale_success");
  });

  it("T20 late success after an initiate timeout still settles by our reference", async () => {
    // After initiate_timeout the payment is pending with no initiated marker;
    // a later provider success resolves purely by (provider, reference).
    const result = await runCallbackSettlement(makeDeps(rec));
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("confirmed");
    expect(rec.lookupCalls).toEqual([["mtn_momo", "waka-ref-0001"]]);
  });

  it("T21 cross-payment confusion: only our reference is looked up; payment_id comes from the ledger", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, {
        // A hostile body claiming another payment id — never parsed, never trusted.
        rawBody: '{"payment_id":"pay-EVIL","amount":1,"status":"confirmed"}',
        lookupResult: {
          ok: true,
          payment_id: "pay-from-ledger",
          status: "pending",
          amount_ugx: 36_000,
          currency: "UGX",
        },
      }),
    );
    expect(result.httpStatus).toBe(200);
    expect(rec.lookupCalls).toEqual([["mtn_momo", "waka-ref-0001"]]);
    expect(rec.confirmIds).toEqual(["pay-from-ledger"]);
    expect(rec.confirmIds).not.toContain("pay-EVIL");
  });

  it("T22 the same reference is resolved per provider", async () => {
    await runCallbackSettlement(makeDeps(rec, { provider: "airtel_money" }));
    expect(rec.lookupCalls).toEqual([["airtel_money", "waka-ref-0001"]]);
  });

  it("T23 raw payloads and headers are never echoed back", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, {
        rawBody: '{"secret":"RAW_PAYLOAD_MARKER"}',
        headers: { authorization: "Bearer HEADER_SECRET_MARKER" },
        lookupResult: { ok: false, error: "payment_not_found" },
      }),
    );
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("RAW_PAYLOAD_MARKER");
    expect(serialized).not.toContain("HEADER_SECRET_MARKER");
    // And no raw persistence hook exists: the core never received a place to write it.
    expect(Object.keys(result.body).sort()).toEqual(["ok", "reason"]);
  });

  it("T24 settlement transport failure → 500 with sanitized error only", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { confirmResult: { ok: false, error: "raw database exploded text" } }),
    );
    expect(result.httpStatus).toBe(500);
    expect(result.body.reason).toBe("settle_refused");
    expect(result.body.error).toBe("rpc_failed");
    expect(JSON.stringify(result.body)).not.toContain("exploded");
  });

  it("T25 subscription_conflict is settle_refused (payment stays recoverable)", async () => {
    const result = await runCallbackSettlement(
      makeDeps(rec, { confirmResult: { ok: false, error: "subscription_conflict" } }),
    );
    expect(result.httpStatus).toBe(200);
    expect(result.body.reason).toBe("settle_refused");
    expect(result.body.error).toBe("subscription_conflict");
    expect(emittedReasons(rec)).toContain("settle_refused");
  });

  it("T26 provider not configured fails closed", async () => {
    const result = await runCallbackSettlement(makeDeps(rec, { adapter: null }));
    expect(result.httpStatus).toBe(503);
    expect(result.body).toEqual({ ok: false, reason: "provider_not_configured" });
    expect(rec.lookupCalls).toEqual([]);
    expect(settleSettledNothing(rec)).toBe(true);
  });

  it("T27 rate limit rejects before verification when wired", async () => {
    const adapter = new TestVerifierAdapter();
    const denied = await runCallbackSettlement(
      makeDeps(rec, {
        adapter,
        rateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }),
      }),
    );
    expect(denied.httpStatus).toBe(429);
    expect(denied.body.reason).toBe("rate_limited");
    expect(adapter.verifyCalls).toHaveLength(0); // cheapest check first
    expect(rec.lookupCalls).toEqual([]);

    const allowed = await runCallbackSettlement(
      makeDeps(rec, { rateLimit: async (key) => {
        rec.lookupCalls.push(["rate", key]); // reuse recorder to prove invocation
        return { allowed: true };
      } }),
    );
    expect(allowed.httpStatus).toBe(200);
    expect(rec.lookupCalls[0]).toEqual(["rate", "payment_callback:mtn_momo"]);
  });

  it("T28 the core's dependency surface exposes no table-write capability", () => {
    const deps = makeDeps(rec);
    expect(Object.keys(deps).sort()).toEqual(
      [
        "adapter",
        "cancel",
        "confirm",
        "fail",
        "headers",
        "lookup",
        "maxBodyBytes",
        "method",
        "provider",
        "rateLimit",
        "rawBody",
      ].sort(),
    );
    // Settlement is exclusively via the injected M1 RPC wrappers.
    expect(typeof deps.confirm).toBe("function");
    expect(typeof deps.fail).toBe("function");
    expect(typeof deps.cancel).toBe("function");
  });

  it("T29 settlementActionFor mapping is shared with payment-status (M3-C)", () => {
    expect(settlementActionFor("confirmed")).toEqual({ action: "confirm" });
    expect(settlementActionFor("failed")).toEqual({ action: "fail", reason: "provider_reported_failure" });
    expect(settlementActionFor("cancelled")).toEqual({ action: "cancel", reason: "provider_reported_cancellation" });
    expect(settlementActionFor(null)).toEqual({ action: "none" });
  });
});

describe("M3-E — configuration posture", () => {
  const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");

  it("T30 callback endpoints are verify_jwt = false; initiate/status stay true", () => {
    const mtn = config.split("[functions.payment-callback-mtnmomo]")[1];
    const airtel = config.split("[functions.payment-callback-airtelmoney]")[1];
    const initiate = config.split("[functions.payment-initiate]")[1];
    const status = config.split("[functions.payment-status]")[1];
    expect(mtn, "mtnmomo callback missing").toBeTruthy();
    expect(airtel, "airtelmoney callback missing").toBeTruthy();
    expect(mtn!.split("[functions")[0]).toContain("verify_jwt = false");
    expect(airtel!.split("[functions")[0]).toContain("verify_jwt = false");
    expect(initiate!.split("[functions")[0]).toContain("verify_jwt = true");
    expect(status!.split("[functions")[0]).toContain("verify_jwt = true");
  });

  it("T31 no provider credentials exist as browser-visible VITE_ variables", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(envExample).not.toMatch(/VITE_(MTN|AIRTEL|FLUTTERWAVE|STRIPE)/i);
  });
});
