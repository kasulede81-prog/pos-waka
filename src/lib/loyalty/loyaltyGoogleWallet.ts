/**
 * Google Wallet loyalty issuance + sync (Phase 5).
 *
 * Credentials never leave the edge function. The client only receives a
 * Save-to-Wallet URL or a clean "not configured" status.
 *
 * TWO CALLERS, ONE ISSUANCE. `issueGoogleWalletPass` is the merchant counter action (it names
 * the shop AND the account, and the server checks the caller against shop RLS).
 * `issueMemberGoogleWalletPass` is the member's own "Add to Google Wallet": it names the shop
 * and nothing else, and the server resolves the account from the member's session. Both reach
 * the same Edge Function, the same issuer, the same published class and therefore the same
 * Google Wallet object — the Save URL format is not duplicated anywhere.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";

export type GoogleWalletConfigStatus =
  | { ok: true; configured: true }
  | { ok: true; configured: false; error: "wallet_not_configured" | "wallet_misconfigured" | string }
  | { ok: false; error: string };

export type GoogleWalletIssueResult =
  | { ok: true; saveUrl: string; objectId: string; balancePoints: number }
  | {
      ok: false;
      error:
        | "wallet_not_configured"
        | "wallet_misconfigured"
        | "unauthorized"
        | "account_not_found"
        | "shop_not_found"
        | "signing_failed"
        | "unavailable"
        | "network"
        | string;
    };

/**
 * Phase A (P2) — one configuration probe per dashboard mount/session, not one per
 * merchant card. Successes are shared for a minute; failures expire in seconds so a
 * transient error never sticks. Concurrent callers (N cards mounting together) share a
 * single in-flight request. This is a read-only performance cache of a HEAD-style
 * probe: it does not touch issuance, the edge function, or any wallet field.
 */
const CONFIGURED_OK_TTL_MS = 60_000;
const CONFIGURED_ERR_TTL_MS = 10_000;
let configuredCache: { value: GoogleWalletConfigStatus; at: number } | null = null;
let configuredInflight: Promise<GoogleWalletConfigStatus> | null = null;

