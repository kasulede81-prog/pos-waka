import { supabase } from "../supabase";
import type { ShopAiSettings, ShopAiUsageSummary } from "./shopAiSettings";
import { parseShopAiSettings } from "./shopAiSettings";

export type AdminShopAiBundle = {
  settings: ShopAiSettings;
  usage: ShopAiUsageSummary;
};

const memberSettingsCache = new Map<string, { value: ShopAiSettings; at: number }>();
const memberSettingsInflight = new Map<string, Promise<ShopAiSettings | null>>();
const MEMBER_SETTINGS_CACHE_MS = 60_000;

export async function fetchShopAiSettingsForMember(shopId: string): Promise<ShopAiSettings | null> {
  if (!supabase || !shopId) return null;

  const cached = memberSettingsCache.get(shopId);
  if (cached && Date.now() - cached.at < MEMBER_SETTINGS_CACHE_MS) return cached.value;

  const inflight = memberSettingsInflight.get(shopId);
  if (inflight) return inflight;

  const run = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_shop_ai_settings_for_member", { p_shop_id: shopId });
      if (error || !data) return null;
      const parsed = parseShopAiSettings(data, shopId);
      if (parsed) memberSettingsCache.set(shopId, { value: parsed, at: Date.now() });
      return parsed;
    } finally {
      memberSettingsInflight.delete(shopId);
    }
  })();
  memberSettingsInflight.set(shopId, run);
  return run;
}

export async function adminFetchShopAiSettings(shopId: string): Promise<AdminShopAiBundle | null> {
  if (!supabase || !shopId) return null;
  const { data, error } = await supabase.rpc("admin_get_shop_ai_settings", { p_shop_id: shopId });
  if (error || !data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;
  const settings = parseShopAiSettings(obj.settings, shopId);
  if (!settings) return null;

  const usageRaw = (obj.usage ?? {}) as Record<string, unknown>;
  const usage: ShopAiUsageSummary = {
    requests_this_month: Number(usageRaw.requests_this_month ?? 0) || 0,
    last_activity_at: usageRaw.last_activity_at != null ? String(usageRaw.last_activity_at) : null,
  };

  return { settings, usage };
}

export async function adminUpdateShopAiSettings(
  shopId: string,
  patch: Partial<ShopAiSettings>,
): Promise<{ ok: boolean; error?: string; settings?: ShopAiSettings }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_update_shop_ai_settings", {
    p_shop_id: shopId,
    p_settings: patch,
  });
  if (error) return { ok: false, error: error.message };
  memberSettingsCache.delete(shopId);
  const row = (data ?? {}) as { ok?: boolean; settings?: unknown };
  if (!row.ok) return { ok: false, error: "update_failed" };
  const settings = parseShopAiSettings(row.settings, shopId);
  return settings ? { ok: true, settings } : { ok: true };
}
