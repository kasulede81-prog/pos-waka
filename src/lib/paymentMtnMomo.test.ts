import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProviderAdapter,
  settlementActionFor,
} from "../../supabase/functions/_shared/payment/adapter.ts";
import { runCallbackSettlement, type LookupOutcome } from "../../supabase/functions/_shared/payment/callbackSettle.ts";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  runInitiateFlow,
  type InitiateFlowDeps,
} from "../../supabase/functions/_shared/payment/ledger.ts";
import type { PaymentRow } from "../../supabase/functions/_shared/payment/types.ts";
import {
  createMtnMomoAdapter,
  mtnMomoAdapter,
  MTN_MOMO_SECRETS,
  MTN_REQUESTTOPAY_TIMEOUT_MS,
  MTN_TOKEN_TIMEOUT_MS,
} from "../../supabase/functions/_shared/payment/providers/mtnMomo.ts";
import type { MtnMomoAdapterDeps } from "../../supabase/functions/_shared/payment/providers/mtnMomo.ts";

/**
 * MTN MoMo SANDBOX adapter tests — official momodeveloper contract, all
 * provider HTTP mocked (no real MTN API traffic, no credentials).
 *
 * Covers: token generation (+ caching), RequestToPay shape/202, duplicate
 * X-Reference-Id, auth failure, timeout, malformed responses, status
 * mapping, callbacks (success/failed/amount/currency/unknown/duplicate/
 * stale), and the unconfigured fail-closed state.
 */

const REF = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"; // UUID v4 (our M3-A reference)
const BASE = "https://sandbox.momodeveloper.mtn.com";

const ENV_OK: Record<string, string> = {
  MTN_MOMO_BASE_URL: BASE,
  MTN_MOMO_TARGET_ENVIRONMENT: "sandbox",
  MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY: "sub-key-1",
  MTN_MOMO_API_USER: "api-user-1",
  MTN_MOMO_API_KEY: "api-key-1",
};

const INIT_REQ = {
  reference: REF,
  amountUgx: 36_000,
  currency: "UGX",
  phone: "+256781234567",
};

type FetchCall = { url: string; init: RequestInit };

function makeFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
): { calls: FetchCall[]; impl: typeof fetch } {
  const calls: FetchCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return await handler(call, calls.length);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes ALL three MTN endpoints: token, POST requesttopay, GET status. */
function routedHandler(statusPayload: unknown) {
  return (call: FetchCall): Response => {
    if (call.url.includes("/collection/token/")) {
      return json(200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 });
    }
    if (call.init.method === "POST" && call.url.endsWith("/requesttopay")) {
      return new Response(null, { status: 202 });
    }
    return json(200, statusPayload);
  };
}

function makeAdapter(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
  envOver: Record<string, string | undefined> = {},
  timeoutMs?: number,
): ReturnType<typeof createMtnMomoAdapter> {
  const { impl } = makeFetch(handler);
  const deps: MtnMomoAdapterDeps = {
    env: (n) => (n in envOver ? envOver[n] : ENV_OK[n]),
    fetchImpl: impl,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
  return createMtnMomoAdapter(deps);
}

/** Routes: /collection/token/ (POST) and /collection/v1_0/requesttopay[/id]. */
function standardHandler(overrides: {
  tokenStatus?: number;
  payStatus?: number;
  statusBody?: unknown;
} = {}) {
  return (call: FetchCall): Response => {
    if (call.url.includes("/collection/token/")) {
      if (overrides.tokenStatus && overrides.tokenStatus >= 400) {
        return new Response("unauthorized", { status: overrides.tokenStatus });
      }
      return json(200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 });
    }
    if (call.init.method === "POST" && call.url.endsWith("/requesttopay")) {
      return new Response(null, { status: overrides.payStatus ?? 202 });
    }
    // GET status
    if (overrides.statusBody !== undefined) return json(200, overrides.statusBody);
    return json(200, { status: "PENDING" });
  };
}