async function probeGoogleWalletConfigured(): Promise<GoogleWalletConfigStatus> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "cloud_unavailable" };
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const url = `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "")}/functions/v1/loyalty-wallet-pass?provider=google`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      configured?: boolean;
      error?: string;
    };
    if (body.configured === true) return { ok: true, configured: true };
    return {
      ok: true,
      configured: false,
      error: String(body.error ?? "wallet_not_configured"),
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function fetchGoogleWalletConfigured(): Promise<GoogleWalletConfigStatus> {
  const now = Date.now();
  if (configuredCache) {
    const ttl = configuredCache.value.ok ? CONFIGURED_OK_TTL_MS : CONFIGURED_ERR_TTL_MS;
    if (now - configuredCache.at < ttl) return configuredCache.value;
  }
  if (configuredInflight) return configuredInflight;
  configuredInflight = probeGoogleWalletConfigured()
    .then((value) => {
      configuredCache = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      configuredInflight = null;
    });
  return configuredInflight;
}

export async function issueGoogleWalletPass(
  shopId: string,
  accountId: string,
): Promise<GoogleWalletIssueResult> {
  if (!shopId.trim() || !accountId.trim()) {
    return { ok: false, error: "shop_and_account_required" };
  }
  const result = await invokeSupabaseEdgeFunction<{
    ok?: boolean;
    save_url?: string;
    object_id?: string;
    balance_points?: number;
    error?: string;
  }>("loyalty-wallet-pass", {
    provider: "google",
    shop_id: shopId,
    account_id: accountId,
  });
  if (!result.ok) {
    return { ok: false, error: normalizeWalletIssueError(result.message, result.errorCode) };
  }
  const data = result.data;
  if (data.ok && data.save_url) {
    return {
      ok: true,
      saveUrl: data.save_url,
      objectId: String(data.object_id ?? ""),
      balancePoints: Number(data.balance_points ?? 0),
    };
  }
  return { ok: false, error: String(data.error ?? "signing_failed") };
}

/**
 * Server error → the code the UI branches on. Ordered: the two `*_not_found` codes are
 * matched before the bare `not_found` that would otherwise swallow them.
 */
function normalizeWalletIssueError(message: string, errorCode?: string): string {
  const msg = String(message ?? "").toLowerCase();
  if (msg.includes("wallet_not_configured")) return "wallet_not_configured";
  if (msg.includes("wallet_misconfigured")) return "wallet_misconfigured";
  if (msg.includes("account_not_found")) return "account_not_found";
  if (msg.includes("shop_not_found")) return "shop_not_found";
  if (msg.includes("account_revoked")) return "account_revoked";
  if (msg.includes("account_inactive")) return "account_inactive";
  if (msg.includes("membership_expired")) return "membership_expired";
  if (msg.includes("not_a_member")) return "not_a_member";
  if (msg.includes("not_found")) return "not_found";
  if (msg.includes("unauthorized")) return "unauthorized";
  if (errorCode === "network") return "network";
  return message || "unavailable";
}

export type GoogleWalletMemberIssueResult =
  | { ok: true; saveUrl: string; balancePoints: number }
  | {
      ok: false;
      error:
        | "shop_required"
        | "wallet_not_configured"
        | "wallet_misconfigured"
        | "not_a_member"
        | "not_found"
        | "account_revoked"
        | "account_inactive"
        | "membership_expired"
        | "unauthorized"
        | "signing_failed"
        | "unavailable"
        | "network"
        | string;
    };

/**
 * The signed-in MEMBER's own Wallet card at one shop.
 *
 * Sends a shop and NOTHING ELSE — no account id, no card token, no member id. The server
 * resolves the account from the member's own session (`auth.uid()` → their active link at that
 * shop → that account), so this call has nothing in it that could point at another member's
 * card or another shop's account, and the browser never has to know an account id.
 *
 * The Save URL that comes back is the SAME issuance the merchant's "Send customer their card"
 * produces — same edge function, same issuer, same published class, same Google Wallet object.
 */
export async function issueMemberGoogleWalletPass(
  shopId: string,
): Promise<GoogleWalletMemberIssueResult> {
  if (!shopId.trim()) return { ok: false, error: "shop_required" };
  const result = await invokeSupabaseEdgeFunction<{
    ok?: boolean;
    save_url?: string;
    balance_points?: number;
    error?: string;
  }>("loyalty-wallet-pass", {
    provider: "google",
    shop_id: shopId,
  });
  if (!result.ok) {
    return { ok: false, error: normalizeWalletIssueError(result.message, result.errorCode) };
  }
  const data = result.data;
  if (data.ok && data.save_url) {
    return {
      ok: true,
      saveUrl: data.save_url,
      balancePoints: Number(data.balance_points ?? 0),
    };
  }
  return { ok: false, error: String(data.error ?? "signing_failed") };
}

/** Best-effort drain of wallet sync outbox for a shop/account. Never throws. */
export async function requestGoogleWalletBalanceSync(
  shopId: string,
  accountId?: string,
): Promise<void> {
  if (!shopId.trim()) return;
  try {
    await invokeSupabaseEdgeFunction("loyalty-wallet-sync", {
      shop_id: shopId,
      ...(accountId ? { account_id: accountId } : {}),
      limit: 20,
    });
  } catch {
    /* non-fatal */
  }
}

/** Deterministic object id helper — mirrors server ids (tests + diagnostics). */
export function buildGoogleWalletObjectId(issuerId: string, accountId: string): string {
  return `${issuerId}.acct_${accountId}`;
}

/** Published class id — shared across shops: `{issuerId}.waka_loyalty`. */
export function buildGoogleWalletClassId(issuerId: string, _shopId?: string): string {
  return `${issuerId}.waka_loyalty`;
}
