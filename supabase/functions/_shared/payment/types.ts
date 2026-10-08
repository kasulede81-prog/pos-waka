/**
 * M3-C — payment provider types (server-side, provider-agnostic).
 *
 * Pure types with zero imports: usable from Deno Edge Functions and from the
 * node/vitest test suites alike.
 *
 * Boundary rule (enforced by these types): a provider adapter only ever
 * receives primitives DERIVED FROM THE LEDGER (our reference, amount,
 * currency) plus the single customer input (phone). It never sees — and can
 * never decide — plan, subscription, organization, shop, entitlement or
 * billing period. The payment ledger (M1/M3-A) is authoritative; settlement
 * happens only through the M1 RPCs.
 */

/** M1's provider token shape: ^[a-z][a-z0-9_]{1,31}$ (mtn_momo, airtel_money, …). */
export type ProviderId = "mtn_momo" | "airtel_money" | (string & {});

/** Normalized settlement states — exactly M1's legal provider-facing outcomes. */
export type NormalizedStatus = "pending" | "confirmed" | "failed" | "cancelled";

/** Full payment row as read with the service role (includes server-only metadata). */
export type PaymentRow = {
  id: string;
  subscription_id: string;
  organization_id: string;
  shop_id: string | null;
  provider: string;
  reference: string | null;
  status: string;
  status_reason: string | null;
  amount_ugx: number;
  currency: string;
  created_at: string;
  confirmed_at: string | null;
  metadata: Record<string, unknown>;
};

/** Everything the adapter may receive — ledger-derived except `phone`. */
export type InitiateRequest = {
  /** OUR external id, stored in subscription_payments.reference. */
  reference: string;
  amountUgx: number;
  currency: string;
  /** Customer-controlled push-payment target (validated E.164 by the server). */
  phone: string;
  description?: string;
};

export type InitiateOutcome =
  | { ok: true; providerReference?: string | null }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      /**
       * M3-G observability: which provider leg failed — "token" | "requesttopay"
       * | "response". Diagnostic only (no secrets); used by ledger.ts to record
       * a stage-specific reconciliation reason on the payment. Optional so
       * provider-agnostic fixtures compile unchanged.
       */
      stage?: "token" | "requesttopay" | "response";
      /**
       * Sanitized provider response diagnostic for the failed leg: the HTTP
       * status and the provider's own error CODE (a bounded token, never the
       * message — provider messages can echo request data).
       *
       * Deliberately NOT part of the reconciliation reason. Reasons are constant
       * strings by contract (ledger.stageReason), which is what guarantees no
       * provider text can reach a history payload; this rides alongside so the
       * failure is diagnosable from the function log without weakening that.
       */
      providerStatus?: number;
      providerCode?: string;
    };

export type QueryStatusRequest = {
  reference: string;
  providerReference: string | null;
};

export type QueryStatusOutcome =
  | { ok: true; rawStatus: string; providerReference?: string | null }
  | { ok: false; error: string };

/** Raw callback material — the body MUST be the untouched request text (HMAC). */
export type CallbackRequest = {
  rawBody: string;
  headers: Record<string, string>;
};

/**
 * Verified callback. `reference` is OUR payment reference extracted by the
 * provider-specific verifier; reported amount/currency are optional (whether
 * a provider reports them is PROVIDER DOCUMENTATION REQUIRED) and are only
 * ever used to cross-check the ledger — never to set it.
 */
export type VerifiedCallback =
  | {
      ok: true;
      reference: string;
      providerReference?: string | null;
      reportedAmountUgx?: number | null;
      reportedCurrency?: string | null;
      rawStatus: string;
    }
  | { ok: false; error: string };

/** Shared result envelope for the initiate/status flows. */
export type FlowResult = {
  ok: boolean;
  error?: string;
  payment_id?: string;
  status?: string;
  status_reason?: string | null;
  idempotent?: boolean;
  already_initiated?: boolean;
  provider_reference?: string | null;
  provider_status?: string | null;
  retryable?: boolean;
  period_start?: string;
  period_end?: string;
};

/** Phone validation shared by Edge input and the attach RPC (server-side). */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** Our reference must exist for a provider call (M3-A create accepts it). */
export function hasProviderInitiated(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.initiated_at === "string" ||
    typeof metadata.provider_reference === "string"
  );
}

export function providerReferenceOf(metadata: Record<string, unknown>): string | null {
  return typeof metadata.provider_reference === "string" && metadata.provider_reference.length > 0
    ? metadata.provider_reference
    : null;
}
