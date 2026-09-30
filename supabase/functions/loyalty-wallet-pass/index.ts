import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createApplePkcs7Signer } from "../_shared/loyaltyWallet/applePkcs7Signer.ts";
import { loadGoogleWalletEnv } from "../_shared/loyaltyWallet/googleWalletEnv.ts";
import { deterministicGoogleWalletIds } from "../_shared/loyaltyWallet/googleWalletRest.ts";
import {
  issueAppleWalletPass,
  issueGoogleWalletSaveUrl,
  validatePassInput,
} from "../_shared/loyaltyWallet/loyaltyWalletService.ts";
import type { LoyaltyPassInput } from "../_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Loyalty wallet pass issuance (Phase 06 / Phase 5 Google Wallet).
 *
 * POST { provider: "apple" | "google", shop_id, account_id }   — SHOP STAFF
 * POST { provider: "apple" | "google", shop_id }               — LOYALTY MEMBER (self)
 * GET  ?provider=google  → { ok, configured: boolean } (no secrets leaked)
 *
 * ONE PASS, ONE ISSUER, ONE CLASS. Both callers end at the same
 * `issueGoogleWalletSaveUrl(...)` with the same deterministic object id
 * (`{issuerId}.acct_{accountId}`), so a card a merchant issues and a card a member adds
 * are the same Google Wallet object. This function decides only WHO may ask, never what
 * the pass is.
 *
 * The two authority chains are mutually exclusive and are selected by whether `account_id`
 * is present — not by a client-supplied flag, so a caller can never ask for a mixture:
 *
 *   account_id present → STAFF. `loyalty_accounts` is read with the CALLER'S JWT and the
 *     RLS policy `loyalty_accounts_select` (`user_can_access_shop`) is the authority. A
 *     loyalty member has no `shop_members` row, so this chain refuses them outright.
 *
 *   account_id absent  → MEMBER. No account id is read from the request at all:
 *     `auth.uid()` → `loyalty_member_wallet_account()` → the member's OWN active link at
 *     that shop → that account. Nothing the client sends can widen it, and the rows are
 *     then loaded with the service key because a member cannot satisfy shop RLS by design.
 *
 * The Wallet environment (issuer, service account, class) is identical for both. There is
 * no member-specific credential and no second issuance path.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // Status probe — safe for UI "Google Wallet not configured".
  if (req.method === "GET") {
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider") ?? "google";
    if (provider === "google") {
      const env = loadGoogleWalletEnv();
      return json({
        ok: true,
        provider: "google_wallet",
        configured: env.ok,
        error: env.ok ? null : env.error,
      });
    }
    return json({ ok: false, error: "provider_required" }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: { provider?: string; shop_id?: string; account_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const provider = String(body.provider ?? "");
  const shopId = String(body.shop_id ?? "").trim();
  const accountId = String(body.account_id ?? "").trim();
  if (provider !== "apple" && provider !== "google") {
    return json({ ok: false, error: "provider_required" }, 400);
  }
  if (!shopId) return json({ ok: false, error: "shop_and_account_required" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  // Which account this request may touch, and which client is allowed to read the rows.
  // Staff keep the caller-JWT read they have always had; the member chain is switched to the
  // service key ONLY after the member-authorised function has named the account.
  let accountIdToIssue = accountId;
  let readClient = userClient;

  if (!accountId) {
    // MEMBER CHAIN. `loyalty_member_wallet_account` takes a shop and resolves the account from
    // auth.uid() alone, so the client has no account id to forge and no way to reach another
    // member's card. It is called with the member's JWT — never the service key — because
    // auth.uid() is the whole point of it.
    const { data, error } = await userClient.rpc("loyalty_member_wallet_account", {
      p_shop_id: shopId,
    });
    if (error) return json({ ok: false, error: "unauthorized" }, 403);
    const resolved = (data ?? {}) as { ok?: boolean; error?: string; account_id?: string };
    if (resolved.ok !== true || !resolved.account_id) {
      const code = String(resolved.error ?? "not_found");
      const status =
        code === "not_authenticated"
          ? 401
          : code === "not_a_member"
            ? 403
            : code === "not_found"
              ? 404
              : 409;
      return json({ ok: false, error: code }, status);
    }
    accountIdToIssue = String(resolved.account_id);
    // Scoped to exactly the (account, shop) pair that call authorised. A member cannot satisfy
    // `user_can_access_shop`, so this read cannot be done with their own JWT.
    readClient = admin;
  }

  const { data: account, error: accountErr } = await readClient
    .from("loyalty_accounts")
    .select("id, shop_id, customer_id, balance_points, qr_token, status, membership_expires_at")
    .eq("shop_id", shopId)
    .eq("id", accountIdToIssue)
    .maybeSingle();
  if (accountErr || !account) return json({ ok: false, error: "account_not_found" }, 404);
  const accountStatus = String((account as { status?: string }).status ?? "");
  if (accountStatus === "revoked") {
    return json({ ok: false, error: "account_revoked" }, 409);
  }
  if (accountStatus !== "active") {
    return json({ ok: false, error: "account_inactive" }, 409);
  }
  const expiresRaw = (account as { membership_expires_at?: string | null }).membership_expires_at;
  if (
    expiresRaw != null &&
    String(expiresRaw).trim() !== "" &&
    Date.parse(String(expiresRaw)) <= Date.now()
  ) {
    return json({ ok: false, error: "membership_expired" }, 409);
  }

  const { data: customer } = await readClient
    .from("customers")
    .select("id, name")
    .eq("shop_id", shopId)
    .eq("id", account.customer_id)
    .maybeSingle();
  if (!customer) return json({ ok: false, error: "customer_not_found" }, 404);

  const { data: shop } = await readClient
    .from("shops")
    .select("id, name")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop) return json({ ok: false, error: "shop_not_found" }, 404);

  // No loyalty_programs read: the pass used to compose an "Earns" line from it, and that row
  // is gone (see googleWalletPass.ts / appleWalletPass.ts).

  if (provider === "google") {
    const env = loadGoogleWalletEnv();
    if (!env.ok) return json({ ok: false, error: env.error }, env.error === "wallet_not_configured" ? 409 : 500);

    const passInput: LoyaltyPassInput = {
      shopId,
      shopName: String(shop.name ?? "Waka Shop"),
      accountId: String(account.id),
      customerName: String(customer.name ?? "Member"),
      qrToken: String(account.qr_token),
      qrPayload: `WAKA-LOYALTY:${account.qr_token}`,
      balancePoints: Number(account.balance_points ?? 0),
      logoUrl: env.logoUrl,
      heroImageUrl: env.heroImageUrl,
    };
    const invalid = validatePassInput(passInput);
    if (invalid) return json({ ok: false, error: invalid }, 400);

    const ids = deterministicGoogleWalletIds(env.issuerId, shopId, accountIdToIssue);
    const result = await issueGoogleWalletSaveUrl(
      passInput,
      { ids, origins: env.origins, persistObjects: true },
      env.signer,
      Math.floor(Date.now() / 1000),
    );
    if (!result.ok) return json({ ok: false, error: result.error }, 502);
    if (result.pass.provider !== "google_wallet") return json({ ok: false, error: "signing_failed" }, 502);

    // Best-effort mark issued — service role; never fails the save URL response.
    try {
      await admin
        .from("loyalty_accounts")
        .update({
          google_wallet_object_id: `${ids.issuerId}.${ids.objectId}`,
          google_wallet_issued_at: new Date().toISOString(),
          google_wallet_synced_at: new Date().toISOString(),
          google_wallet_sync_balance: passInput.balancePoints,
        })
        .eq("id", accountIdToIssue)
        .eq("shop_id", shopId);
    } catch {
      /* non-fatal */
    }

    // `object_id` embeds the raw account uuid, so it is returned to STAFF only — the member's
    // browser gets the Save URL and its own balance, and no account identifier it does not
    // already have. Nothing in either client reads it.
    return json({
      ok: true,
      provider: "google_wallet",
      save_url: result.pass.saveUrl,
      ...(accountId ? { object_id: `${ids.issuerId}.${ids.objectId}` } : {}),
      balance_points: passInput.balancePoints,
    });
  }

  // Apple
  const passInput: LoyaltyPassInput = {
    shopId,
    shopName: String(shop.name ?? "Waka Shop"),
    accountId: String(account.id),
    customerName: String(customer.name ?? "Member"),
    qrToken: String(account.qr_token),
    qrPayload: `WAKA-LOYALTY:${account.qr_token}`,
    balancePoints: Number(account.balance_points ?? 0),
  };
  const invalid = validatePassInput(passInput);
  if (invalid) return json({ ok: false, error: invalid }, 400);

  const passTypeIdentifier = Deno.env.get("APPLE_PASS_TYPE_IDENTIFIER") ?? "";
  const teamIdentifier = Deno.env.get("APPLE_TEAM_ID") ?? "";
  const certificatePem = Deno.env.get("APPLE_PASS_CERTIFICATE_PEM") ?? "";
  const wwdrPem = Deno.env.get("APPLE_WWDR_PEM") ?? "";
  const privateKeyPem = Deno.env.get("APPLE_PASS_PRIVATE_KEY_PEM") ?? "";
  if (!passTypeIdentifier || !teamIdentifier || !certificatePem || !wwdrPem || !privateKeyPem) {
    return json({ ok: false, error: "wallet_not_configured" }, 409);
  }
  const signer = createApplePkcs7Signer({ certificatePem, wwdrCertificatePem: wwdrPem, privateKeyPem });
  const result = await issueAppleWalletPass(
    passInput,
    { passTypeIdentifier, teamIdentifier },
    signer,
  );
  if (!result.ok) return json({ ok: false, error: result.error }, 502);
  if (result.pass.provider !== "apple_wallet") return json({ ok: false, error: "signing_failed" }, 502);
  return json({
    ok: true,
    provider: "apple_wallet",
    filename: result.pass.filename,
    pkpass_base64: b64(result.pass.pkpass),
  });
});
