/**
 * M3-C — payment ledger access + the provider-agnostic initiate/status flows.
 *
 * Everything here is pure TypeScript with structural client interfaces, so the
 * same code runs inside Deno Edge Functions (with a real supabase-js client)
 * and inside the node/vitest suites (with fakes). No Deno/npm/https imports.
 *
 * Ledger rules enforced here (M1/M3-A invariants):
 *   - authorization runs FIRST and fails closed (foreign payment ⇒ the same
 *     not-found answer as a missing payment — no UUID oracle);
 *   - only a `pending` payment may be initiated or queried into settlement;
 *   - once initiation is recorded (`metadata.initiated_at`), NO second
 *     provider transaction is ever started;
 *   - amount/currency/reference always come from the row, never the client;
 *   - settlement happens ONLY through the M1 RPCs (confirm/fail/cancel) —
 *     this module never updates subscriptions or payment status directly;
 *   - timeout / provider-unavailable leaves the payment pending (a timeout is
 *     not proof of rejection); only a definite provider rejection calls fail
 *     (status_reason = provider_error).
 */

import { settlementActionFor } from "./adapter.ts";
import type { ProviderAdapter } from "./adapter.ts";
import type {
  FlowResult,
  InitiateOutcome,
  PaymentRow,
  QueryStatusOutcome,
} from "./types.ts";
import { hasProviderInitiated, isValidE164, providerReferenceOf } from "./types.ts";

const PAYMENT_COLUMNS =
  "id, subscription_id, organization_id, shop_id, provider, reference, status, status_reason, amount_ugx, currency, created_at, confirmed_at, metadata";

/** Structural slices of supabase-js satisfied by the real client and by tests. */
export type RpcClientLike = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type QueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export type RpcResult = { ok: boolean; error?: string } & Record<string, unknown>;

export const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;

const TIMED_OUT = Symbol("provider_timeout");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  // Keep a rejection handler attached so a rejection that lands after the
  // timeout has already won the race cannot surface as an unhandled rejection.
  void promise.catch(() => undefined);
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Ledger reads / RPC wrappers
// ---------------------------------------------------------------------------

export async function fetchPaymentRow(
  client: QueryClientLike,
  paymentId: string,
): Promise<PaymentRow | null> {
  const { data, error } = await client
    .from("subscription_payments")
    .select(PAYMENT_COLUMNS)
    .eq("id", paymentId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: String(data.id),
    subscription_id: String(data.subscription_id),
    organization_id: String(data.organization_id),
    shop_id: data.shop_id === null || data.shop_id === undefined ? null : String(data.shop_id),
    provider: String(data.provider ?? ""),
    reference:
      data.reference === null || data.reference === undefined ? null : String(data.reference),
    status: String(data.status ?? ""),
    status_reason:
      data.status_reason === null || data.status_reason === undefined
        ? null
        : String(data.status_reason),
    amount_ugx: Number(data.amount_ugx ?? 0),
    currency: String(data.currency ?? "UGX"),
    created_at: String(data.created_at ?? ""),
    confirmed_at:
      data.confirmed_at === null || data.confirmed_at === undefined
        ? null
        : String(data.confirmed_at),
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {},
  };
}

async function callRpc(
  client: RpcClientLike,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await client.rpc(name, args);
  if (error) return { ok: false, error: error.message || "rpc_failed" };
  const body = (data ?? {}) as Record<string, unknown>;
  if (typeof body.ok === "boolean") return body as RpcResult;
  return { ok: false, error: "rpc_failed" };
}

export function attachProviderMeta(
  client: RpcClientLike,
  args: { payment_id: string; provider_reference: string | null; phone: string; initiated_at?: string },
): Promise<RpcResult> {
  return callRpc(client, "subscription_payment_provider_attach", {
    p_payment_id: args.payment_id,
    p_provider_reference: args.provider_reference,
    p_phone: args.phone,
    p_initiated_at: args.initiated_at ?? null,
  });
}

export function confirmPayment(client: RpcClientLike, paymentId: string): Promise<RpcResult> {
  return callRpc(client, "subscription_payment_confirm", {
    p_payment_id: paymentId,
    p_reference: null,
    p_note: null,
  });
}

