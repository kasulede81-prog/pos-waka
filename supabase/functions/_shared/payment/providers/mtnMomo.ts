/**
 * MTN Mobile Money (MoMo) Collections adapter — SANDBOX contract implementation.
 *
 * Contract source: the OFFICIAL momodeveloper.mtn.com documentation supplied to
 * this project (sandbox base URL, requesttopay, token flow, status endpoint,
 * target environments). Nothing here is invented beyond that contract; the
 * one place where the official contract specifies NO cryptographic signature
 * (callbacks) is documented below and implemented as the mechanism the
 * contract actually provides.
 *
 * Architecture rules preserved (M1–M3-G):
 *   - every request input derives from the server-created payment intent
 *     (InitiateRequest = ledger reference/amount/currency + validated phone);
 *   - X-Reference-Id IS our payment reference (a UUIDv4 from M3-A), so MTN's
 *     own duplicate-X-Reference-Id semantics back our idempotency — no second
 *     idempotency system is created, and retries after a timeout re-present
 *     the SAME reference (MTN answers 409 duplicate → treated as
 *     "already registered", never as a new charge);
 *   - provider calls happen only after the M3-G claim (ledger.ts orders this);
 *   - settlement happens only through callbackSettle → M1 wrappers; this file
 *     NEVER touches the ledger;
 *   - timeouts/unknown responses map to retryable failures — a provider
 *     timeout can never become payment success;
 *   - status vocabulary maps ONLY onto the existing normalized states
 *     (pending | confirmed | failed | cancelled), never new states.
 *
 * CALLBACK AUTHENTICITY (per official contract): MTN's callback is a plain
 * JSON POST to the callback host configured on the API user — the official
 * documentation specifies NO HMAC/signature header. The authenticity
 * mechanisms the contract actually provides, implemented here:
 *   1. TLS + the callback host being registered on the MTN API user (only MTN
 *      can reach our endpoint in practice);
 *   2. AUTHORITATIVE SERVER-TO-SERVER RE-QUERY: verifyCallback() re-fetches
 *      GET /collection/v1_0/requesttopay/{X-Reference-Id} with server-side
 *      credentials and only accepts a callback whose status AGREES with the
 *      provider's own authoritative status. Disagreement/unavailability →
 *      verification fails → zero ledger writes (the existing status-polling
 *      path then reconciles).
 * Structural checks (JSON, status, externalId, amount, currency) run first;
 * amount/currency are still cross-checked against the immutable ledger row by
 * callbackSettle exactly as before.
 *
 * Secrets (Edge Function secrets ONLY — never VITE_*, never the browser):
 *   MTN_MOMO_BASE_URL                  e.g. https://sandbox.momodeveloper.mtn.com
 *   MTN_MOMO_TARGET_ENVIRONMENT        e.g. sandbox   (production: mtnuganda)
 *   MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY
 *   MTN_MOMO_API_USER
 *   MTN_MOMO_API_KEY
 * See docs/PAYMENTS_MTN_SANDBOX.md for sandbox provisioning.
 */

import { registerProviderAdapter, type ProviderAdapter } from "../adapter.ts";
import type {
  CallbackRequest,
  InitiateOutcome,
  InitiateRequest,
  NormalizedStatus,
  ProviderId,
  QueryStatusOutcome,
  QueryStatusRequest,
  VerifiedCallback,
} from "../types.ts";

export const MTN_MOMO_PROVIDER_ID = "mtn_momo" as ProviderId;

/**
 * Timeout budget (coherent with the architecture):
 *   token leg 4s + RequestToPay leg 6s = 10s worst case
 *   < ledger overall provider deadline 12s (DEFAULT_PROVIDER_TIMEOUT_MS)
 *   < client abort 20s
 * So neither leg can consume the entire overall budget and starve the next.
 */
export const MTN_TOKEN_TIMEOUT_MS = 4_000;
export const MTN_REQUESTTOPAY_TIMEOUT_MS = 6_000;

/** Official sandbox Collections base (config may override per environment). */
export const MTN_MOMO_SANDBOX_BASE_URL = "https://sandbox.momodeveloper.mtn.com";
/** Official Uganda production target environment (NOT used in this phase). */
export const MTN_MOMO_PRODUCTION_TARGET_ENVIRONMENT = "mtnuganda";

