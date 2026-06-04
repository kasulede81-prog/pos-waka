import { supabase } from "./supabase";

export type UserShopRow = {
  shop_id: string;
  shop_name: string | null;
  organization_id: string;
  role: string;
  is_primary: boolean;
};

export async function listUserShops(): Promise<UserShopRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_user_shops");
  if (error) {
    console.warn("[waka] list_user_shops", error.message);
    return [];
  }
  return Array.isArray(data) ? (data as UserShopRow[]) : [];
}

export async function setUserPrimaryShop(shopId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("set_user_primary_shop", { p_shop_id: shopId });
  if (error) {
    console.warn("[waka] set_user_primary_shop", error.message);
    return false;
  }
  const j = (data ?? {}) as { ok?: boolean };
  if (j.ok) {
    window.dispatchEvent(new CustomEvent("waka:primary-shop-changed", { detail: { shopId } }));
  }
  return j.ok === true;
}

export async function fetchProfilePrimaryShopId(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("primary_shop_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.primary_shop_id) return null;
  return data.primary_shop_id as string;
}
