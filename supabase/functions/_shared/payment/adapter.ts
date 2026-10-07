/**
 * M3-C — provider adapter contract + registry (server-side).
 *
 * The contract is deliberately tiny and provider-blind:
 *   initiate      — push the payment to the provider (ledger-derived inputs)
 *   queryStatus   — recovery path when a callback is delayed/missing
 *   verifyCallback— provider-specific signature verification over the RAW body
 *   normalize     — provider status vocabulary → M1 settlement states
 *
 * Refunds are deferred (M3-C is collection-only; refund policy undecided).
 *
 * No MTN / Airtel implementation lives here — PROVIDER DOCUMENTATION REQUIRED.
 * The registry starts EMPTY; provider adapters (M3-F/M3-G) register themselves
 * at module load of their own files, which payment endpoints only import once
 * those providers exist. The fake adapter used by tests is intentionally NOT
 * registered here, so it is unreachable from production endpoints.
 */

import type {
  CallbackRequest,
  InitiateOutcome,
  InitiateRequest,
  NormalizedStatus,
  ProviderId,
  QueryStatusOutcome,
  QueryStatusRequest,
  VerifiedCallback,
} from "./types.ts";

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** False when required Deno.env secrets are missing — initiate must fail closed. */
  isConfigured(): boolean;
  initiate(req: InitiateRequest): Promise<InitiateOutcome>;
  queryStatus(req: QueryStatusRequest): Promise<QueryStatusOutcome>;
  /** Signature verification over rawBody FIRST; never parse-then-verify. */
  verifyCallback(req: CallbackRequest): Promise<VerifiedCallback>;
  /** Provider status vocabulary → M1 states; null = unknown (stay pending). */
  normalizeStatus(rawStatus: string): NormalizedStatus | null;
}

const registry = new Map<string, ProviderAdapter>();

/** Called by M3-F/M3-G provider modules at load time (never by tests' fakes). */
export function registerProviderAdapter(adapter: ProviderAdapter): void {
  registry.set(adapter.id, adapter);
}

/** Production lookup used by the payment endpoints; empty until M3-F/M3-G. */
export function getProviderAdapter(provider: string): ProviderAdapter | null {
  return registry.get(provider) ?? null;
}

/**
 * Single source of truth for "a normalized provider status means settle how".
 * Shared by payment-status (M3-C) and the future callback endpoints (M3-E),
 * so polling and webhooks can never diverge on the mapping.
 */
export type SettlementAction =
  | { action: "confirm" }
  | { action: "fail"; reason: string }
  | { action: "cancel"; reason: string }
  | { action: "none" };

export function settlementActionFor(status: NormalizedStatus | null): SettlementAction {
  switch (status) {
    case "confirmed":
      return { action: "confirm" };
    case "failed":
      return { action: "fail", reason: "provider_reported_failure" };
    case "cancelled":
      return { action: "cancel", reason: "provider_reported_cancellation" };
    default:
      // "pending" or unknown → leave the ledger untouched.
      return { action: "none" };
  }
}
