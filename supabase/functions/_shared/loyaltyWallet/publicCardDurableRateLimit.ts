/**
 * Durable Postgres rate limiting for public loyalty Edge Functions (F1/W2).
 * Authoritative across isolates. Never logs raw tokens, IPs, or Save URLs.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CARD_READ_IP_LIMIT,
  CARD_READ_IP_WINDOW_MS,
  CARD_READ_TOKEN_LIMIT,
  CARD_READ_TOKEN_WINDOW_MS,
  ENROLL_JOIN_IP_LIMIT,
  ENROLL_JOIN_IP_WINDOW_MS,
  ENROLL_JOIN_TOKEN_LIMIT,
  ENROLL_JOIN_TOKEN_WINDOW_MS,
  ENROLL_SUBMIT_IP_LIMIT,
  ENROLL_SUBMIT_IP_WINDOW_MS,
  ENROLL_SUBMIT_TOKEN_LIMIT,
  ENROLL_SUBMIT_TOKEN_WINDOW_MS,
  RATE_SCOPE_CARD_READ,
  RATE_SCOPE_ENROLL_JOIN,
  RATE_SCOPE_ENROLL_SUBMIT,
  RATE_SCOPE_WALLET_ISSUE,
  WALLET_ISSUE_IP_LIMIT,
  WALLET_ISSUE_IP_WINDOW_MS,
  WALLET_ISSUE_TOKEN_LIMIT,
  WALLET_ISSUE_TOKEN_WINDOW_MS,
  hashRateLimitKey,
  resolveIpHashForRateLimit,
  type RateScope,
} from "./publicCardDurableRateLimitCore.ts";

export * from "./publicCardDurableRateLimitCore.ts";

export type DurableRateLimitResult =
  | { ok: true }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; error: "unavailable" };

/**
 * Call durable edge_rate_limit_consume via service role.
 * Fail-closed on transport / RPC errors (caller must not mint Wallet).
 */
export async function consumeDurableRateLimit(
  supabaseUrl: string,
  serviceKey: string,
  args: {
    scope: RateScope;
    ipHash: string;
    tokenHash: string | null;
    ipLimit: number;
    ipWindowMs: number;
    tokenLimit: number;
    tokenWindowMs: number;
  },
): Promise<DurableRateLimitResult> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("edge_rate_limit_consume", {
      p_scope: args.scope,
      p_ip_hash: args.ipHash,
      p_token_hash: args.tokenHash,
      p_ip_limit: args.ipLimit,
      p_ip_window_ms: args.ipWindowMs,
      p_token_limit: args.tokenLimit,
      p_token_window_ms: args.tokenWindowMs,
    });
    if (error) return { ok: false, error: "unavailable" };

    const body = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return { ok: false, error: "unavailable" };
    if (body.ok === true) return { ok: true };
    if (body.error === "rate_limited") {
      return {
        ok: false,
        error: "rate_limited",
        retryAfterSeconds: Math.max(1, Math.trunc(Number(body.retry_after_seconds ?? 1))),
      };
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function enforceCardReadRateLimit(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
  publicCardToken: string | null,
): Promise<DurableRateLimitResult> {
  const ipHash = await resolveIpHashForRateLimit(req);
  const tokenHash =
    publicCardToken && publicCardToken.trim()
      ? await hashRateLimitKey(`token:${publicCardToken.trim()}`)
      : null;
  return consumeDurableRateLimit(supabaseUrl, serviceKey, {
    scope: RATE_SCOPE_CARD_READ,
    ipHash,
    tokenHash,
    ipLimit: CARD_READ_IP_LIMIT,
    ipWindowMs: CARD_READ_IP_WINDOW_MS,
    tokenLimit: CARD_READ_TOKEN_LIMIT,
    tokenWindowMs: CARD_READ_TOKEN_WINDOW_MS,
  });
}

/**
 * Wallet issuance limiter — MUST run before Wallet env/signing/Google API.
 * Token hash is required (W2 hard protection).
 */
export async function enforceWalletIssueRateLimit(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
  publicCardToken: string,
): Promise<DurableRateLimitResult> {
  const trimmed = publicCardToken.trim();
  if (!trimmed) return { ok: false, error: "unavailable" };
  const ipHash = await resolveIpHashForRateLimit(req);
  const tokenHash = await hashRateLimitKey(`token:${trimmed}`);
  return consumeDurableRateLimit(supabaseUrl, serviceKey, {
    scope: RATE_SCOPE_WALLET_ISSUE,
    ipHash,
    tokenHash,
    ipLimit: WALLET_ISSUE_IP_LIMIT,
    ipWindowMs: WALLET_ISSUE_IP_WINDOW_MS,
    tokenLimit: WALLET_ISSUE_TOKEN_LIMIT,
    tokenWindowMs: WALLET_ISSUE_TOKEN_WINDOW_MS,
  });
}

/** Preview join page — enroll_join scope. */
export async function enforceEnrollJoinRateLimit(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
  enrollToken: string | null,
): Promise<DurableRateLimitResult> {
  const ipHash = await resolveIpHashForRateLimit(req);
  const tokenHash =
    enrollToken && enrollToken.trim()
      ? await hashRateLimitKey(`enroll:${enrollToken.trim()}`)
      : null;
  return consumeDurableRateLimit(supabaseUrl, serviceKey, {
    scope: RATE_SCOPE_ENROLL_JOIN,
    ipHash,
    tokenHash,
    ipLimit: ENROLL_JOIN_IP_LIMIT,
    ipWindowMs: ENROLL_JOIN_IP_WINDOW_MS,
    tokenLimit: ENROLL_JOIN_TOKEN_LIMIT,
    tokenWindowMs: ENROLL_JOIN_TOKEN_WINDOW_MS,
  });
}

/** Submit enrollment — stricter enroll_submit scope; token hash required. */
export async function enforceEnrollSubmitRateLimit(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
  enrollToken: string,
): Promise<DurableRateLimitResult> {
  const trimmed = enrollToken.trim();
  if (!trimmed) return { ok: false, error: "unavailable" };
  const ipHash = await resolveIpHashForRateLimit(req);
  const tokenHash = await hashRateLimitKey(`enroll:${trimmed}`);
  return consumeDurableRateLimit(supabaseUrl, serviceKey, {
    scope: RATE_SCOPE_ENROLL_SUBMIT,
    ipHash,
    tokenHash,
    ipLimit: ENROLL_SUBMIT_IP_LIMIT,
    ipWindowMs: ENROLL_SUBMIT_IP_WINDOW_MS,
    tokenLimit: ENROLL_SUBMIT_TOKEN_LIMIT,
    tokenWindowMs: ENROLL_SUBMIT_TOKEN_WINDOW_MS,
  });
}
