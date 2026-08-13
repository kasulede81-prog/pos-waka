/**
 * Phase 39.1 — real organization blast-radius summary for owner self-delete consent.
 * Counts come from cloud membership tables; never invent numbers.
 */

import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { supabase } from "./supabase";

export type OwnerDeletionBlastRadius = {
  organizationId: string | null;
  organizationName: string | null;
  shopCount: number | null;
  /** Distinct non-owner auth user ids linked via shop/org membership (best-effort). */
  staffAuthCount: number | null;
  primaryShopName: string | null;
};

export const EMPTY_OWNER_DELETION_BLAST_RADIUS: OwnerDeletionBlastRadius = {
  organizationId: null,
  organizationName: null,
  shopCount: null,
  staffAuthCount: null,
  primaryShopName: null,
};

export async function loadOwnerDeletionBlastRadius(userId: string | null | undefined): Promise<OwnerDeletionBlastRadius> {
  if (!userId || !supabase) return { ...EMPTY_OWNER_DELETION_BLAST_RADIUS };

  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return { ...EMPTY_OWNER_DELETION_BLAST_RADIUS };

  const [{ data: org }, { data: shops }] = await Promise.all([
    supabase.from("organizations").select("id, name").eq("id", orgShop.organizationId).maybeSingle(),
    supabase.from("shops").select("id, name").eq("organization_id", orgShop.organizationId),
  ]);

  const shopRows = shops ?? [];
  const shopIds = shopRows.map((s) => String(s.id));
  const primaryShopName =
    shopRows.find((s) => String(s.id) === orgShop.shopId)?.name?.trim() ||
    shopRows[0]?.name?.trim() ||
    null;

  let staffAuthCount: number | null = null;
  if (shopIds.length > 0) {
    const ids = new Set<string>();
    const [{ data: shopMembers }, { data: orgMembers }] = await Promise.all([
      supabase.from("shop_members").select("user_id").in("shop_id", shopIds),
      supabase.from("organization_members").select("user_id").eq("organization_id", orgShop.organizationId),
    ]);
    for (const row of shopMembers ?? []) {
      const id = typeof row.user_id === "string" ? row.user_id : "";
      if (id && id !== userId) ids.add(id);
    }
    for (const row of orgMembers ?? []) {
      const id = typeof row.user_id === "string" ? row.user_id : "";
      if (id && id !== userId) ids.add(id);
    }
    staffAuthCount = ids.size;
  } else {
    staffAuthCount = 0;
  }

  return {
    organizationId: orgShop.organizationId,
    organizationName: typeof org?.name === "string" && org.name.trim() ? org.name.trim() : null,
    shopCount: shopRows.length,
    staffAuthCount,
    primaryShopName,
  };
}

/** Typed confirm accepts the permanent phrase or the exact organization name. */
export function matchesOwnerDeletionConfirmText(
  typed: string,
  opts: { organizationName?: string | null; shopName?: string | null },
): boolean {
  const value = typed.trim();
  if (!value) return false;
  if (value === "DELETE PERMANENTLY") return true;
  const org = opts.organizationName?.trim();
  if (org && value.toUpperCase() === org.toUpperCase()) return true;
  return false;
}
