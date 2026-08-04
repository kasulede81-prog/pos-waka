import { supabase } from "../supabase";
import type { ShopVisionSettings } from "./shopVisionSettings";
import { parseShopVisionSettings } from "./shopVisionSettings";

const memberCache = new Map<string, { value: ShopVisionSettings; at: number }>();
const memberInflight = new Map<string, Promise<ShopVisionSettings | null>>();
const CACHE_MS = 60_000;

export async function fetchShopVisionSettingsForMember(shopId: string): Promise<ShopVisionSettings | null> {
  if (!supabase || !shopId) return null;

  const cached = memberCache.get(shopId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const inflight = memberInflight.get(shopId);
  if (inflight) return inflight;

  const run = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_shop_vision_settings_for_member", {
        p_shop_id: shopId,
      });
      if (error || !data) return null;
      const parsed = parseShopVisionSettings(data, shopId);
      if (parsed) memberCache.set(shopId, { value: parsed, at: Date.now() });
      return parsed;
    } finally {
      memberInflight.delete(shopId);
    }
  })();
  memberInflight.set(shopId, run);
  return run;
}

export async function adminFetchShopVisionSettings(shopId: string): Promise<ShopVisionSettings | null> {
  if (!supabase || !shopId) return null;
  const { data, error } = await supabase.rpc("admin_get_shop_vision_settings", { p_shop_id: shopId });
  if (error || !data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  return parseShopVisionSettings(obj.settings, shopId);
}

export async function adminUpdateShopVisionSettings(
  shopId: string,
  patch: Partial<ShopVisionSettings>,
): Promise<{ ok: boolean; error?: string; settings?: ShopVisionSettings }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_update_shop_vision_settings", {
    p_shop_id: shopId,
    p_settings: patch,
  });
  if (error) return { ok: false, error: error.message };
  memberCache.delete(shopId);
  const row = (data ?? {}) as { ok?: boolean; settings?: unknown };
  if (!row.ok) return { ok: false, error: "update_failed" };
  const settings = parseShopVisionSettings(row.settings, shopId);
  return settings ? { ok: true, settings } : { ok: true };
}

export function clearShopVisionSettingsCache(shopId?: string) {
  if (shopId) memberCache.delete(shopId);
  else memberCache.clear();
}
