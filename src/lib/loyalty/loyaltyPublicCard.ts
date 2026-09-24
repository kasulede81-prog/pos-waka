/**
 * Public customer loyalty card client (Phase 3).
 *
 * Fetches safe card data via loyalty-public-card using public_card_token only.
 * Never sends shop_id / account_id. Never logs tokens or Save URLs.
 */

import { WAKA_LOYALTY_URL } from "../../config/company";
import { hasSupabaseConfig } from "../supabase";
import {
  publicPayloadToDesign,
  type LoyaltyCardDesign,
  type PublicCardDesignPayload,
} from "./loyaltyCardDesign";

export const PUBLIC_CARD_TOKEN_RE = /^[a-f0-9]{64}$/i;

export function isValidPublicCardTokenFormat(token: string): boolean {
  return PUBLIC_CARD_TOKEN_RE.test(token.trim());
}

/**
 * Canonical customer loyalty page URL (not a Google Save URL).
 * Production: https://loyalty.waka.ug/c/<public_card_token>
 */
export function buildCustomerLoyaltyCardUrl(
  publicCardToken: string,
  origin: string = WAKA_LOYALTY_URL,
): string {
  const token = publicCardToken.trim();
  const base = origin.replace(/\/$/, "");
  return `${base}/c/${encodeURIComponent(token)}`;
}

export type PublicCardReward = {
  name: string;
  points_required: number;
  description: string | null;
};

export type PublicCardData = {
  customer_name: string;
  shop_name: string;
  program_name: string;
  balance_points: number;
  account_active: boolean;
  program_enabled: boolean;
  qr_payload: string;
  rewards: PublicCardReward[];
  wallet_configured: boolean;
  design?: LoyaltyCardDesign;
};

export type FetchPublicCardResult =
  | { ok: true; card: PublicCardData }
  | { ok: false; error: "token_invalid" | "not_found" | "rate_limited" | "unavailable" | "network" };

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "phone",
  "phone_e164",
  "email",
  "customer_id",
  "account_id",
  "shop_id",
  "user_id",
  "qr_token",
  "public_card_token",
  "private_key",
  "service_account",
  "save_url",
]);

/** Defense-in-depth: reject payloads that leak sensitive fields. */
export function assertClientSafePublicCard(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(key.toLowerCase())) {
      throw new Error("unsafe_public_card_field");
    }
  }
}

export async function fetchPublicLoyaltyCard(token: string): Promise<FetchPublicCardResult> {
  const trimmed = token.trim();
  if (!isValidPublicCardTokenFormat(trimmed)) {
    return { ok: false, error: "token_invalid" };
  }
  if (!hasSupabaseConfig) {
    return { ok: false, error: "unavailable" };
  }

  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
  if (!base || !anon) return { ok: false, error: "unavailable" };

  try {
    const url = `${base}/functions/v1/loyalty-public-card?token=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 429 || body.error === "rate_limited") {
      return { ok: false, error: "rate_limited" };
    }
    if (body.error === "token_invalid" || body.error === "token_required") {
      return { ok: false, error: "token_invalid" };
    }
    if (res.status === 404 || body.error === "not_found") {
      return { ok: false, error: "not_found" };
    }
    if (!res.ok || body.ok !== true) {
      return { ok: false, error: "unavailable" };
    }

    try {
      assertClientSafePublicCard(body);
    } catch {
      return { ok: false, error: "unavailable" };
    }

    const rewardsRaw = Array.isArray(body.rewards) ? body.rewards : [];
    const shopName = String(body.shop_name ?? "Shop");
    const programName = String(body.program_name ?? "Loyalty");
    const designRaw =
      body.design && typeof body.design === "object"
        ? (body.design as PublicCardDesignPayload)
        : null;
    const design = publicPayloadToDesign(designRaw, programName);

    return {
      ok: true,
      card: {
        customer_name: String(body.customer_name ?? "Member"),
        shop_name: shopName,
        program_name: design?.programDisplayName || programName,
        balance_points: Math.max(0, Math.trunc(Number(body.balance_points ?? 0))),
        account_active: Boolean(body.account_active),
        program_enabled: Boolean(body.program_enabled),
        qr_payload: String(body.qr_payload ?? ""),
        rewards: rewardsRaw.map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          return {
            name: String(row.name ?? ""),
            points_required: Math.max(0, Math.trunc(Number(row.points_required ?? 0))),
            description:
              row.description == null || String(row.description).trim() === ""
                ? null
                : String(row.description),
          };
        }),
        wallet_configured: Boolean(body.wallet_configured),
        ...(design ? { design } : {}),
      },
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

export type PublicWalletIssueResult =
  | { ok: true; saveUrl: string; balancePoints: number }
  | { ok: false; error: "token_invalid" | "not_found" | "rate_limited" | "account_inactive" | "unavailable" | "network" };

/** Issue Google Wallet Save URL from public_card_token only (no shop/account ids). */
export async function issuePublicGoogleWallet(token: string): Promise<PublicWalletIssueResult> {
  const trimmed = token.trim();
  if (!isValidPublicCardTokenFormat(trimmed)) {
    return { ok: false, error: "token_invalid" };
  }
  if (!hasSupabaseConfig) return { ok: false, error: "unavailable" };

  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
  if (!base || !anon) return { ok: false, error: "unavailable" };

  try {
    const res = await fetch(`${base}/functions/v1/loyalty-public-wallet-issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ token: trimmed }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 429 || body.error === "rate_limited") {
      return { ok: false, error: "rate_limited" };
    }
    if (body.error === "token_invalid" || body.error === "token_required") {
      return { ok: false, error: "token_invalid" };
    }
    if (res.status === 404 || body.error === "not_found") {
      return { ok: false, error: "not_found" };
    }
    if (body.error === "account_inactive") {
      return { ok: false, error: "account_inactive" };
    }
    if (!res.ok || body.ok !== true || typeof body.save_url !== "string" || !body.save_url) {
      return { ok: false, error: "unavailable" };
    }

    // Keep save_url only in returned value (caller memory) — never log.
    return {
      ok: true,
      saveUrl: body.save_url,
      balancePoints: Math.max(0, Math.trunc(Number(body.balance_points ?? 0))),
    };
  } catch {
    return { ok: false, error: "network" };
  }
}
