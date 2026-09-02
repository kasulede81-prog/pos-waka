import { fetchProfilePrimaryShopId, listUserShops } from "./primaryShop";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { hasSupabaseConfig } from "./supabase";
import { setCachedShopId, clearCachedShopId } from "./shopSyncContext";
import { getActiveAccountKey } from "../offline/accountScope";
import { migrateLegacyPersistenceToShop } from "../offline/shopScopeMigration";
import { getActiveShopId, isValidShopId, setActiveShopId } from "../offline/shopScope";

function isMember(shopId: string, memberIds: ReadonlySet<string>): boolean {
  return memberIds.has(shopId);
}

/**
 * Resolve and activate the initial shop before local bootstrap.
 * Uses membership + primary shop — never guesses among multiple shops without primary.
 * Never activates a shop missing from the loaded membership list.
 */
export async function initializeActiveShopForAccount(userId: string | null): Promise<string | null> {
  if (!hasSupabaseConfig || !userId || !getActiveAccountKey()?.startsWith("sb:")) {
    return getActiveShopId();
  }

  const shops = await listUserShops();
  const memberIds = new Set(shops.map((s) => s.shop_id).filter((id) => isValidShopId(id)));

  const current = getActiveShopId();
  if (current && isValidShopId(current)) {
    // Offline / empty RPC: keep the in-memory shop. If membership loaded, keep only if still a member.
    if (shops.length === 0 || isMember(current, memberIds)) {
      await migrateLegacyPersistenceToShop(current);
      setCachedShopId(current);
      return current;
    }
  }

  let shopId: string | null = null;

  const primaryRow = shops.find((s) => s.is_primary);
  if (primaryRow && isValidShopId(primaryRow.shop_id) && isMember(primaryRow.shop_id, memberIds)) {
    shopId = primaryRow.shop_id;
  } else if (shops.length === 1 && isValidShopId(shops[0]!.shop_id)) {
    shopId = shops[0]!.shop_id;
  } else {
    const profilePrimary = await fetchProfilePrimaryShopId(userId);
    if (profilePrimary && isValidShopId(profilePrimary) && isMember(profilePrimary, memberIds)) {
      shopId = profilePrimary;
    } else {
      const org = await resolvePrimaryOrganizationForUser(userId);
      if (org?.shopId && isValidShopId(org.shopId) && isMember(org.shopId, memberIds)) {
        shopId = org.shopId;
      }
    }
  }

  if (!shopId) {
    if (current && shops.length > 0 && !isMember(current, memberIds)) {
      setActiveShopId(null);
      clearCachedShopId();
    }
    return getActiveShopId();
  }

  setActiveShopId(shopId);
  setCachedShopId(shopId);
  await migrateLegacyPersistenceToShop(shopId);
  return shopId;
}