describe("MTN MoMo adapter — sandbox contract", () => {
  it("1. token generation: Basic + subscription key from env, NO body/grant_type/manual Content-Length, cached", async () => {
    const { calls, impl } = makeFetch(standardHandler());
    // Credentials come ONLY from the environment — distinctive values prove it.
    const adapter = createMtnMomoAdapter({
      env: (n) =>
        n === "MTN_MOMO_API_USER"
          ? "user-from-env"
          : n === "MTN_MOMO_API_KEY"
            ? "key-from-env"
            : n === "MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY"
              ? "subkey-from-env"
              : ENV_OK[n],
      fetchImpl: impl,
    });

    await adapter.init(); // explicit init() per adapter requirements
    const first = await adapter.initiate(INIT_REQ);
    const second = await adapter.initiate({ ...INIT_REQ, phone: "+256770000001" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const tokenCall = calls[0];
    expect(tokenCall.url).toBe(`${BASE}/collection/token/`);
    expect(tokenCall.init.method).toBe("POST");
    const headers = tokenCall.init.headers as Record<string, string>;
    // Proven-working shape: Basic(API_USER:API_KEY) from env + Ocp key + zero length.
    expect(headers.Authorization).toBe(`Basic ${btoa("user-from-env:key-from-env")}`);
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("subkey-from-env");
    // Content-Length must NOT be set manually — the runtime adds `: 0` for a
    // body-less POST (manually set, it is a forbidden header in some fetches).
    expect("Content-Length" in headers).toBe(false);
    expect(headers["Content-Type"]).toBeUndefined();
    // MUST NOT send a body, grant_type, or a form content-type.
    expect(tokenCall.init.body).toBeUndefined();
    const rawInit = JSON.stringify(tokenCall.init);
    expect(rawInit).not.toContain("grant_type");
    expect(rawInit).not.toContain("x-www-form-urlencoded");
    // Exactly one token request across init + two initiates (cached until expiry).
    expect(calls.filter((c) => c.url.includes("/collection/token/"))).toHaveLength(1);
  });

  it("2+3. RequestToPay: official headers/body, HTTP 202 accepted, UUID X-Reference-Id", async () => {
    const { calls, impl } = makeFetch(standardHandler({ payStatus: 202 }));
    const adapter = createMtnMomoAdapter({ env: (n) => ENV_OK[n], fetchImpl: impl });

    const outcome = await adapter.initiate(INIT_REQ);
    expect(outcome).toEqual({ ok: true, providerReference: REF });

    const pay = calls.find((c) => c.init.method === "POST" && c.url.endsWith("/requesttopay"))!;
    expect(pay.url).toBe(`${BASE}/collection/v1_0/requesttopay`);
    const h = pay.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok-123");
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("sub-key-1");
    expect(h["X-Target-Environment"]).toBe("sandbox");
    expect(h["X-Reference-Id"]).toBe(REF); // OUR payment reference (UUID v4)
    expect(h["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(pay.init.body)) as Record<string, unknown>;
    expect(body.amount).toBe("36000"); // official decimal STRING
    // SANDBOX takes EUR. The ledger handed us UGX (INIT_REQ.currency) and the
    // number is carried across unchanged — this is a wire representation for the
    // sandbox, not a price and not a conversion.
    expect(INIT_REQ.currency).toBe("UGX");
    expect(body.currency).toBe("EUR");
    expect(body.externalId).toBe(REF);
    expect(body.payer).toEqual({ partyIdType: "MSISDN", partyId: "256781234567" }); // no "+"
  });

  it("4. duplicate X-Reference-Id (409) is idempotent success, never a new charge", async () => {
    const { calls, impl } = makeFetch(
      standardHandler({ payStatus: 409 }),
    );
    const adapter = createMtnMomoAdapter({ env: (n) => ENV_OK[n], fetchImpl: impl });
    const outcome = await adapter.initiate(INIT_REQ);
    expect(outcome).toEqual({ ok: true, providerReference: REF });
    expect(
      calls.filter((c) => c.init.method === "POST" && c.url.endsWith("/requesttopay")),
    ).toHaveLength(1); // exactly one RequestToPay despite the duplicate reference
  });

  it("5. authentication failure (token 401) → provider_auth_failed, retryable, no RequestToPay", async () => {
    const { calls, impl } = makeFetch(standardHandler({ tokenStatus: 401 }));
    const adapter = createMtnMomoAdapter({ env: (n) => ENV_OK[n], fetchImpl: impl });
    const outcome = await adapter.initiate(INIT_REQ);
    expect(outcome).toEqual({ ok: false, error: "provider_auth_failed", retryable: true, stage: "token" });
    // Never pushed a payment with a broken token.
    expect(calls.some((c) => c.url.endsWith("/requesttopay"))).toBe(false);
  });

  it("6. timeout → retryable failure, NEVER success", async () => {
    const { impl } = makeFetch(() => new Promise<Response>(() => undefined)); // hangs
    const adapter = createMtnMomoAdapter({
      env: (n) => ENV_OK[n],
      fetchImpl: impl,
      timeoutMs: 10,
    });
    const outcome = await adapter.initiate(INIT_REQ);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(true);
      expect(outcome.error).toBe("provider_unavailable");
    }
  }, 10_000);

  it("7. malformed provider response on status query → provider_response_invalid; malformed callback JSON rejected", async () => {
    const adapter = makeAdapter(routedHandler({ foo: "bar" }));
    const status = await adapter.queryStatus({ reference: REF, providerReference: null });
    expect(status).toEqual({ ok: false, error: "provider_response_invalid" });

    const verify = await adapter.verifyCallback({ rawBody: "{ not json", headers: {} });
    expect(verify).toEqual({ ok: false, error: "callback_malformed_json" });
  });

  it("8-10. status query maps SUCCESSFUL/PENDING/FAILED onto normalized states only", async () => {
    let status = "SUCCESSFUL";
    const { calls, impl } = makeFetch((call) => {
      if (call.url.includes("/collection/token/")) {
        return json(200, { access_token: "tok-123", token_type: "access_token", expires_in: 3600 });
      }
      if (call.init.method === "POST") return new Response(null, { status: 202 });
      return json(200, { status, financialTransactionId: "ftx-1" });
    });
    const adapter = createMtnMomoAdapter({ env: (n) => ENV_OK[n], fetchImpl: impl });

    expect(await adapter.queryStatus({ reference: REF, providerReference: null })).toEqual({
      ok: true,
      rawStatus: "SUCCESSFUL",
      providerReference: "ftx-1",
    });
    // Official status endpoint shape: GET /collection/v1_0/requesttopay/{referenceId}
    const getStatusCall = calls.find((c) => c.init.method === "GET")!;
    expect(getStatusCall.url).toBe(`${BASE}/collection/v1_0/requesttopay/${REF}`);
    const statusHeaders = getStatusCall.init.headers as Record<string, string>;
    expect(statusHeaders.Authorization).toBe("Bearer tok-123");
    expect(statusHeaders["Ocp-Apim-Subscription-Key"]).toBe("sub-key-1");
    status = "PENDING";
    expect((await adapter.queryStatus({ reference: REF, providerReference: null })).ok).toBe(true);

    // Normalized vocabulary — no new states.
    expect(adapter.normalizeStatus("SUCCESSFUL")).toBe("confirmed");
    expect(adapter.normalizeStatus("FAILED")).toBe("failed");
    expect(adapter.normalizeStatus("PENDING")).toBe("pending");
    expect(adapter.normalizeStatus("WEIRD_NEW_STATE")).toBeNull();
    expect(settlementActionFor("confirmed")).toEqual({ action: "confirm" });
    expect(settlementActionFor("failed")).toEqual({ action: "fail", reason: "provider_reported_failure" });
    expect(settlementActionFor("pending")).toEqual({ action: "none" });

    const failed = makeAdapter(routedHandler({ status: "FAILED" }));
    expect(await failed.queryStatus({ reference: REF, providerReference: null })).toEqual({
      ok: true,
      rawStatus: "FAILED",
      providerReference: null,
    });
  });

  it("11. successful callback: verified via authoritative re-query agreement", async () => {
    const adapter = makeAdapter(
      routedHandler({
        status: "SUCCESSFUL",
        financialTransactionId: "ftx-9",
        amount: "36000",
        currency: "UGX",
      }),
    );
    const verified = await adapter.verifyCallback({
      rawBody: JSON.stringify({
        status: "SUCCESSFUL",
        externalId: REF,
        amount: "36000",
        currency: "UGX",
        financialTransactionId: "ftx-9",
      }),
      headers: {},
    });
    expect(verified).toEqual({
      ok: true,
      reference: REF,
      providerReference: "ftx-9",
      reportedAmountUgx: 36_000,
      reportedCurrency: "UGX",
      rawStatus: "SUCCESSFUL",
    });
  });

  it("12. failed callback: FAILED agrees with the authoritative query", async () => {
    const adapter = makeAdapter(
      routedHandler({ status: "FAILED", amount: "36000", currency: "UGX" }),
    );
    const verified = await adapter.verifyCallback({
      rawBody: JSON.stringify({
        status: "FAILED",
        externalId: REF,
        amount: "36000",
        currency: "UGX",
      }),
      headers: {},
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.rawStatus).toBe("FAILED");
      expect(verified.reportedCurrency).toBe("UGX");
    }
  });

  it("12b. callback DISAGREEING with the authoritative query is refused (unsigned-contract authenticity)", async () => {
    const adapter = makeAdapter(routedHandler({ status: "PENDING" })); // provider truth: still pending
    const verified = await adapter.verifyCallback({
      rawBody: JSON.stringify({
        status: "SUCCESSFUL", // forged/impatient callback
        externalId: REF,
        amount: "36000",
        currency: "UGX",
      }),
      headers: {},
    });
    expect(verified).toEqual({ ok: false, error: "callback_status_mismatch" });
  });

  it("13. callback amount mismatch is rejected by callbackSettle against the ledger", async () => {
    // Status endpoint echoes NO amount → verification passes the reported
    // value through, and the LEDGER cross-check is what refuses to settle.
    const adapter = makeAdapter(routedHandler({ status: "SUCCESSFUL" }));
    let confirmed = false;
    const result = await runCallbackSettlement({
      provider: "mtn_momo",
      method: "POST",
      rawBody: JSON.stringify({
        status: "SUCCESSFUL",
        externalId: REF,
        amount: "99999", // ≠ ledger 36000
        currency: "UGX",
      }),
      headers: {},
      adapter,
      lookup: async (): Promise<LookupOutcome> => ({
        ok: true,
        payment_id: "pay-1",
        status: "pending",
        amount_ugx: 36_000,
        currency: "UGX",
        reference: REF,
      }),
      confirm: async () => {
        confirmed = true;
        return { ok: true, status: "confirmed" };
      },
      fail: async () => ({ ok: true, status: "failed" }),
      cancel: async () => ({ ok: true, status: "cancelled" }),
    });
    expect(result.body).toMatchObject({ ok: false, reason: "amount_mismatch" });
    expect(confirmed, "wrong-amount callback must never settle").toBe(false);
  });

  it("14. callback currency mismatch is rejected by callbackSettle against the ledger", async () => {
    const adapter = makeAdapter(routedHandler({ status: "SUCCESSFUL" }));
    let confirmed = false;
    const result = await runCallbackSettlement({
      provider: "mtn_momo",
      method: "POST",
      rawBody: JSON.stringify({
        status: "SUCCESSFUL",
        externalId: REF,
        amount: "36000",
        currency: "USD", // ledger says UGX
      }),
      headers: {},
      adapter,
      lookup: async (): Promise<LookupOutcome> => ({
        ok: true,
        payment_id: "pay-1",
        status: "pending",
        amount_ugx: 36_000,
        currency: "UGX",
        reference: REF,
      }),
      confirm: async () => {
        confirmed = true;
        return { ok: true, status: "confirmed" };
      },
      fail: async () => ({ ok: true, status: "failed" }),
      cancel: async () => ({ ok: true, status: "cancelled" }),
    });
    expect(result.body).toMatchObject({ ok: false, reason: "amount_mismatch" });
    expect(confirmed, "wrong-currency callback must never settle").toBe(false);
  });

  it("15. duplicate callback: second delivery settles idempotently, 200, no failure", async () => {
    const adapter = makeAdapter(
      routedHandler({ status: "SUCCESSFUL", amount: "36000", currency: "UGX" }),
    );
    let confirmCalls = 0;
    const deps = {
      provider: "mtn_momo",
      method: "POST",
      headers: {},
      adapter,
      lookup: async (): Promise<LookupOutcome> => ({
        ok: true,
        payment_id: "pay-1",
        status: "pending",
        amount_ugx: 36_000,
        currency: "UGX",
        reference: REF,
      }),
      confirm: async () => {
        confirmCalls += 1;
        return confirmCalls === 1
          ? { ok: true, status: "confirmed" }
          : { ok: true, idempotent: true, status: "confirmed" };
      },
      fail: async () => ({ ok: true, status: "failed" }),
      cancel: async () => ({ ok: true, status: "cancelled" }),
    };
    const body = JSON.stringify({
      status: "SUCCESSFUL",
      externalId: REF,
      amount: "36000",
      currency: "UGX",
    });
    const first = await runCallbackSettlement({ ...deps, rawBody: body });
    const second = await runCallbackSettlement({ ...deps, rawBody: body });
    expect(first.httpStatus).toBe(200);
    expect(second.httpStatus).toBe(200);
    expect(second.body.idempotent).toBe(true); // M1 replay semantics surface
    expect(confirmCalls).toBe(2); // second call answered idempotently by the ledger wrapper
  });

  it("16. stale callback (terminal ledger row) → stale_success + auditable reconciliation marker", async () => {
    const adapter = makeAdapter(
      routedHandler({ status: "SUCCESSFUL", amount: "36000", currency: "UGX" }),
    );
    const flagged: Array<{ id: string; reason: string }> = [];
    const result = await runCallbackSettlement({
      provider: "mtn_momo",
      method: "POST",
      rawBody: JSON.stringify({
        status: "SUCCESSFUL",
        externalId: REF,
        amount: "36000",
        currency: "UGX",
      }),
      headers: {},
      adapter,
      lookup: async (): Promise<LookupOutcome> => ({
        ok: true,
        payment_id: "pay-stale",
        status: "cancelled", // terminal (e.g. stale-replaced earlier)
        amount_ugx: 36_000,
        currency: "UGX",
        reference: REF,
      }),
      confirm: async () => ({ ok: false, error: "payment_not_confirmable" }),
      fail: async () => ({ ok: true, status: "failed" }),
      cancel: async () => ({ ok: true, status: "cancelled" }),
      flagReconciliation: async (id, reason) => {
        flagged.push({ id, reason });
        return { ok: true };
      },
    });
    expect(result.body).toMatchObject({ ok: false, reason: "stale_success" });
    expect(flagged).toEqual([{ id: "pay-stale", reason: "stale_success" }]);
  });

  it("17. unconfigured provider fails closed everywhere (missing secrets)", async () => {
    const adapter = createMtnMomoAdapter({
      env: (n) => (n === "MTN_MOMO_API_KEY" ? undefined : ENV_OK[n]),
    });
    expect(adapter.isConfigured()).toBe(false);
    expect(MTN_MOMO_SECRETS).toHaveLength(5);

    const initiate = await adapter.initiate(INIT_REQ);
    expect(initiate).toEqual({ ok: false, error: "provider_not_configured", retryable: true });
    const status = await adapter.queryStatus({ reference: REF, providerReference: null });
    expect(status).toEqual({ ok: false, error: "provider_not_configured" });

    const settle = await runCallbackSettlement({
      provider: "mtn_momo",
      method: "POST",
      rawBody: JSON.stringify({ status: "SUCCESSFUL", externalId: REF }),
      headers: {},
      adapter,
      lookup: async () => ({ ok: false, error: "payment_not_found" }),
      confirm: async () => ({ ok: true }),
      fail: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
    });
    expect(settle.httpStatus).toBe(503);
    expect(settle.body).toMatchObject({ reason: "provider_not_configured" });
  });

  it("18. unknown provider reference in a callback → deterministic 200, zero settlement", async () => {
    const adapter = makeAdapter(
      routedHandler({ status: "SUCCESSFUL", amount: "36000", currency: "UGX" }),
    );
    let touched = false;
    const result = await runCallbackSettlement({
      provider: "mtn_momo",
      method: "POST",
      rawBody: JSON.stringify({
        status: "SUCCESSFUL",
        externalId: REF,
        amount: "36000",
        currency: "UGX",
      }),
      headers: {},
      adapter,
      lookup: async (): Promise<LookupOutcome> => ({ ok: false, error: "payment_not_found" }),
      confirm: async () => {
        touched = true;
        return { ok: true };
      },
      fail: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
    });
    expect(result.body).toMatchObject({ ok: false, reason: "unknown_reference" });
    expect(touched).toBe(false);
  });

  it("19. registration: the singleton is in the shared registry; Airtel is not", () => {
    expect(getProviderAdapter("mtn_momo")).toBe(mtnMomoAdapter);
    expect(getProviderAdapter("airtel_money")).toBeNull();
    expect(getProviderAdapter("pesapal")).toBeNull();
  });

  it("20. non-UUID reference cannot be pushed (X-Reference-Id contract), without inventing a second id", async () => {
    const adapter = makeAdapter(standardHandler());
    const outcome = await adapter.initiate({ ...INIT_REQ, reference: "REF-NOT-UUID" });
    expect(outcome).toEqual({ ok: false, error: "invalid_reference", retryable: false });
  });

  it("21. secrets (env-provided) never appear in outcomes, errors, or thrown messages", async () => {
    const SECRET_USER = "SECRET-USER-XYZ";
    const SECRET_KEY = "SECRET-KEY-ABC";
    const SECRET_SUBKEY = "SECRET-SUBKEY-DEF";
    const env = (n: string): string | undefined => {
      if (n === "MTN_MOMO_API_USER") return SECRET_USER;
      if (n === "MTN_MOMO_API_KEY") return SECRET_KEY;
      if (n === "MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY") return SECRET_SUBKEY;
      return ENV_OK[n];
    };

    // Token-auth failure path (fixed literal error names, no secret echo).
    const failing = createMtnMomoAdapter({
      env,
      fetchImpl: (() =>
        Promise.resolve(new Response("nope", { status: 401 }))) as unknown as typeof fetch,
    });
    const outcome = await failing.initiate(INIT_REQ);
    expect(outcome).toEqual({ ok: false, error: "provider_auth_failed", retryable: true, stage: "token" });

    let thrown = "";
    try {
      await failing.init();
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }
    expect(thrown).toBe("mtn_token_auth_failed");

    const statusOutcome = await failing.queryStatus({ reference: REF, providerReference: null });

    const dump = JSON.stringify(outcome) + JSON.stringify(statusOutcome) + thrown;
    expect(dump).not.toContain(SECRET_USER);
    expect(dump).not.toContain(SECRET_KEY);
    expect(dump).not.toContain(SECRET_SUBKEY);

    // Success-path outcome must not echo credentials either.
    const okAdapter = makeAdapter(standardHandler(), {
      MTN_MOMO_API_USER: SECRET_USER,
      MTN_MOMO_API_KEY: SECRET_KEY,
    });
    const ok = await okAdapter.initiate(INIT_REQ);
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(ok)).not.toContain(SECRET_USER);
    expect(JSON.stringify(ok)).not.toContain(SECRET_KEY);
  });
});

describe("M3-G hardening — timeout budget + stage diagnostics", () => {
  function makeRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
    return {
      id: "pay-diag-0001",
      subscription_id: "sub-diag-0001",
      organization_id: "org-diag-0001",
      shop_id: null,
      provider: "mtn_momo",
      reference: REF,
      status: "pending",
      status_reason: null,
      amount_ugx: 36_000,
      currency: "UGX",
      created_at: "2026-10-08T00:00:00+00:00",
      confirmed_at: null,
      metadata: {},
      ...overrides,
    };
  }

  function makeInitiateDeps(opts: {
    adapter: ReturnType<typeof createMtnMomoAdapter>;
    flags: Array<{ id: string; reason: string }>;
    attach?: InitiateFlowDeps["attach"];
    fail?: InitiateFlowDeps["fail"];
    timeoutMs?: number;
  }): InitiateFlowDeps {
    return {
      authorize: async () => ({ ok: true }),
      fetchRow: async () => makeRow(),
      attach: opts.attach ?? (async () => ({ ok: true, provider_reference: REF })),
      fail: opts.fail ?? (async () => ({ ok: true })),
      resolveAdapter: () => opts.adapter,
      claim: async () => ({ ok: true, claimed: true }),
      flagReconciliation: async (id, reason) => {
        opts.flags.push({ id, reason });
        return { ok: true };
      },
      phone: "+256781234567",
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };
  }

  it("4. timeout budget: token + requesttopay always fit below the ledger's overall deadline", () => {
    expect(MTN_TOKEN_TIMEOUT_MS).toBe(4_000);
    expect(MTN_REQUESTTOPAY_TIMEOUT_MS).toBe(6_000);
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(12_000);
    // One provider leg can never consume the whole budget and starve the next:
    // worst case 4s + 6s = 10s < 12s ledger deadline < 20s client abort.
    expect(MTN_TOKEN_TIMEOUT_MS + MTN_REQUESTTOPAY_TIMEOUT_MS).toBeLessThan(
      DEFAULT_PROVIDER_TIMEOUT_MS,
    );
  });

  it("5. token failure records mtn_token_failed; payment stays pending", async () => {
    const flags: Array<{ id: string; reason: string }> = [];
    const adapter = makeAdapter(() => new Response("boom", { status: 500 }));
    const result = await runInitiateFlow(makeInitiateDeps({ adapter, flags }));
    expect(result).toMatchObject({
      ok: false,
      error: "provider_unavailable",
      status: "pending",
      retryable: true,
    });
    expect(flags).toEqual([{ id: "pay-diag-0001", reason: "mtn_token_failed" }]);
  });

  it("6. RequestToPay failure records mtn_requesttopay_failed; payment stays pending", async () => {
    const flags: Array<{ id: string; reason: string }> = [];
    const adapter = makeAdapter((call) =>
      call.url.includes("/collection/token/")
        ? json(200, { access_token: "tok-123", token_type: "access_token", expires_in: 3600 })
        : new Response("unavailable", { status: 503 }),
    );
    const result = await runInitiateFlow(makeInitiateDeps({ adapter, flags }));
    expect(result).toMatchObject({
      ok: false,
      error: "provider_unavailable",
      status: "pending",
      retryable: true,
    });
    expect(flags).toEqual([{ id: "pay-diag-0001", reason: "mtn_requesttopay_failed" }]);
  });

  it("7. attach failure records mtn_attach_failed; payment stays pending (never failed)", async () => {
    const flags: Array<{ id: string; reason: string }> = [];
    let failCalled = 0;
    const adapter = makeAdapter(routedHandler({ status: "PENDING" }));
    const result = await runInitiateFlow(
      makeInitiateDeps({
        adapter,
        flags,
        attach: async () => ({ ok: false, error: "rpc_failed" }),
        fail: async () => {
          failCalled += 1;
          return { ok: true };
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, error: "attach_failed", status: "pending" });
    expect(flags).toEqual([{ id: "pay-diag-0001", reason: "mtn_attach_failed" }]);
    expect(failCalled, "attach failure must never fail the payment").toBe(0);
  });

  it("overall provider deadline records mtn_timeout (ledger 12s race)", async () => {
    const flags: Array<{ id: string; reason: string }> = [];
    // Hanging provider (adapter's own 4s token timer is slower than the ledger
    // race below) → the LEDGER deadline fires first.
    const adapter = makeAdapter(() => new Promise<Response>(() => undefined), {}, 60_000);
    const result = await runInitiateFlow(
      makeInitiateDeps({ adapter, flags, timeoutMs: 5 }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: "initiate_timeout",
      status: "pending",
      retryable: true,
    });
    expect(flags).toEqual([{ id: "pay-diag-0001", reason: "mtn_timeout" }]);
  }, 10_000);

  it("definite provider rejection still fails the payment exactly once (state machine unchanged) + records stage", async () => {
    const flags: Array<{ id: string; reason: string }> = [];
    let failCalled = 0;
    const adapter = makeAdapter((call) =>
      call.url.includes("/collection/token/")
        ? json(200, { access_token: "tok-123", token_type: "access_token", expires_in: 3600 })
        : new Response("bad request", { status: 400 }),
    );
    const result = await runInitiateFlow(
      makeInitiateDeps({
        adapter,
        flags,
        fail: async () => {
          failCalled += 1;
          return { ok: true, status: "failed" };
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, error: "provider_rejected", status: "failed" });
    expect(failCalled).toBe(1);
    expect(flags).toEqual([{ id: "pay-diag-0001", reason: "mtn_requesttopay_failed" }]);
  });

  it("8. diagnostics carry ONLY constant reasons — no credentials, tokens, or phone numbers", async () => {
    const SECRET_USER = "SECRET-USER-XYZ";
    const SECRET_KEY = "SECRET-KEY-ABC";
    const SECRET_SUB = "SECRET-SUBKEY-DEF";
    const SECRET_PHONE = "+256779999999";
    const flags: Array<{ id: string; reason: string }> = [];
    const adapter = makeAdapter(
      () => new Response("boom", { status: 500 }),
      {
        MTN_MOMO_API_USER: SECRET_USER,
        MTN_MOMO_API_KEY: SECRET_KEY,
        MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY: SECRET_SUB,
      },
    );
    const deps = makeInitiateDeps({ adapter, flags });
    deps.phone = SECRET_PHONE;
    await runInitiateFlow(deps);

    expect(flags).toHaveLength(1);
    expect(flags[0]!.reason).toMatch(/^mtn_[a-z_]+$/);
    const dump = JSON.stringify(flags);
    expect(dump).not.toContain(SECRET_USER);
    expect(dump).not.toContain(SECRET_KEY);
    expect(dump).not.toContain(SECRET_SUB);
    expect(dump).not.toContain(SECRET_PHONE);
    expect(dump).not.toContain("tok-"); // no token fragments
  });

  it("9. retrying the SAME payment preserves the same X-Reference-Id (never a fresh provider id)", async () => {
    const payInits: RequestInit[] = [];
    const adapter = makeAdapter((call) => {
      if (call.url.includes("/collection/token/")) {
        return json(200, { access_token: "tok-123", token_type: "access_token", expires_in: 3600 });
      }
      if (call.init.method === "POST") {
        payInits.push(call.init);
        return new Response(null, { status: 202 });
      }
      return json(200, { status: "PENDING" });
    });
    // First attempt and a retry of the same attempt/reference:
    expect((await adapter.initiate(INIT_REQ)).ok).toBe(true);
    expect((await adapter.initiate(INIT_REQ)).ok).toBe(true);
    const xRefs = payInits.map((i) => (i.headers as Record<string, string>)["X-Reference-Id"]);
    expect(xRefs).toEqual([REF, REF]);
    expect(new Set(xRefs).size).toBe(1);
  });

  it("10. retryable failures never touch payment state; only definite rejection does (state machine unchanged)", async () => {
    for (const build of [
      () => makeAdapter(() => new Response("x", { status: 500 })), // token leg
      () =>
        makeAdapter((call) =>
          call.url.includes("/collection/token/")
            ? json(200, { access_token: "t", token_type: "access_token", expires_in: 3600 })
            : new Response("x", { status: 503 }),
        ), // requesttopay leg
    ]) {
      let failCalled = 0;
      const flags: Array<{ id: string; reason: string }> = [];
      const result = await runInitiateFlow(
        makeInitiateDeps({
          adapter: build(),
          flags,
          fail: async () => {
            failCalled += 1;
            return { ok: true };
          },
        }),
      );
      expect(result.status).toBe("pending");
      expect(failCalled).toBe(0);
    }
  });
});

/**
 * Environment-aware currency + RequestToPay diagnostics.
 *
 * MTN's SANDBOX only accepts EUR while Uganda production accepts UGX, and the
 * ledger's own currency is DKASU's (UGX) and must not move. So the environment
 * decides what goes on the wire, and the AMOUNT is never converted — sandbox
 * money is not real, and a rate would invent a value the ledger never recorded.
 *
 * The second half pins the diagnostic: a failed RequestToPay must record the
 * provider's HTTP status and error CODE (never its message), and must never put
 * a credential, token or MSISDN anywhere.
 */
describe("MTN MoMo adapter — environment currency and RequestToPay diagnostics", () => {
  const envFor = (targetEnvironment: string): Record<string, string> => ({
    ...ENV_OK,
    MTN_MOMO_TARGET_ENVIRONMENT: targetEnvironment,
  });

  const payBody = (calls: FetchCall[]) =>
    JSON.parse(
      String(calls.find((c) => c.init.method === "POST" && c.url.endsWith("/requesttopay"))!.init.body),
    ) as Record<string, unknown>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sandbox RequestToPay sends EUR; production sends UGX; the amount is identical in both", async () => {
    const sandbox = await (async () => {
      const { calls, impl } = makeFetch(standardHandler({ payStatus: 202 }));
      await createMtnMomoAdapter({ env: (n) => envFor("sandbox")[n], fetchImpl: impl }).initiate(INIT_REQ);
      return payBody(calls);
    })();
    const production = await (async () => {
      const { calls, impl } = makeFetch(standardHandler({ payStatus: 202 }));
      await createMtnMomoAdapter({ env: (n) => envFor("mtnuganda")[n], fetchImpl: impl }).initiate(INIT_REQ);
      return payBody(calls);
    })();

    expect(sandbox.currency).toBe("EUR");
    expect(production.currency).toBe("UGX");

    // Same number both times — no exchange rate was applied.
    expect(sandbox.amount).toBe("36000");
    expect(production.amount).toBe("36000");
    expect(sandbox.amount).toBe(production.amount);
  });

  it("the ledger's currency is untouched by the adapter (UGX in, UGX out to production)", async () => {
    const { impl } = makeFetch(standardHandler({ payStatus: 202 }));
    const req = { ...INIT_REQ, currency: "UGX" };
    await createMtnMomoAdapter({ env: (n) => envFor("mtnuganda")[n], fetchImpl: impl }).initiate(req);
    // The adapter does not mutate its input — the ledger row is the source of truth.
    expect(req.currency).toBe("UGX");
  });

  it("a failed RequestToPay records the HTTP status and the provider's error CODE", async () => {
    const reported: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      reported.push(String(line));
    });

    const adapter = makeAdapter((call) =>
      call.url.includes("/collection/token/")
        ? json(200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 })
        : json(500, { code: "INVALID_CURRENCY", message: "Currency not supported on the requested account" }),
    );

    const outcome = await adapter.initiate(INIT_REQ);

    expect(outcome).toMatchObject({
      ok: false,
      error: "provider_unavailable",
      retryable: true,
      stage: "requesttopay",
      providerStatus: 500,
      providerCode: "INVALID_CURRENCY",
    });

    const line = reported.find((l) => l.includes("provider_leg_failed"));
    expect(line).toBeTruthy();
    expect(line).toContain('"http_status":500');
    expect(line).toContain('"provider_code":"INVALID_CURRENCY"');
  });

  it("the diagnostic carries ONLY the status and code — never secrets, tokens, the MSISDN, or provider text", async () => {
    const reported: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      reported.push(String(line));
    });

    const adapter = makeAdapter((call) =>
      call.url.includes("/collection/token/")
        ? json(200, { access_token: "tok-SECRET-ABC", token_type: "Bearer", expires_in: 3600 })
        : json(400, { code: "INVALID_CURRENCY", message: "phone +256781234567 rejected for api-user-1" }),
    );

    await adapter.initiate(INIT_REQ);

    const all = reported.join("\n");
    expect(all).not.toContain("tok-SECRET-ABC"); // access token
    expect(all).not.toContain("api-user-1"); // API user
    expect(all).not.toContain("api-key-1"); // API key
    expect(all).not.toContain("sub-key-1"); // subscription key
    expect(all).not.toContain("256781234567"); // MSISDN
    // The provider's MESSAGE is never read out — only its bounded code.
    expect(all).not.toContain("rejected for");
  });

  it("an unbounded or hostile provider code is dropped rather than logged", async () => {
    const reported: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      reported.push(String(line));
    });

    const adapter = makeAdapter((call) =>
      call.url.includes("/collection/token/")
        ? json(200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 })
        : json(500, { code: "not a code; DROP TABLE--" }),
    );

    const outcome = await adapter.initiate(INIT_REQ);

    expect(outcome).toMatchObject({ ok: false, providerStatus: 500 });
    expect((outcome as { providerCode?: string }).providerCode).toBeUndefined();
    expect(reported.join("\n")).not.toContain("DROP TABLE");
  });
});