export const MTN_MOMO_SECRETS = [
  "MTN_MOMO_BASE_URL",
  "MTN_MOMO_TARGET_ENVIRONMENT",
  "MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY",
  "MTN_MOMO_API_USER",
  "MTN_MOMO_API_KEY",
] as const;

/** X-Reference-Id must be a UUID v4 — our M3-A payment reference qualifies. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MtnMomoAdapterDeps = {
  /** Defaults to Deno.env in the Edge runtime; tests inject a map. */
  env?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Per-request override for BOTH legs (tests). */
  timeoutMs?: number;
  tokenTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function defaultEnv(name: string): string | undefined {
  if (typeof Deno === "undefined") return undefined;
  const value = (Deno as unknown as { env: { get(k: string): string | undefined } }).env.get(name);
  return value === "" ? undefined : value;
}

/** E.164 "+256771234567" → MSISDN "256771234567" (official partyId form). */
function toMsisdn(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * Structured, secret-free diagnostic for a failed provider leg.
 *
 * Mirrors `callbackSettle.emit()`: one line, a stable taxonomy, and NEVER a raw
 * body, header, token, MSISDN or SQL error. The reconciliation REASON stays a
 * constant string (see `ledger.stageReason`) — that constancy is a tested safety
 * property, so the provider's own status/code is surfaced HERE instead, where it
 * is diagnosable from the function log and cannot reach a history payload.
 */
function emitProviderFailure(input: {
  leg: "token" | "requesttopay" | "status";
  httpStatus?: number;
  providerCode?: string;
}): void {
  console.error(
    "[mtn-momo] " +
      JSON.stringify({
        event: "provider_leg_failed",
        leg: input.leg,
        http_status: input.httpStatus ?? null,
        provider_code: input.providerCode ?? null,
        at: new Date().toISOString(),
      }),
  );
}

/** Provider error codes are bounded tokens. Anything else is dropped, never truncated into a log. */
function safeProviderCode(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9_]{1,64}$/.test(raw) ? raw : undefined;
}

/**
 * Read the provider's error CODE without keeping the body.
 *
 * MTN answers a rejected request with `{"code":"INVALID_CURRENCY","message":"…"}`.
 * The code is a bounded token we may keep; the message is never read out (it can
 * echo request fields), and the body itself is discarded here. Failure bodies are
 * small, so the read is capped rather than streamed.
 */
async function readProviderCode(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (text.length > 4096) return undefined;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return safeProviderCode(parsed.code ?? parsed.errorCode ?? parsed.error);
  } catch {
    return undefined;
  }
}

/**
 * The currency MTN expects for the configured target environment.
 *
 * The ledger's currency is DKASU's own and stays UGX everywhere — it is the money
 * the subscription is priced in. MTN's SANDBOX, however, only accepts EUR, while
 * Uganda production accepts UGX. So the environment decides what goes on the wire.
 *
 * THE AMOUNT IS DELIBERATELY NOT CONVERTED. Sandbox money is not real, and a rate
 * would invent a value the ledger never recorded; the same number is sent either
 * way (36000 UGX in production, 36000 EUR in sandbox). That is a test-only
 * representation, not a price.
 */
function requestToPayCurrency(targetEnvironment: string, ledgerCurrency: string): string {
  return targetEnvironment.trim().toLowerCase() === "sandbox" ? "EUR" : ledgerCurrency;
}

class MtnHttpError extends Error {
  readonly kind:
    | "http_status"
    | "network"
    | "malformed"
    | "not_found"
    | "auth"
    | "rejected"
    | "unavailable";
  readonly httpStatus?: number;
  readonly reason?: string;

  constructor(
    kind: MtnHttpError["kind"],
    message: string,
    httpStatus?: number,
    reason?: string,
  ) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.reason = reason;
  }
}

