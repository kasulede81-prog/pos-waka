/**
 * M3-E — generic provider callback settlement core (provider-agnostic).
 *
 * Pure TypeScript with injected dependencies (same pattern as ledger.ts), so
 * node/vitest can exercise the entire callback pipeline while the Deno shells
 * only do HTTP glue.
 *
 * Pipeline order is the security contract:
 *   1. POST only                          → 405 invalid_callback
 *   2. bounded raw body (byte length)     → 413 invalid_callback
 *   3. optional rate limit                → 429 rate_limited   (dependency;
 *      not wired yet — see shells: the existing edge_rate_limit buckets are
 *      DB-constrained to scope ('card_read','wallet_issue') and extending
 *      them would require editing loyalty code + a second migration)
 *   4. adapter present/configured         → 503 provider_not_configured
 *   5. signature verification over the RAW body, before any parsing/trust,
 *      before ANY ledger lookup            → 401 invalid_signature
 *      (or 400 invalid_callback for a verified-but-malformed payload)
 *   6. read-only lookup by (provider, reference) → 200 unknown_reference
 *      (callbacks can never create a payment)
 *   7. amount/currency cross-check against the immutable ledger row
 *                                                → 200 amount_mismatch
 *   8. normalize status → settlementActionFor → M1 RPCs ONLY
 *      confirmed | failed | cancelled     → 200 {ok:true, reason:…}
 *      pending/unknown                    → 200 {ok:true, reason:'pending'}
 *      ledger refusal:
 *        confirm + payment_not_confirmable → 200 stale_success  (Option A)
 *        anything else                     → 200 settle_refused
 *        transport/rpc failure             → 500 settle_refused (retryable)
 *
 * Reconciliation signals are structured console.error lines with a stable
 * taxonomy — never raw bodies, signatures, headers, secrets or SQL errors.
 * Raw callback payloads are never persisted anywhere (Option "no raw storage").
 */

import { settlementActionFor } from "./adapter.ts";
import type { ProviderAdapter } from "./adapter.ts";
import { verifyCallbackWith } from "./verifyCallback.ts";
import type { RpcClientLike } from "./ledger.ts";
import type { NormalizedStatus, VerifiedCallback } from "./types.ts";

/** Default cap: 256 KiB — generous for provider callbacks, hostile to floods. */
export const DEFAULT_MAX_CALLBACK_BYTES = 262_144;

/** M1 settlement errors safe to echo (fixed vocabulary, never SQL text). */
const SAFE_RPC_ERRORS = new Set([
  "payment_not_confirmable",
  "subscription_conflict",
  "forbidden",
  "payment_not_found",
  "reference_mismatch",
  "reference_conflict",
  "checkout_invalid",
  "payment_not_failed",
  "payment_not_cancelable",
]);

export type LookupOutcome = {
  ok: boolean;
  error?: string;
  payment_id?: string;
  status?: string;
  amount_ugx?: number;
  currency?: string;
  reference?: string;
};

export type CallbackSettleDeps = {
  /** Our provider id (from the endpoint path), e.g. "mtn_momo". */
  provider: string;
  method: string;
  /** RAW body text — read before any parsing, verified before any trust. */
  rawBody: string;
  headers: Record<string, string>;
  /** Null / unconfigured registry entry ⇒ fail closed (M3-F/M3-G register later). */
  adapter: ProviderAdapter | null;
  /** Read-only `subscription_payment_lookup(provider, reference)`. */
  lookup: (provider: string, reference: string) => Promise<LookupOutcome>;
  /** Existing M1 settlement RPC wrappers — never direct table writes. */
  confirm: (paymentId: string) => Promise<RpcResultLike>;
  fail: (paymentId: string, reason: string) => Promise<RpcResultLike>;
  cancel: (paymentId: string, reason: string) => Promise<RpcResultLike>;
  /** Optional durable rate limit; absent ⇒ not wired (documented limitation). */
  rateLimit?: (key: string) => Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  /** M3-G — optional auditable reconciliation marker (stale_success etc.). */
  flagReconciliation?: (paymentId: string, reason: string) => Promise<RpcResultLike>;
  maxBodyBytes?: number;
};

export type RpcResultLike = { ok: boolean; error?: string } & Record<string, unknown>;

export type CallbackSettleResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function emit(provider: string, event: "reconciliation" | "rejected", reason: string, extra?: Record<string, unknown>): void {
  // Structured signal only: never raw bodies, headers, signatures or secrets.
  console.error(
    "[payment-callback] " +
      JSON.stringify({
        event,
        provider,
        reason,
        received_at: new Date().toISOString(),
        ...(extra ?? {}),
      }),
  );
}

