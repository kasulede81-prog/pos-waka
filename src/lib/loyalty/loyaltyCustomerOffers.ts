import { hasSupabaseConfig, supabase } from "../supabase";

export type LoyaltyOfferKind =
  | "earn_multiplier"
  | "earn_bonus_flat"
  | "reward_grant"
  | "status_badge"
  | "campaign";

export type LoyaltyOfferStatus = "active" | "paused" | "revoked";

export type LoyaltyCustomerOffer = {
  id: string;
  shopId: string;
  accountId: string;
  offerKind: LoyaltyOfferKind;
  title: string;
  priority: number;
  config: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
  status: LoyaltyOfferStatus;
  createdAt: string;
  revokedAt: string | null;
  note: string | null;
  windowActive: boolean;
};

function mapOffer(raw: Record<string, unknown>): LoyaltyCustomerOffer {
  return {
    id: String(raw.id),
    shopId: String(raw.shop_id),
    accountId: String(raw.account_id),
    offerKind: String(raw.offer_kind) as LoyaltyOfferKind,
    title: String(raw.title ?? ""),
    priority: Number(raw.priority ?? 0),
    config: (raw.config && typeof raw.config === "object"
      ? (raw.config as Record<string, unknown>)
      : {}) as Record<string, unknown>,
    startsAt: raw.starts_at ? String(raw.starts_at) : null,
    endsAt: raw.ends_at ? String(raw.ends_at) : null,
    status: String(raw.status) as LoyaltyOfferStatus,
    createdAt: String(raw.created_at ?? ""),
    revokedAt: raw.revoked_at ? String(raw.revoked_at) : null,
    note: raw.note != null ? String(raw.note) : null,
    windowActive: Boolean(raw.window_active),
  };
}

function rpcPayload(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return {};
}

export async function listCustomerLoyaltyOffers(
  shopId: string,
  accountId: string,
): Promise<LoyaltyCustomerOffer[]> {
  if (!hasSupabaseConfig || !supabase || !shopId || !accountId) return [];
  try {
    const { data, error } = await supabase.rpc("loyalty_list_customer_offers", {
      p_shop_id: shopId,
      p_account_id: accountId,
    });
    if (error) return [];
    const payload = rpcPayload(data);
    if (!payload.ok) return [];
    const offers = Array.isArray(payload.offers) ? payload.offers : [];
    return offers.map((o) => mapOffer(o as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function createCustomerLoyaltyOffer(input: {
  shopId: string;
  accountId: string;
  offerKind: LoyaltyOfferKind;
  title: string;
  config: Record<string, unknown>;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
}): Promise<{ ok: true; offerId: string } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_create_customer_offer", {
      p_shop_id: input.shopId,
      p_account_id: input.accountId,
      p_offer_kind: input.offerKind,
      p_title: input.title,
      p_config: input.config,
      p_priority: input.priority ?? 0,
      p_starts_at: input.startsAt ?? null,
      p_ends_at: input.endsAt ?? null,
      p_note: input.note ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const payload = rpcPayload(data);
    if (!payload.ok) return { ok: false, error: String(payload.error ?? "failed") };
    return { ok: true, offerId: String(payload.offer_id) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function setCustomerLoyaltyOfferStatus(
  shopId: string,
  offerId: string,
  status: LoyaltyOfferStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("loyalty_set_customer_offer_status", {
      p_shop_id: shopId,
      p_offer_id: offerId,
      p_status: status,
    });
    if (error) return { ok: false, error: error.message };
    const payload = rpcPayload(data);
    if (!payload.ok) return { ok: false, error: String(payload.error ?? "failed") };
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function previewAccountLoyaltyOffers(
  shopId: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("loyalty_preview_account_offers", {
      p_shop_id: shopId,
      p_account_id: accountId,
    });
    if (error) return null;
    const payload = rpcPayload(data);
    return payload.ok ? payload : null;
  } catch {
    return null;
  }
}

/** Client-side mirror of server compose for previews (not authoritative). */
export function composeOfferPointsClient(
  basePoints: number,
  effectiveMultiplier: number,
  flatBonusPoints: number,
): number {
  const base = Number.isFinite(basePoints) ? Math.max(0, Math.trunc(basePoints)) : 0;
  const mult =
    Number.isFinite(effectiveMultiplier) && effectiveMultiplier > 0 ? effectiveMultiplier : 1;
  const flat = Number.isFinite(flatBonusPoints) ? Math.max(0, Math.trunc(flatBonusPoints)) : 0;
  return Math.max(0, Math.trunc(base * mult) + flat);
}