export class MtnMomoAdapter implements ProviderAdapter {
  readonly id = MTN_MOMO_PROVIDER_ID;
  private readonly env: (name: string) => string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tokenTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(deps: MtnMomoAdapterDeps = {}) {
    this.env = deps.env ?? defaultEnv;
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.now = deps.now ?? (() => Date.now());
    // timeoutMs (tests) overrides both legs; otherwise bounded per-leg budgets
    // that always sum below the ledger's overall deadline.
    this.tokenTimeoutMs = deps.timeoutMs ?? deps.tokenTimeoutMs ?? MTN_TOKEN_TIMEOUT_MS;
    this.requestTimeoutMs = deps.timeoutMs ?? deps.requestTimeoutMs ?? MTN_REQUESTTOPAY_TIMEOUT_MS;
  }

  private config(): {
    baseUrl: string;
    targetEnvironment: string;
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
  } | null {
    const baseUrl = this.env("MTN_MOMO_BASE_URL")?.trim().replace(/\/$/, "");
    const targetEnvironment = this.env("MTN_MOMO_TARGET_ENVIRONMENT")?.trim();
    const subscriptionKey = this.env("MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY")?.trim();
    const apiUser = this.env("MTN_MOMO_API_USER")?.trim();
    const apiKey = this.env("MTN_MOMO_API_KEY")?.trim();
    if (!baseUrl || !targetEnvironment || !subscriptionKey || !apiUser || !apiKey) return null;
    return { baseUrl, targetEnvironment, subscriptionKey, apiUser, apiKey };
  }

  /** All five secrets present — otherwise every path fails closed. */
  isConfigured(): boolean {
    return this.config() !== null;
  }