export function failPayment(
  client: RpcClientLike,
  paymentId: string,
  reason: string,
): Promise<RpcResult> {
  return callRpc(client, "subscription_payment_fail", {
    p_payment_id: paymentId,
    p_reason: reason,
  });
}

export function cancelPayment(
  client: RpcClientLike,
  paymentId: string,
  reason: string,
): Promise<RpcResult> {
  return callRpc(client, "subscription_payment_cancel", {
    p_payment_id: paymentId,
    p_reason: reason,
  });
}

// ---------------------------------------------------------------------------
// Initiate flow (payment-initiate Edge Function core)
// ---------------------------------------------------------------------------

export type InitiateFlowDeps = {
  /** Authorization oracle — must run with the CALLER's identity (M3-B get). */
  authorize: () => Promise<{ ok: boolean; error?: string }>;
  /** Full row via the service role (includes server-only metadata). */
  fetchRow: () => Promise<PaymentRow | null>;
  attach: (input: {
    provider_reference: string | null;
    phone: string;
  }) => Promise<RpcResult>;
  fail: (reason: string) => Promise<RpcResult>;
  resolveAdapter: (provider: string) => ProviderAdapter | null;
  phone: string;
  timeoutMs?: number;
};

export async function runInitiateFlow(deps: InitiateFlowDeps): Promise<FlowResult> {
  // 1. Caller authorization first, fail closed (foreign ⇒ payment_not_found).
  const authz = await deps.authorize();
  if (!authz.ok) {
    return { ok: false, error: authz.error || "payment_not_found" };
  }

  const row = await deps.fetchRow();
  if (!row) {
    return { ok: false, error: "payment_not_found" };
  }

  // 2. Only pending payments can be initiated.
  if (row.status !== "pending") {
    return { ok: false, error: "payment_not_pending", payment_id: row.id, status: row.status };
  }

  // 3. Idempotency: never start a second provider transaction.
  if (hasProviderInitiated(row.metadata)) {
    return {
      ok: true,
      idempotent: true,
      already_initiated: true,
      payment_id: row.id,
      status: "pending",
      provider_reference: providerReferenceOf(row.metadata),
    };
  }

  // 4. Input validation (the ONLY client input besides payment_id).
  if (!isValidE164(deps.phone)) {
    return { ok: false, error: "invalid_phone", payment_id: row.id, status: row.status };
  }

  // 5. Provider inputs are ledger-derived: reference/amount/currency from the row.
  if (!row.reference) {
    return { ok: false, error: "reference_missing", payment_id: row.id, status: row.status };
  }

  const adapter = deps.resolveAdapter(row.provider);
  if (!adapter || !adapter.isConfigured()) {
    return {
      ok: false,
      error: "provider_not_configured",
      payment_id: row.id,
      status: row.status,
    };
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  let outcome: InitiateOutcome | typeof TIMED_OUT;
  try {
    outcome = await withTimeout(
      adapter.initiate({
        reference: row.reference,
        amountUgx: row.amount_ugx,
        currency: row.currency,
        phone: deps.phone,
      }),
      timeoutMs,
    );
  } catch {
    // Thrown transport error = unknown provider state → leave pending.
    outcome = { ok: false, error: "provider_unavailable", retryable: true };
  }

  // 6a. Timeout: NOT proof of rejection → pending, safe to retry / recover.
  if (outcome === TIMED_OUT) {
    return { ok: false, error: "initiate_timeout", payment_id: row.id, status: "pending", retryable: true };
  }

  if (!outcome.ok) {
    // 6b. Retryable provider error → pending (state unknown).
    if (outcome.retryable) {
      return {
        ok: false,
        error: outcome.error || "provider_unavailable",
        payment_id: row.id,
        status: "pending",
        retryable: true,
      };
    }
    // 6c. Definite provider rejection → fail the payment (status_reason =
    //     provider_error is set by the M1 fail RPC).
    const failed = await deps.fail("provider_error");
    if (!failed.ok) {
      return {
        ok: false,
        error: failed.error || "settle_failed",
        payment_id: row.id,
        status: row.status,
        retryable: true,
      };
    }
    return { ok: false, error: "provider_rejected", payment_id: row.id, status: "failed" };
  }

  // 7. Provider accepted → record the linkage (idempotent marker for retries).
  const attached = await deps.attach({
    provider_reference: outcome.providerReference ?? null,
    phone: deps.phone,
  });
  if (!attached.ok) {
    // Money may already be in flight: do NOT fail the payment. Recovery is
    // payment-status (query by our reference) or an operator.
    return { ok: false, error: "attach_failed", payment_id: row.id, status: "pending", retryable: false };
  }

  return {
    ok: true,
    payment_id: row.id,
    status: "pending",
    provider_reference:
      typeof attached.provider_reference === "string"
        ? attached.provider_reference
        : (outcome.providerReference ?? null),
  };
}

// ---------------------------------------------------------------------------
// Status/recovery flow (payment-status Edge Function core)
// ---------------------------------------------------------------------------

export type StatusFlowDeps = {
  /** Caller-identity authorization oracle (M3-B get). */
  authorize: () => Promise<{ ok: boolean; error?: string }>;
  fetchRow: () => Promise<PaymentRow | null>;
  confirm: () => Promise<RpcResult>;
  fail: (reason: string) => Promise<RpcResult>;
  cancel: (reason: string) => Promise<RpcResult>;
  resolveAdapter: (provider: string) => ProviderAdapter | null;
  timeoutMs?: number;
};

export async function runStatusFlow(deps: StatusFlowDeps): Promise<FlowResult> {
  const authz = await deps.authorize();
  if (!authz.ok) {
    return { ok: false, error: authz.error || "payment_not_found" };
  }

  const row = await deps.fetchRow();
  if (!row) {
    return { ok: false, error: "payment_not_found" };
  }

  // Terminal (or non-pending) → report the ledger state, touch nothing.
  if (row.status !== "pending") {
    return {
      ok: true,
      payment_id: row.id,
      status: row.status,
      status_reason: row.status_reason,
    };
  }

  if (!hasProviderInitiated(row.metadata)) {
    return { ok: false, error: "not_initiated", payment_id: row.id, status: "pending" };
  }

  const adapter = deps.resolveAdapter(row.provider);
  if (!adapter || !adapter.isConfigured()) {
    return { ok: false, error: "provider_not_configured", payment_id: row.id, status: "pending" };
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  let query: QueryStatusOutcome | typeof TIMED_OUT;
  try {
    query = await withTimeout(
      adapter.queryStatus({
        reference: row.reference ?? "",
        providerReference: providerReferenceOf(row.metadata),
      }),
      timeoutMs,
    );
  } catch {
    query = { ok: false, error: "provider_query_failed" };
  }

  if (query === TIMED_OUT) {
    return { ok: false, error: "provider_query_timeout", payment_id: row.id, status: "pending", retryable: true };
  }
  if (!query.ok) {
    return {
      ok: false,
      error: query.error || "provider_query_failed",
      payment_id: row.id,
      status: "pending",
      retryable: true,
    };
  }

  const action = settlementActionFor(adapter.normalizeStatus(query.rawStatus));

  if (action.action === "none") {
    // Unknown or still-pending provider status → ledger untouched.
    return { ok: true, payment_id: row.id, status: "pending", provider_status: query.rawStatus };
  }

  let settled: RpcResult;
  if (action.action === "confirm") settled = await deps.confirm();
  else if (action.action === "fail") settled = await deps.fail(action.reason);
  else settled = await deps.cancel(action.reason);

  if (!settled.ok) {
    // Settlement refused (e.g. subscription_conflict, or a racing callback
    // settled it first) → report the truth from the ledger.
    const after = await deps.fetchRow();
    return {
      ok: false,
      error: settled.error || "settle_failed",
      payment_id: row.id,
      status: after?.status ?? row.status,
      status_reason: after?.status_reason ?? null,
    };
  }

  return {
    ok: true,
    payment_id: row.id,
    status: typeof settled.status === "string" ? settled.status : undefined,
    idempotent: settled.idempotent === true,
    provider_status: query.rawStatus,
    period_start: typeof settled.period_start === "string" ? settled.period_start : undefined,
    period_end: typeof settled.period_end === "string" ? settled.period_end : undefined,
  };
}
