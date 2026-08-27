import { fetchProfilePrimaryShopId, listUserShops } from "./primaryShop";
import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { hasSupabaseConfig } from "./supabase";
import { setCachedShopId } from "./shopSyncContext";
import { getActiveAccountKey } from "../offline/accountScope";
import { migrateLegacyPersistenceToShop } from "../offline/shopScopeMigration";
import { getActiveShopId, isValidShopId, setActiveShopId } from "../offline/shopScope";

/**
 * Resolve and activate the initial shop before local bootstrap.
 * Uses membership + primary shop — never guesses among multiple shops without primary.
 */
export async function initializeActiveShopForAccount(userId: string | null): Promise<string | null> {
  if (!hasSupabaseConfig || !userId || !getActiveAccountKey()?.startsWith("sb:")) {
    return getActiveShopId();
  }

  if (getActiveShopId() && isValidShopId(getActiveShopId())) {
    const shopId = getActiveShopId()!;
    await migrateLegacyPersistenceToShop(shopId);
    setCachedShopId(shopId);
    return shopId;
  }

  const shops = await listUserShops();
  let shopId: string | null = null;

  const primaryRow = shops.find((s) => s.is_primary);
  if (primaryRow && isValidShopId(primaryRow.shop_id)) {
    shopId = primaryRow.shop_id;
  } else if (shops.length === 1 && isValidShopId(shops[0]!.shop_id)) {
    shopId = shops[0]!.shop_id;
  } else {
    const profilePrimary = await fetchProfilePrimaryShopId(userId);
    if (profilePrimary && isValidShopId(profilePrimary) && shops.some((s) => s.shop_id === profilePrimary)) {
      shopId = profilePrimary;
    } else {
      const org = await resolvePrimaryOrganizationForUser(userId);
      if (org?.shopId && isValidShopId(org.shopId)) {
        shopId = org.shopId;
      }
    }
  }

  if (!shopId) return null;

  setActiveShopId(shopId);
  setCachedShopId(shopId);
  await migrateLegacyPersistenceToShop(shopId);
  return shopId;
}
