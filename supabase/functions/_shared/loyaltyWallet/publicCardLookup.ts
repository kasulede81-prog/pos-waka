/**
 * Resolve a public loyalty card by public_card_token using service role.
 * Authority: token → account → shop. Client shop_id is never trusted.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  encodeLoyaltyQrPayload,
  isValidPublicCardTokenFormat,
  type PublicCardLookupError,
  type PublicCardSafePayload,
} from "./publicCardTypes.ts";
import { isGoogleWalletConfigured } from "./googleWalletEnv.ts";

export async function lookupPublicLoyaltyCard(
  supabaseUrl: string,
  serviceKey: string,
  rawToken: string,
): Promise<PublicCardSafePayload | PublicCardLookupError> {
  const token = rawToken.trim();
  if (!token) return { ok: false, error: "token_required" };
  if (!isValidPublicCardTokenFormat(token)) return { ok: false, error: "token_invalid" };

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: account, error: accountErr } = await admin
    .from("loyalty_accounts")
    .select("id, shop_id, customer_id, status, balance_points, qr_token")
    .eq("public_card_token", token)
    .maybeSingle();

  if (accountErr) return { ok: false, error: "unavailable" };
  if (!account) return { ok: false, error: "not_found" };

  const shopId = String(account.shop_id);
  const customerId = String(account.customer_id);

  const { data: customer, error: customerErr } = await admin
    .from("customers")
    .select("name")
    .eq("id", customerId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (customerErr || !customer) return { ok: false, error: "unavailable" };

  const { data: shop, error: shopErr } = await admin
    .from("shops")
    .select("name")
    .eq("id", shopId)
    .maybeSingle();
  if (shopErr || !shop) return { ok: false, error: "unavailable" };

  const { data: program } = await admin
    .from("loyalty_programs")
    .select("enabled")
    .eq("shop_id", shopId)
    .maybeSingle();

  const { data: rewards } = await admin
    .from("loyalty_rewards")
    .select("name, description, points_required, active, sort_order")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const shopName = String(shop.name ?? "Shop");
  const customerName = String(customer.name ?? "Member");
  const qrToken = String(account.qr_token ?? "");
  if (!qrToken) return { ok: false, error: "unavailable" };

  return {
    ok: true,
    customer_name: customerName,
    shop_name: shopName,
    program_name: `${shopName} Loyalty`,
    balance_points: Math.max(0, Math.trunc(Number(account.balance_points ?? 0))),
    account_active: account.status === "active",
    program_enabled: Boolean(program?.enabled),
    qr_payload: encodeLoyaltyQrPayload(qrToken),
    rewards: Array.isArray(rewards)
      ? rewards.map((r) => ({
          name: String(r.name ?? ""),
          points_required: Math.max(0, Math.trunc(Number(r.points_required ?? 0))),
          description: r.description == null || String(r.description).trim() === ""
            ? null
            : String(r.description).slice(0, 200),
        }))
      : [],
    wallet_configured: isGoogleWalletConfigured(),
  };
}

export type ResolvedPublicAccount = {
  accountId: string;
  shopId: string;
  customerId: string;
  customerName: string;
  shopName: string;
  balancePoints: number;
  qrToken: string;
  status: string;
  programEnabled: boolean;
};

/** Resolve account for Wallet issuance — same authority chain, no phone. */
export async function resolvePublicCardAccountForWallet(
  supabaseUrl: string,
  serviceKey: string,
  rawToken: string,
): Promise<{ ok: true; account: ResolvedPublicAccount } | PublicCardLookupError> {
  const token = rawToken.trim();
  if (!token) return { ok: false, error: "token_required" };
  if (!isValidPublicCardTokenFormat(token)) return { ok: false, error: "token_invalid" };

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: account, error: accountErr } = await admin
    .from("loyalty_accounts")
    .select("id, shop_id, customer_id, status, balance_points, qr_token")
    .eq("public_card_token", token)
    .maybeSingle();

  if (accountErr) return { ok: false, error: "unavailable" };
  if (!account) return { ok: false, error: "not_found" };

  const shopId = String(account.shop_id);
  const customerId = String(account.customer_id);

  const { data: customer } = await admin
    .from("customers")
    .select("name")
    .eq("id", customerId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!customer) return { ok: false, error: "unavailable" };

  const { data: shop } = await admin.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (!shop) return { ok: false, error: "unavailable" };

  const { data: program } = await admin
    .from("loyalty_programs")
    .select("enabled, earn_unit_ugx, earn_points_per_unit")
    .eq("shop_id", shopId)
    .maybeSingle();

  const qrToken = String(account.qr_token ?? "");
  if (!qrToken) return { ok: false, error: "unavailable" };

  return {
    ok: true,
    account: {
      accountId: String(account.id),
      shopId,
      customerId,
      customerName: String(customer.name ?? "Member"),
      shopName: String(shop.name ?? "Shop"),
      balancePoints: Math.max(0, Math.trunc(Number(account.balance_points ?? 0))),
      qrToken,
      status: String(account.status ?? "active"),
      programEnabled: Boolean(program?.enabled),
    },
  };
}
