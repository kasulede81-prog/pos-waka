/**
 * Merchant-facing Google Wallet loyalty issuance + sync (Phase 5).
 *
 * Credentials never leave the edge function. The client only receives a
 * Save-to-Wallet URL or a clean "not configured" status.
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

export async function fetchGoogleWalletConfigured(): Promise<GoogleWalletConfigStatus> {
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
    const msg = result.message.toLowerCase();
    if (msg.includes("wallet_not_configured")) return { ok: false, error: "wallet_not_configured" };
    if (msg.includes("wallet_misconfigured")) return { ok: false, error: "wallet_misconfigured" };
    if (msg.includes("account_not_found")) return { ok: false, error: "account_not_found" };
    if (msg.includes("shop_not_found")) return { ok: false, error: "shop_not_found" };
    if (msg.includes("unauthorized")) return { ok: false, error: "unauthorized" };
    if (result.errorCode === "network") return { ok: false, error: "network" };
    return { ok: false, error: result.message || "unavailable" };
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

export function buildGoogleWalletClassId(issuerId: string, shopId: string): string {
  return `${issuerId}.waka_loyalty_${shopId}`;
}
