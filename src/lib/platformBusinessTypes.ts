import {
  DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  parsePlatformBusinessTypeSettings,
  type PlatformBusinessTypeSettings,
} from "../config/businessTypeVisibility";
import { supabase } from "./supabase";
import { fetchWakaInternalAdminMe } from "./wakaInternalAdmin";
import { isSuperAdmin, normalizeAdminRole } from "../components/internal-admin/v2/adminRoles";

let cachedSettings: PlatformBusinessTypeSettings | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

export async function fetchPlatformBusinessTypeSettings(
  force = false,
): Promise<PlatformBusinessTypeSettings> {
  const now = Date.now();
  if (!force && cachedSettings && now - cacheAt < CACHE_MS) return cachedSettings;

  if (!supabase) {
    cachedSettings = DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS;
    cacheAt = now;
    return cachedSettings;
  }

  const { data, error } = await supabase.rpc("get_platform_business_type_settings");
  if (error || !data) {
    cachedSettings = DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS;
  } else {
    cachedSettings = parsePlatformBusinessTypeSettings(data);
  }
  cacheAt = now;
  return cachedSettings;
}

export function invalidatePlatformBusinessTypeSettingsCache(): void {
  cachedSettings = null;
  cacheAt = 0;
}

export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  const row = await fetchWakaInternalAdminMe();
  return isSuperAdmin(normalizeAdminRole(row?.role));
}

export async function adminSetBusinessTypeEnabled(
  businessType: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_set_business_type_enabled", {
    p_business_type: businessType,
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "update_failed" };
  invalidatePlatformBusinessTypeSettingsCache();
  return { ok: true };
}

export async function adminSetShowExperimentalBusinessTypes(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_set_show_experimental_business_types", {
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "update_failed" };
  invalidatePlatformBusinessTypeSettingsCache();
  return { ok: true };
}