function safeRpcError(result: RpcResultLike): string {
  const code = typeof result.error === "string" ? result.error : "";
  return SAFE_RPC_ERRORS.has(code) ? code : "rpc_failed";
}

/** Read-only lookup wrapper shared by the provider endpoint shells. */
export async function lookupPaymentByReference(
  client: RpcClientLike,
  provider: string,
  reference: string,
): Promise<LookupOutcome> {
  const { data, error } = await client.rpc("subscription_payment_lookup", {
    p_provider: provider,
    p_reference: reference,
  });
  if (error) return { ok: false, error: "rpc_failed" };
  const body = (data ?? {}) as Record<string, unknown>;
  if (body.ok === true) {
    return {
      ok: true,
      payment_id: typeof body.payment_id === "string" ? body.payment_id : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      amount_ugx: typeof body.amount_ugx === "number" ? body.amount_ugx : undefined,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      reference: typeof body.reference === "string" ? body.reference : undefined,
    };
  }
  return {
    ok: false,
    error: typeof body.error === "string" ? body.error : "rpc_failed",
  };
}

export async function runCallbackSettlement(deps: CallbackSettleDeps): Promise<CallbackSettleResult> {
  const body = (content: Record<string, unknown>, httpStatus: number): CallbackSettleResult => ({
    httpStatus,
    body: content,
  });

  // 1. POST only.
  if (deps.method !== "POST") {
    return body({ ok: false, reason: "invalid_callback" }, 405);
  }

  // 2. Bounded raw body (bytes, not chars).
  const maxBytes = deps.maxBodyBytes ?? DEFAULT_MAX_CALLBACK_BYTES;
  if (typeof deps.rawBody !== "string" || new TextEncoder().encode(deps.rawBody).length > maxBytes) {
    return body({ ok: false, reason: "invalid_callback" }, 413);
  }

  // 3. Optional durable rate limit (dependency; see module header).
  if (deps.rateLimit) {
    const limit = await deps.rateLimit(`payment_callback:${deps.provider}`);
    if (!limit.allowed) {
      return body(
        {
          ok: false,
          reason: "rate_limited",
          ...(typeof limit.retryAfterSeconds === "number"
            ? { retry_after_seconds: limit.retryAfterSeconds }
            : {}),
        },
        429,
      );
    }
  }

  // 4. Provider must exist and be configured — fail closed until M3-F/M3-G.
  if (!deps.adapter || !deps.adapter.isConfigured()) {
    return body({ ok: false, reason: "provider_not_configured" }, 503);
  }

  // 5. Signature verification over the RAW body — BEFORE parsing/trusting any
  //    callback field and BEFORE any ledger lookup.
  const verified: VerifiedCallback = await verifyCallbackWith(deps.adapter, {
    rawBody: deps.rawBody,
    headers: deps.headers ?? {},
  });

  if (verified.ok !== true) {
    const verificationError = (verified as { error?: string }).error ?? "verification_failed";
    // Verified-but-malformed payloads are 400; anything else is a signature
    // failure → 401. Provider-specific verifier messages are logged, echoed as
    // a deterministic category only.
    const malformed =
      verificationError === "empty_callback_body" ||
      verificationError === "callback_missing_reference" ||
      verificationError === "callback_missing_status";
    if (malformed) {
      emit(deps.provider, "rejected", "invalid_callback");
      return body({ ok: false, reason: "invalid_callback" }, 400);
    }
    emit(deps.provider, "rejected", "invalid_signature");
    return body({ ok: false, reason: "invalid_signature" }, 401);
  }

  // 6. Read-only resolution by OUR reference. Callbacks can never create a
  //    payment; an unknown reference is a deterministic 200 so the provider
  //    does not retry-storm, while still emitting a reconciliation signal.
  const payment = await deps.lookup(deps.provider, verified.reference);
  if (!payment.ok) {
    if (payment.error === "payment_not_found") {
      emit(deps.provider, "reconciliation", "unknown_reference", {
        reference: verified.reference,
      });
      return body({ ok: false, reason: "unknown_reference" }, 200);
    }
    if (payment.error === "rpc_failed") {
      // Transport failure talking to our own ledger — retryable.
      emit(deps.provider, "reconciliation", "settle_refused", {
        reference: verified.reference,
        error: "rpc_failed",
      });
      return body({ ok: false, reason: "settle_refused", error: "rpc_failed" }, 500);
    }
    emit(deps.provider, "reconciliation", "settle_refused", {
      reference: verified.reference,
      error: SAFE_RPC_ERRORS.has(payment.error as string) ? payment.error : "rpc_failed",
    });
    return body(
      {
        ok: false,
        reason: "settle_refused",
        error: SAFE_RPC_ERRORS.has(payment.error as string) ? payment.error : "rpc_failed",
      },
      200,
    );
  }

  const paymentId = payment.payment_id;

  // 7. Amount/currency cross-check against the immutable ledger row.
  //    Callback values are NEVER authoritative — mismatch means we do not
  //    settle at all (no partial settle). Whether a provider supplies these
  //    fields at all is PROVIDER DOCUMENTATION REQUIRED.
  if (verified.reportedAmountUgx !== undefined && verified.reportedAmountUgx !== null) {
    if (
      typeof payment.amount_ugx !== "number" ||
      !Number.isFinite(payment.amount_ugx) ||
      Number(verified.reportedAmountUgx) !== payment.amount_ugx
    ) {
      emit(deps.provider, "reconciliation", "amount_mismatch", {
        payment_id: paymentId,
        reference: verified.reference,
      });
      return body({ ok: false, reason: "amount_mismatch", payment_id: paymentId }, 200);
    }
  }
  if (verified.reportedCurrency !== undefined && verified.reportedCurrency !== null) {
    const reported = String(verified.reportedCurrency).trim().toUpperCase();
    const ledgerCurrency = (payment.currency ?? "").trim().toUpperCase();
    if (!ledgerCurrency || reported !== ledgerCurrency) {
      emit(deps.provider, "reconciliation", "amount_mismatch", {
        payment_id: paymentId,
        reference: verified.reference,
      });
      return body({ ok: false, reason: "amount_mismatch", payment_id: paymentId }, 200);
    }
  }

  // 8. Normalize → shared mapping → M1 settlement RPCs only.
  const normalized: NormalizedStatus | null = deps.adapter.normalizeStatus(verified.rawStatus);
  const action = settlementActionFor(normalized);

  if (action.action === "none") {
    // Unknown or still-pending provider status: ledger untouched.
    return body(
      {
        ok: true,
        reason: "pending",
        payment_id: paymentId,
        status: "pending",
        provider_status: verified.rawStatus,
      },
      200,
    );
  }

  let settled: RpcResultLike;
  if (action.action === "confirm") settled = await deps.confirm(paymentId as string);
  else if (action.action === "fail") settled = await deps.fail(paymentId as string, action.reason);
  else settled = await deps.cancel(paymentId as string, action.reason);

  if (settled.ok === true) {
    const settledStatus =
      typeof settled.status === "string"
        ? settled.status
        : action.action === "confirm"
          ? "confirmed"
          : action.action === "fail"
            ? "failed"
            : "cancelled";
    return body(
      {
        ok: true,
        reason: settledStatus,
        payment_id: paymentId,
        status: settledStatus,
        ...(settled.idempotent === true ? { idempotent: true } : {}),
        provider_status: verified.rawStatus,
      },
      200,
    );
  }

  // Ledger refusal — never modify anything further; classify deterministically.
  const rpcError = safeRpcError(settled);

  if (action.action === "confirm" && rpcError === "payment_not_confirmable") {
    // Provider reports SUCCESS but the payment is terminal (e.g. cancelled by
    // stale replacement): charged-but-unsettled → Option A reconciliation.
    emit(deps.provider, "reconciliation", "stale_success", {
      payment_id: paymentId,
      reference: verified.reference,
    });
    // M3-G: also persist an explicit, auditable operator-review marker
    // (history + audit) — reconciliation must never be log-line-only.
    if (deps.flagReconciliation && paymentId) {
      await deps.flagReconciliation(paymentId, "stale_success");
    }
    return body({ ok: false, reason: "stale_success", payment_id: paymentId }, 200);
  }

  if (rpcError === "rpc_failed") {
    emit(deps.provider, "reconciliation", "settle_refused", {
      payment_id: paymentId,
      error: "rpc_failed",
    });
    return body({ ok: false, reason: "settle_refused", error: "rpc_failed" }, 500);
  }

  emit(deps.provider, "reconciliation", "settle_refused", {
    payment_id: paymentId,
    error: rpcError,
  });
  return body({ ok: false, reason: "settle_refused", payment_id: paymentId, error: rpcError }, 200);
}
