import { supabase } from "./supabase";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { normalizeUserRole } from "./permissions";
import { withTimeout } from "./promiseTimeout";
import type { UserRole } from "../types";

export const SHOP_MEMBER_ROLE_FETCH_TIMEOUT_MS = 8000;

/**
 * Resolves the user's role from `shop_members` for their primary shop.
 * Returns null when offline, unconfigured, or no membership row exists.
 */
export async function fetchShopMemberRoleForUser(userId: string): Promise<UserRole | null> {
  if (!supabase) return null;

  return withTimeout(fetchShopMemberRoleForUserInner(userId), SHOP_MEMBER_ROLE_FETCH_TIMEOUT_MS, null);
}

async function fetchShopMemberRoleForUserInner(userId: string): Promise<UserRole | null> {
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return null;

  const { data, error } = await supabase!
    .from("shop_members")
    .select("role")
    .eq("user_id", userId)
    .eq("shop_id", orgShop.shopId)
    .maybeSingle();

  if (error || !data?.role) return null;
  const role = normalizeUserRole(data.role);
  if (!role) return null;
  return role;
}
