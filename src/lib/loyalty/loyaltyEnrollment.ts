/**
 * Loyalty enrollment + QR identity (Phase 05).
 *
 * Merchant-mediated enrollment: pick an existing WAKA customer, record
 * consent, enroll via the security-definer RPC. QR identification resolves
 * an opaque `qr_token` (never personal data) back to the account.
 */

import { hasSupabaseConfig, supabase } from "../supabase";
import { normalizeUgPhoneE164 } from "../businessProfile";
import { enrollLoyaltyCustomer } from "./loyaltyClient";

/** Prefix stamped into membership QR payloads so scanners can tell loyalty
 * codes apart from product barcodes. */
export const LOYALTY_QR_PREFIX = "WAKA-LOYALTY:";

export function encodeLoyaltyQrPayload(qrToken: string): string {
  return `${LOYALTY_QR_PREFIX}${qrToken}`;
}

/** Extract the raw token from a scanned string; null when not a loyalty QR. */
export function decodeLoyaltyQrPayload(scanned: string): string | null {
  const value = scanned.trim();
  if (!value.startsWith(LOYALTY_QR_PREFIX)) return null;
  const token = value.slice(LOYALTY_QR_PREFIX.length).trim();
  return token || null;
}

export type ShopCustomerOption = {
  id: string;
  name: string;
  phoneE164: string | null;
  /** True when the customer already has a loyalty account in this shop. */
  alreadyEnrolled: boolean;
};

/**
 * Search the shop's customers for enrollment. Phone input is normalized to
 * E.164 (same helper as registration) before matching; already-enrolled
 * customers are flagged so the UI shows the "already enrolled" state
 * instead of creating a duplicate membership.
 */
export async function fetchShopCustomersForEnrollment(
  shopId: string,
  query: string,
): Promise<ShopCustomerOption[]> {
  if (!hasSupabaseConfig || !supabase || !shopId) return [];
  try {
    const normalizedPhone = normalizeUgPhoneE164(query);
    let builder = supabase
      .from("customers")
      .select("id, name, phone_e164")
      .eq("shop_id", shopId)
      .order("name")
      .limit(20);

    const q = query.trim();
    if (q) {
      const orParts = [`name.ilike.%${q}%`];
      if (normalizedPhone) orParts.push(`phone_e164.eq.${normalizedPhone}`);
      else if (/^[0-9+ ]+$/.test(q)) orParts.push(`phone_e164.ilike.%${q.replace(/\D/g, "")}%`);
      builder = builder.or(orParts.join(","));
    }

    const { data, error } = await builder;
    if (error || !Array.isArray(data)) return [];

    const enrolled = new Set<string>();
    const { data: accounts } = await supabase
      .from("loyalty_accounts")
      .select("customer_id")
      .eq("shop_id", shopId);
    if (Array.isArray(accounts)) {
      for (const row of accounts) enrolled.add(String((row as { customer_id: string }).customer_id));
    }

    return data.map((row) => ({
      id: row.id as string,
      name: String(row.name ?? ""),
      phoneE164: (row.phone_e164 as string | null) ?? null,
      alreadyEnrolled: enrolled.has(row.id as string),
    }));
  } catch {
    return [];
  }
}

export type EnrollCustomerResult =
  | { ok: true; accountId: string; qrToken: string; alreadyEnrolled: boolean }
  | { ok: false; error: string };

/** Enroll with explicit consent recording; duplicate calls are idempotent. */
export async function enrollCustomerWithConsent(
  shopId: string,
  customerId: string,
  consentAccepted: boolean,
  consentNote: string,
): Promise<EnrollCustomerResult> {
  if (!consentAccepted) return { ok: false, error: "consent_required" };
  return enrollLoyaltyCustomer(shopId, customerId, { consentAccepted, consentNote });
}

export type TokenLookupResult =
  | {
      ok: true;
      accountId: string;
      customerId: string;
      customerName: string;
      customerPhone: string | null;
      status: "active" | "disabled";
      balancePoints: number;
      qrToken: string;
    }
  | { ok: false; error: string };

/** Resolve a scanned membership QR to the account (shop-scoped, access-checked). */
export async function lookupAccountByToken(
  shopId: string,
  scanned: string,
): Promise<TokenLookupResult> {
  const token = decodeLoyaltyQrPayload(scanned) ?? scanned.trim();
  if (!hasSupabaseConfig || !supabase || !shopId || !token) {
    return { ok: false, error: token ? "loyalty_unavailable" : "token_required" };
  }
  try {
    const { data, error } = await supabase.rpc("loyalty_account_by_token", {
      p_shop_id: shopId,
      p_token: token,
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_lookup_failed" };
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) return { ok: false, error: String(result.error ?? "not_found") };
    return {
      ok: true,
      accountId: String(result.account_id),
      customerId: String(result.customer_id),
      customerName: String(result.customer_name ?? ""),
      customerPhone: (result.customer_phone as string | null) ?? null,
      status: result.status === "disabled" ? "disabled" : "active",
      balancePoints: Number(result.balance_points ?? 0),
      qrToken: String(result.qr_token ?? ""),
    };
  } catch {
    return { ok: false, error: "loyalty_lookup_failed" };
  }
}
