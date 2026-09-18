import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createApplePkcs7Signer } from "../_shared/loyaltyWallet/applePkcs7Signer.ts";
import { createEs256SignerFromPkcs8Pem } from "../_shared/loyaltyWallet/googleWalletPass.ts";
import {
  issueAppleWalletPass,
  issueGoogleWalletSaveUrl,
  validatePassInput,
} from "../_shared/loyaltyWallet/loyaltyWalletService.ts";
import type { LoyaltyPassInput } from "../_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Loyalty wallet pass issuance (Phase 06).
 *
 * POST { provider: "apple" | "google", shop_id, account_id }
 * Authorization: Bearer <user jwt> — the account/shop are read with the
 * USER context client so RLS (user_can_access_shop) is enforced by the
 * database before any pass is generated.
 *
 * Secrets (set via `supabase secrets set`, NEVER committed):
 *   GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_JSON,
 *   WALLET_ALLOWED_ORIGINS,
 *   APPLE_PASS_TYPE_IDENTIFIER, APPLE_TEAM_ID,
 *   APPLE_PASS_CERTIFICATE_PEM, APPLE_WWDR_PEM, APPLE_PASS_PRIVATE_KEY_PEM
 *
 * Without those secrets the function fails closed with
 * `wallet_not_configured` — the QR fallback is unaffected. See
 * docs/waka-loyalty-prompts/docs/loyalty/WALLET-INTEGRATION.md.
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
  if (!shopId || !accountId) return json({ ok: false, error: "shop_and_account_required" }, 400);

  // User-context client: RLS policies decide what this member may see.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: account, error: accountErr } = await userClient
    .from("loyalty_accounts")
    .select("id, shop_id, customer_id, balance_points, qr_token")
    .eq("shop_id", shopId)
    .eq("id", accountId)
    .maybeSingle();
  if (accountErr || !account) return json({ ok: false, error: "account_not_found" }, 404);

  const { data: customer } = await userClient
    .from("customers")
    .select("id, name")
    .eq("shop_id", shopId)
    .eq("id", account.customer_id)
    .maybeSingle();
  if (!customer) return json({ ok: false, error: "customer_not_found" }, 404);

  const { data: shop } = await userClient
    .from("shops")
    .select("id, name")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop) return json({ ok: false, error: "shop_not_found" }, 404);

  const { data: program } = await userClient
    .from("loyalty_programs")
    .select("enabled, earn_unit_ugx, earn_points_per_unit")
    .eq("shop_id", shopId)
    .maybeSingle();

  const passInput: LoyaltyPassInput = {
    shopId,
    shopName: String(shop.name ?? "Waka Shop"),
    accountId: String(account.id),
    customerName: String(customer.name ?? "Member"),
    qrToken: String(account.qr_token),
    qrPayload: `WAKA-LOYALTY:${account.qr_token}`,
    balancePoints: Number(account.balance_points ?? 0),
    programLabel: program?.enabled
      ? `${program.earn_points_per_unit} pt per UGX ${Number(program.earn_unit_ugx).toLocaleString()} spent`
      : "Loyalty member",
  };
  const invalid = validatePassInput(passInput);
  if (invalid) return json({ ok: false, error: invalid }, 400);

  if (provider === "google") {
    const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID") ?? "";
    const serviceAccountJson = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON") ?? "";
    if (!issuerId || !serviceAccountJson) {
      return json({ ok: false, error: "wallet_not_configured" }, 409);
    }
    let serviceAccount: { client_email?: string; private_key?: string };
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      return json({ ok: false, error: "wallet_misconfigured" }, 500);
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      return json({ ok: false, error: "wallet_misconfigured" }, 500);
    }
    const signer = createEs256SignerFromPkcs8Pem(
      serviceAccount.client_email,
      serviceAccount.private_key,
    );
    const origins = (Deno.env.get("WALLET_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const result = await issueGoogleWalletSaveUrl(
      passInput,
      { ids: { issuerId, classId: `waka_loyalty_${shopId}`, objectId: `acct_${accountId}` }, origins },
      signer,
      Math.floor(Date.now() / 1000),
    );
    if (!result.ok) return json({ ok: false, error: result.error }, 502);
    if (result.pass.provider !== "google_wallet") return json({ ok: false, error: "signing_failed" }, 502);
    return json({ ok: true, provider: "google_wallet", save_url: result.pass.saveUrl });
  }

  // Apple
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
