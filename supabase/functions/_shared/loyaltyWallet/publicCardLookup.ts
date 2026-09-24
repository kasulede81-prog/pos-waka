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
    .select("id, shop_id, customer_id, status, balance_points, qr_token, membership_expires_at")
    .eq("public_card_token", token)
    .maybeSingle();

  if (accountErr) return { ok: false, error: "unavailable" };
  if (!account) return { ok: false, error: "not_found" };

  const shopId = String(account.shop_id);
  const customerId = String(account.customer_id);
  const membershipExpiresAtRaw = account.membership_expires_at;
  const membershipExpiresAt =
    membershipExpiresAtRaw == null || String(membershipExpiresAtRaw).trim() === ""
      ? null
      : String(membershipExpiresAtRaw);
  const membershipActive =
    account.status === "active" &&
    (membershipExpiresAt == null || Date.parse(membershipExpiresAt) > Date.now());
  // Exclusive upper bound → last inclusive Kampala day (UTC+3, no DST).
  let membershipExpiresOn: string | null = null;
  if (membershipExpiresAt) {
    const ms = Date.parse(membershipExpiresAt) - 24 * 60 * 60 * 1000;
    if (Number.isFinite(ms)) {
      const d = new Date(ms + 3 * 60 * 60 * 1000);
      membershipExpiresOn = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }

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

  const { data: designRow } = await admin
    .from("loyalty_card_designs")
    .select(
      "program_display_name, logo_url, primary_color, accent_color, background_color, text_color, welcome_message, card_style, reward_layout",
    )
    .eq("shop_id", shopId)
    .maybeSingle();

  const shopName = String(shop.name ?? "Shop");
  const customerName = String(customer.name ?? "Member");
  const qrToken = String(account.qr_token ?? "");
  if (!qrToken) return { ok: false, error: "unavailable" };

  const defaultProgramName = `${shopName} Loyalty`;
  const HEX = /^#[0-9a-f]{6}$/;
  const STYLES = new Set(["classic", "modern", "minimal", "premium"]);
  const LAYOUTS = new Set(["list", "cards"]);

  function safeHex(raw: unknown, fallback: string): string {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return HEX.test(v) ? v : fallback;
  }

  function safeLogo(raw: unknown): string | null {
    if (raw == null) return null;
    const v = String(raw).trim();
    if (!v || v.length > 2048) return null;
    const lower = v.toLowerCase();
    if (!lower.startsWith("https://")) return null;
    if (lower.includes(".svg")) return null;
    if (lower.startsWith("javascript:") || lower.startsWith("data:")) return null;
    try {
      const u = new URL(v);
      if (u.protocol !== "https:" || u.username || u.password) return null;
    } catch {
      return null;
    }
    return v;
  }

  let design: PublicCardSafePayload["design"];
  if (designRow) {
    const styleRaw = String(designRow.card_style ?? "classic").toLowerCase();
    const layoutRaw = String(designRow.reward_layout ?? "list").toLowerCase();
    const programFromDesign =
      designRow.program_display_name == null || String(designRow.program_display_name).trim() === ""
        ? defaultProgramName
        : String(designRow.program_display_name).trim().slice(0, 60);
    const welcome =
      designRow.welcome_message == null || String(designRow.welcome_message).trim() === ""
        ? null
        : String(designRow.welcome_message).trim().slice(0, 120);
    design = {
      logo_url: safeLogo(designRow.logo_url),
      primary_color: safeHex(designRow.primary_color, "#f97316"),
      accent_color: safeHex(designRow.accent_color, "#ea580c"),
      background_color: safeHex(designRow.background_color, "#0b3a82"),
      text_color: safeHex(designRow.text_color, "#ffffff"),
      program_name: programFromDesign,
      welcome_message: welcome,
      style: (STYLES.has(styleRaw) ? styleRaw : "classic") as
        | "classic"
        | "modern"
        | "minimal"
        | "premium",
      reward_layout: (LAYOUTS.has(layoutRaw) ? layoutRaw : "list") as "list" | "cards",
    };
  }

  return {
    ok: true,
    customer_name: customerName,
    shop_name: shopName,
    program_name: design?.program_name ?? defaultProgramName,
    balance_points: Math.max(0, Math.trunc(Number(account.balance_points ?? 0))),
    account_active: account.status === "active",
    program_enabled: Boolean(program?.enabled),
    membership_active: membershipActive,
    membership_expires_on: membershipExpiresOn,
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
    ...(design ? { design } : {}),
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
  membershipActive: boolean;
};

/** Resolve account for Wallet issuance � same authority chain, no phone. */
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
    .select("id, shop_id, customer_id, status, balance_points, qr_token, membership_expires_at")
    .eq("public_card_token", token)
    .maybeSingle();

  if (accountErr) return { ok: false, error: "unavailable" };
  if (!account) return { ok: false, error: "not_found" };

  const shopId = String(account.shop_id);
  const customerId = String(account.customer_id);
  const expiresRaw = account.membership_expires_at;
  const membershipExpiresAt =
    expiresRaw == null || String(expiresRaw).trim() === "" ? null : String(expiresRaw);
  const membershipActive =
    account.status === "active" &&
    (membershipExpiresAt == null || Date.parse(membershipExpiresAt) > Date.now());

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
      membershipActive,
    },
  };
}