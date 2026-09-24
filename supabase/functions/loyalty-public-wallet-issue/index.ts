import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadGoogleWalletEnv } from "../_shared/loyaltyWallet/googleWalletEnv.ts";
import { deterministicGoogleWalletIds } from "../_shared/loyaltyWallet/googleWalletRest.ts";
import { issueGoogleWalletSaveUrl, validatePassInput } from "../_shared/loyaltyWallet/loyaltyWalletService.ts";
import { resolvePublicCardAccountForWallet } from "../_shared/loyaltyWallet/publicCardLookup.ts";
import { encodeLoyaltyQrPayload, isValidPublicCardTokenFormat } from "../_shared/loyaltyWallet/publicCardTypes.ts";
import { enforceWalletIssueRateLimit } from "../_shared/loyaltyWallet/publicCardDurableRateLimit.ts";
import type { LoyaltyPassInput } from "../_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Public Google Wallet issuance (Phase 3).
 *
 * POST { token: public_card_token }
 * Durable rate limit (Postgres) MUST run before Wallet env/signing/Google API.
 * Merchant-authenticated loyalty-wallet-pass remains unchanged.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "unavailable" }, 500);
  }

  let body: { token?: string; shop_id?: string; account_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  // Explicitly ignore client shop_id / account_id even if sent.
  const token = String(body.token ?? "").trim();
  if (!token) return json({ ok: false, error: "token_required" }, 400);
  if (!isValidPublicCardTokenFormat(token)) {
    return json({ ok: false, error: "token_invalid" }, 400);
  }

  // F1/W2 — BEFORE Wallet env, PEM, JWT, Google API. Fail closed.
  const rate = await enforceWalletIssueRateLimit(req, supabaseUrl, serviceKey, token);
  if (!rate.ok) {
    if (rate.error === "rate_limited") {
      return json(
        { ok: false, error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds },
        429,
      );
    }
    return json({ ok: false, error: "unavailable" }, 503);
  }

  const resolved = await resolvePublicCardAccountForWallet(supabaseUrl, serviceKey, token);
  if (!resolved.ok) {
    const status =
      resolved.error === "token_required" || resolved.error === "token_invalid"
        ? 400
        : resolved.error === "not_found"
          ? 404
          : 503;
    return json({ ok: false, error: resolved.error }, status);
  }

  if (resolved.account.status !== "active" || !resolved.account.membershipActive) {
    return json(
      {
        ok: false,
        error: resolved.account.status !== "active" ? "account_inactive" : "membership_expired",
      },
      409,
    );
  }

  const env = loadGoogleWalletEnv();
  if (!env.ok) {
    return json({ ok: false, error: env.error }, env.error === "wallet_not_configured" ? 409 : 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: program } = await admin
    .from("loyalty_programs")
    .select("enabled, earn_unit_ugx, earn_points_per_unit")
    .eq("shop_id", resolved.account.shopId)
    .maybeSingle();

  const passInput: LoyaltyPassInput = {
    shopId: resolved.account.shopId,
    shopName: resolved.account.shopName,
    accountId: resolved.account.accountId,
    customerName: resolved.account.customerName,
    qrToken: resolved.account.qrToken,
    qrPayload: encodeLoyaltyQrPayload(resolved.account.qrToken),
    balancePoints: resolved.account.balancePoints,
    programLabel: program?.enabled
      ? `${program.earn_points_per_unit} pt per UGX ${Number(program.earn_unit_ugx).toLocaleString()} spent`
      : "Loyalty member",
    logoUrl: env.logoUrl,
  };
  const invalid = validatePassInput(passInput);
  if (invalid) return json({ ok: false, error: "unavailable" }, 500);

  const ids = deterministicGoogleWalletIds(
    env.issuerId,
    resolved.account.shopId,
    resolved.account.accountId,
  );
  const result = await issueGoogleWalletSaveUrl(
    passInput,
    { ids, origins: env.origins, persistObjects: true },
    env.signer,
    Math.floor(Date.now() / 1000),
  );
  if (!result.ok || result.pass.provider !== "google_wallet") {
    return json({ ok: false, error: "signing_failed" }, 502);
  }

  try {
    await admin
      .from("loyalty_accounts")
      .update({
        google_wallet_object_id: `${ids.issuerId}.${ids.objectId}`,
        google_wallet_issued_at: new Date().toISOString(),
        google_wallet_synced_at: new Date().toISOString(),
        google_wallet_sync_balance: passInput.balancePoints,
      })
      .eq("id", resolved.account.accountId)
      .eq("shop_id", resolved.account.shopId);
  } catch {
    /* non-fatal */
  }

  return json({
    ok: true,
    provider: "google_wallet",
    save_url: result.pass.saveUrl,
    balance_points: passInput.balancePoints,
  });
});
