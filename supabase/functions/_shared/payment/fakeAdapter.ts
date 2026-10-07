/**
 * M3-C — TEST-ONLY fake provider adapter.
 *
 * NEVER import this from a production endpoint: payment-initiate /
 * payment-status resolve adapters through the registry in adapter.ts, which
 * stays EMPTY until the real M3-F (MTN) / M3-G (Airtel) adapters register
 * themselves. The fake is passed directly to the flows by tests only.
 *
 * Simulates: accepted initiation (with/without provider reference), pending
 * status, confirmed, failed, cancelled, unknown status, provider error
 * (retryable or definite) and slow responses (timeout).
 */

import type { ProviderAdapter } from "./adapter.ts";
import type {
  CallbackRequest,
  InitiateOutcome,
  InitiateRequest,
  NormalizedStatus,
  QueryStatusOutcome,
  QueryStatusRequest,
  VerifiedCallback,
} from "./types.ts";

export type FakeAdapterConfig = {
  /** Outcome of the NEXT initiate call (default: accepted with a provider ref). */
  initiateOutcome?: InitiateOutcome;
  /** Simulated network delay for initiate (ms) — used to trigger timeouts. */
  initiateDelayMs?: number;
  /** Outcome of the NEXT queryStatus call (default: reports `queryRawStatus`). */
  queryOutcome?: QueryStatusOutcome;
  queryRawStatus?: string;
  queryDelayMs?: number;
  /** Raw status the fake verifies out of a callback body as `rawStatus`. */
  callbackRawStatus?: string;
  callbackReference?: string;
  callbackShouldFail?: boolean;
};

export class FakePaymentAdapter implements ProviderAdapter {
  readonly id = "fake_provider";
  readonly displayName = "Fake Provider (tests only)";
  configured = true;

  initiateCalls: InitiateRequest[] = [];
  queryCalls: QueryStatusRequest[] = [];
  verifyCalls: CallbackRequest[] = [];

  private config: FakeAdapterConfig;

  constructor(config: FakeAdapterConfig = {}) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async initiate(req: InitiateRequest): Promise<InitiateOutcome> {
    this.initiateCalls.push({ ...req });
    if (this.config.initiateDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.initiateDelayMs));
    }
    return (
      this.config.initiateOutcome ?? { ok: true, providerReference: "fake-tx-0001" }
    );
  }

  async queryStatus(req: QueryStatusRequest): Promise<QueryStatusOutcome> {
    this.queryCalls.push({ ...req });
    if (this.config.queryDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.queryDelayMs));
    }
    if (this.config.queryOutcome) return this.config.queryOutcome;
    return { ok: true, rawStatus: this.config.queryRawStatus ?? "PENDING" };
  }

  async verifyCallback(req: CallbackRequest): Promise<VerifiedCallback> {
    this.verifyCalls.push({ rawBody: req.rawBody, headers: { ...req.headers } });
    if (this.config.callbackShouldFail) {
      return { ok: false, error: "bad_signature" };
    }
    return {
      ok: true,
      reference: this.config.callbackReference ?? "unused",
      rawStatus: this.config.callbackRawStatus ?? "CONFIRMED",
    };
  }

  normalizeStatus(rawStatus: string): NormalizedStatus | null {
    const s = rawStatus.trim().toUpperCase();
    if (s === "CONFIRMED" || s === "SUCCESS" || s === "SUCCESSFUL") return "confirmed";
    if (s === "FAILED" || s === "DECLINED" || s === "REJECTED") return "failed";
    if (s === "CANCELLED" || s === "EXPIRED" || s === "TIMEOUT_EXPIRED") return "cancelled";
    if (s === "PENDING" || s === "PROCESSING") return "pending";
    return null; // unknown → stay pending
  }
}