  /**
   * Acquire (or reuse) the sandbox access token — the official API-user/API-key
   * mechanism. Public per the adapter requirements; called lazily by every
   * provider call so configuration errors surface before any payment push.
   */
  async init(): Promise<void> {
    await this.ensureToken(true);
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Race the request against a hard timeout so the guarantee holds even if a
    // fetch implementation ignores the abort signal.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new MtnHttpError("network", `mtn_timeout_after_${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      const request = this.fetchImpl(input, { ...init, signal: controller.signal });
      return await Promise.race([request, timeout]);
    } catch (err) {
      if (err instanceof MtnHttpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(message)) {
        throw new MtnHttpError("network", `mtn_timeout_after_${timeoutMs}ms`);
      }
      throw new MtnHttpError("network", `mtn_network_error: ${message}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async ensureToken(force = false): Promise<string> {
    const cfg = this.config();
    if (!cfg) throw new MtnHttpError("auth", "mtn_not_configured");
    if (!force && this.token && this.token.expiresAtMs > this.now()) {
      return this.token.value;
    }

    const basic = btoa(`${cfg.apiUser}:${cfg.apiKey}`);
    let response: Response;
    try {
      // Proven-working MTN sandbox token request (experimentally verified):
      //   POST /collection/token/
      //   Authorization: Basic base64(API_USER:API_KEY)
      //   Ocp-Apim-Subscription-Key: <subscription key>
      //   no body, no grant_type, no form content-type.
      // Content-Length is NOT set manually: the runtime adds
      // `Content-Length: 0` for a body-less POST (no reference SDK sets it
      // by hand, and a manually-set Content-Length is a forbidden header in
      // some fetch implementations).
      response = await this.fetchWithTimeout(
        `${cfg.baseUrl}/collection/token/`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
          },
        },
        this.tokenTimeoutMs,
      );
    } catch (err) {
      if (err instanceof MtnHttpError) throw err;
      throw new MtnHttpError("network", "mtn_token_network_error");
    }

    if (!response.ok) {
      // Same secret-free diagnostic as the RequestToPay leg: a token failure is
      // a credentials question, and the status/code is what answers it.
      const code = await readProviderCode(response);
      emitProviderFailure({ leg: "token", httpStatus: response.status, providerCode: code });
      if (response.status === 401 || response.status === 403) {
        throw new MtnHttpError("auth", "mtn_token_auth_failed", response.status);
      }
      throw new MtnHttpError("unavailable", `mtn_token_http_${response.status}`, response.status);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new MtnHttpError("malformed", "mtn_token_response_malformed");
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) throw new MtnHttpError("malformed", "mtn_token_missing_access_token");
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.token = {
      value: accessToken,
      expiresAtMs: this.now() + Math.max(1_000, (expiresIn - 30) * 1_000),
    };
    return this.token.value;
  }

  /** Official status endpoint: GET /collection/v1_0/requesttopay/{X-Reference-Id}. */
  private async fetchTransactionStatus(
    reference: string,
  ): Promise<{ status: string; financialTransactionId: string | null; amount: string | null; currency: string | null }> {
    const cfg = this.config();
    if (!cfg) throw new MtnHttpError("auth", "mtn_not_configured");
    const token = await this.ensureToken();

    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        `${cfg.baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
            // REQUIRED ON EVERY COLLECTION CALL, not just RequestToPay. Without
            // it MTN rejects the status query (4xx), which surfaces as
            // `status_not_found` and reads to the payer as "we couldn't check".
            // This is the ONLY header requestToPay sends that this call lacked.
            "X-Target-Environment": cfg.targetEnvironment,
          },
        },
        this.requestTimeoutMs,
      );
    } catch (err) {
      if (err instanceof MtnHttpError) throw err;
      throw new MtnHttpError("network", "mtn_status_network_error");
    }

    if (response.status === 404) {
      throw new MtnHttpError("not_found", "mtn_status_not_found", 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new MtnHttpError("auth", "mtn_status_auth_failed", response.status);
    }
    if (!response.ok) {
      // MTN signals an unknown transaction as 400/500 with reason NOT_FOUND
      // on some sandbox builds — surface both shapes as status_not_found.
      let reason: string | undefined;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        reason = typeof body.reason === "string" ? body.reason : undefined;
      } catch {
        /* fall through to unavailable */
      }
      if (reason && /not[_ ]?found/i.test(reason)) {
        throw new MtnHttpError("not_found", "mtn_status_not_found", response.status, reason);
      }
      if (response.status >= 500 || response.status === 429) {
        throw new MtnHttpError("unavailable", `mtn_status_http_${response.status}`, response.status);
      }
      throw new MtnHttpError("rejected", `mtn_status_http_${response.status}`, response.status, reason);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new MtnHttpError("malformed", "mtn_status_response_malformed");
    }
    const status = typeof payload.status === "string" ? payload.status.trim() : "";
    if (!status) throw new MtnHttpError("malformed", "mtn_status_missing_status");
    return {
      status,
      financialTransactionId:
        typeof payload.financialTransactionId === "string" ? payload.financialTransactionId : null,
      amount: typeof payload.amount === "string" ? payload.amount : null,
      currency: typeof payload.currency === "string" ? payload.currency : null,
    };
  }

  /** Map transport/config failures onto the failure arm of InitiateOutcome — never success. */
  private toInitiateFailure(err: unknown): Extract<InitiateOutcome, { ok: false }> {
    if (err instanceof MtnHttpError) {
      switch (err.kind) {
        case "auth":
          // Configuration/credential problem: keep the payment pending for
          // ops — NEVER fail the customer's payment over our credentials.
          return { ok: false, error: "provider_auth_failed", retryable: true };
        case "rejected":
          // Definite API rejection of THIS request → provider rejection.
          return { ok: false, error: "provider_rejected", retryable: false };
        case "unavailable":
        case "network":
          return { ok: false, error: "provider_unavailable", retryable: true };
        case "malformed":
          return { ok: false, error: "provider_response_invalid", retryable: true };
        case "not_found":
          return { ok: false, error: "provider_unavailable", retryable: true };
        default:
          return { ok: false, error: "provider_unavailable", retryable: true };
      }
    }
    return { ok: false, error: "provider_unavailable", retryable: true };
  }

  async initiate(req: InitiateRequest): Promise<InitiateOutcome> {
    if (!this.isConfigured()) {
      // Defensive: ledger.ts checks isConfigured() before the claim; even if
      // reached unconfigured, this must never look like success.
      return { ok: false, error: "provider_not_configured", retryable: true };
    }
    if (!UUID_RE.test(req.reference)) {
      // X-Reference-Id must be a UUID v4 (official contract). Our M3-A
      // references always are; anything else cannot be pushed to MTN without
      // inventing a second idempotency key — refuse instead.
      return { ok: false, error: "invalid_reference", retryable: false };
    }
    if (!Number.isFinite(req.amountUgx) || req.amountUgx <= 0) {
      return { ok: false, error: "provider_rejected", retryable: false };
    }

    const cfg = this.config()!;

    // Leg 1 — access token (bounded by tokenTimeoutMs). Every failure here is
    // tagged stage "token" so reconciliation can pinpoint the leg.
    let token: string;
    try {
      token = await this.ensureToken();
    } catch (err) {
      return { ...this.toInitiateFailure(err), stage: "token" };
    }

    // Leg 2 — RequestToPay (bounded by requestTimeoutMs; the two legs always
    // sum below the ledger's overall provider deadline).
    try {
      const response = await this.fetchWithTimeout(
        `${cfg.baseUrl}/collection/v1_0/requesttopay`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
            "X-Target-Environment": cfg.targetEnvironment,
            "X-Reference-Id": req.reference,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Official schema: amount is a decimal STRING. Unchanged in both
            // environments — see requestToPayCurrency on why it is not converted.
            amount: String(req.amountUgx),
            // Sandbox → EUR, production → the ledger currency (UGX).
            currency: requestToPayCurrency(cfg.targetEnvironment, req.currency),
            externalId: req.reference,
            payer: {
              partyIdType: "MSISDN",
              partyId: toMsisdn(req.phone),
            },
            payeeNote: "Waka POS subscription",
            payerMessage: "Waka POS subscription payment",
          }),
        },
        this.requestTimeoutMs,
      );

      // 202 Accepted = asynchronous acceptance (official contract).
      if (response.status === 202 || response.ok) {
        return { ok: true, providerReference: req.reference };
      }
      // Duplicate X-Reference-Id: MTN already knows this transaction — our
      // same reference means it is the SAME payment attempt (idempotent).
      if (response.status === 409) {
        return { ok: true, providerReference: req.reference };
      }
      // Rejected for a reason MTN names. Read the code (never the message/body)
      // and emit it, so the NEXT failure is diagnosable rather than inferred.
      const status = response.status;
      const code = await readProviderCode(response);
      emitProviderFailure({ leg: "requesttopay", httpStatus: status, providerCode: code });

      if (status === 401 || status === 403) {
        return {
          ok: false,
          error: "provider_auth_failed",
          retryable: true,
          stage: "requesttopay",
          providerStatus: status,
          providerCode: code,
        };
      }
      if (status === 400 || status === 422) {
        // Covers invalid currency/target-environment/phone/amount shapes.
        return {
          ok: false,
          error: "provider_rejected",
          retryable: false,
          stage: "requesttopay",
          providerStatus: status,
          providerCode: code,
        };
      }
      if (status === 429 || status >= 500) {
        return {
          ok: false,
          error: "provider_unavailable",
          retryable: true,
          stage: "requesttopay",
          providerStatus: status,
          providerCode: code,
        };
      }
      return {
        ok: false,
        error: "provider_response_invalid",
        retryable: true,
        stage: "response",
        providerStatus: status,
        providerCode: code,
      };
    } catch (err) {
      return { ...this.toInitiateFailure(err), stage: "requesttopay" };
    }
  }

  async queryStatus(req: QueryStatusRequest): Promise<QueryStatusOutcome> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    if (!UUID_RE.test(req.reference)) return { ok: false, error: "status_not_found" };
    try {
      const tx = await this.fetchTransactionStatus(req.reference);
      return {
        ok: true,
        rawStatus: tx.status,
        providerReference: tx.financialTransactionId ?? req.providerReference,
      };
    } catch (err) {
      if (err instanceof MtnHttpError) {
        switch (err.kind) {
          case "not_found":
            return { ok: false, error: "status_not_found" };
          case "auth":
            return { ok: false, error: "provider_auth_failed" };
          case "malformed":
            return { ok: false, error: "provider_response_invalid" };
          case "rejected":
            return { ok: false, error: "status_not_found" };
          default:
            return { ok: false, error: "provider_unavailable" };
        }
      }
      return { ok: false, error: "provider_unavailable" };
    }
  }

  /**
   * Callback verification per the official (unsigned) MTN contract — see the
   * module header. Never throws: every failure is a fail-closed VerifiedCallback.
   */
  async verifyCallback(req: CallbackRequest): Promise<VerifiedCallback> {
    if (typeof req.rawBody !== "string" || req.rawBody.length === 0) {
      return { ok: false, error: "empty_callback_body" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(req.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "callback_malformed_json" };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "callback_malformed_json" };
    }

    const rawStatus = typeof payload.status === "string" ? payload.status.trim() : "";
    if (!rawStatus) return { ok: false, error: "callback_missing_status" };

    const reference =
      typeof payload.externalId === "string" && payload.externalId.trim().length > 0
        ? payload.externalId.trim()
        : "";
    if (!reference) return { ok: false, error: "callback_missing_reference" };

    // Amount/currency are part of the official final-callback payload and are
    // REQUIRED so callbackSettle can cross-check them against the ledger —
    // a callback without them cannot prove anything.
    const amount =
      typeof payload.amount === "string" || typeof payload.amount === "number"
        ? Number(payload.amount)
        : NaN;
    const currency = typeof payload.currency === "string" ? payload.currency.trim() : "";
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "callback_invalid_amount" };
    }
    if (!currency) return { ok: false, error: "callback_invalid_currency" };

    // AUTHORITATIVE RE-QUERY — the authenticity mechanism of the unsigned
    // official contract (module header). Settlement requires the provider's
    // own status to agree with the callback.
    let authoritative: string;
    let financialTransactionId: string | null;
    let queriedAmount: string | null;
    let queriedCurrency: string | null;
    try {
      const tx = await this.fetchTransactionStatus(reference);
      authoritative = tx.status;
      financialTransactionId = tx.financialTransactionId;
      queriedAmount = tx.amount;
      queriedCurrency = tx.currency;
    } catch {
      // Network/auth/not-found/malformed → fail closed; zero ledger writes.
      // The existing status-polling path (payment-status) reconciles later.
      return { ok: false, error: "callback_verification_unavailable" };
    }

    if (authoritative.toUpperCase() !== rawStatus.toUpperCase()) {
      // Disagreement between webhook and authoritative status → never settle.
      return { ok: false, error: "callback_status_mismatch" };
    }

    // Belt-and-braces: when the status endpoint echoes amount/currency, they
    // must agree with the callback too (all three must match the ledger).
    if (queriedAmount !== null && Number(queriedAmount) !== amount) {
      return { ok: false, error: "callback_amount_mismatch" };
    }
    if (queriedCurrency !== null && queriedCurrency.toUpperCase() !== currency.toUpperCase()) {
      return { ok: false, error: "callback_currency_mismatch" };
    }

    return {
      ok: true,
      reference,
      providerReference:
        financialTransactionId ??
        (typeof payload.financialTransactionId === "string"
          ? payload.financialTransactionId
          : null),
      reportedAmountUgx: amount,
      reportedCurrency: currency.toUpperCase(),
      rawStatus,
    };
  }

  /**
   * Official status vocabulary → normalized states.
   * SUCCESSFUL → confirmed, FAILED → failed, PENDING → pending, anything else
   * (including TIMEOUT etc.) → null = unknown, ledger stays untouched.
   */
  normalizeStatus(rawStatus: string): NormalizedStatus | null {
    switch (String(rawStatus).trim().toUpperCase()) {
      case "SUCCESSFUL":
        return "confirmed";
      case "FAILED":
        return "failed";
      case "PENDING":
        return "pending";
      default:
        return null;
    }
  }
}

export function createMtnMomoAdapter(deps: MtnMomoAdapterDeps = {}): MtnMomoAdapter {
  return new MtnMomoAdapter(deps);
}

/**
 * Production singleton, registered into the shared registry at module load.
 * Only the three MTN-facing endpoints import this module — Airtel and PesaPal
 * remain unregistered/fail-closed.
 */
export const mtnMomoAdapter = new MtnMomoAdapter();
registerProviderAdapter(mtnMomoAdapter);
