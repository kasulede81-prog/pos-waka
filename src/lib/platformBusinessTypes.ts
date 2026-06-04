import {
  DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  REGISTRATION_SAFE_BUSINESS_TYPE_SETTINGS,
  parsePlatformBusinessTypeSettings,
  type PlatformBusinessTypeSettings,
} from "../config/businessTypeVisibility";
import { supabase } from "./supabase";
import { fetchWakaInternalAdminMe } from "./wakaInternalAdmin";
import { isSuperAdmin, normalizeAdminRole } from "../components/internal-admin/v2/adminRoles";

let cachedSettings: PlatformBusinessTypeSettings | null = null;
let cachedFromServer = false;
let cacheAt = 0;
const CACHE_MS = 60_000;

export type PlatformBusinessTypeSettingsResult = {
  settings: PlatformBusinessTypeSettings;
  /** True when read from `get_platform_business_type_settings` RPC. */
  fromServer: boolean;
};

export async function fetchPlatformBusinessTypeSettings(
  force = false,
  opts?: { forRegistration?: boolean },
): Promise<PlatformBusinessTypeSettingsResult> {
  const now = Date.now();
  if (!force && cachedSettings && now - cacheAt < CACHE_MS) {
    return { settings: cachedSettings, fromServer: cachedFromServer };
  }

  const registrationFallback = () => {
    const settings = opts?.forRegistration
      ? REGISTRATION_SAFE_BUSINESS_TYPE_SETTINGS
      : DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS;
    cachedSettings = settings;
    cachedFromServer = false;
    cacheAt = now;
    return { settings, fromServer: false };
  };

  if (!supabase) return registrationFallback();

  const { data, error } = await supabase.rpc("get_platform_business_type_settings");
  if (error || !data) {
    return registrationFallback();
  }
  cachedSettings = parsePlatformBusinessTypeSettings(data);
  cachedFromServer = true;
  cacheAt = now;
  return { settings: cachedSettings, fromServer: true };
}

export function invalidatePlatformBusinessTypeSettingsCache(): void {
  cachedSettings = null;
  cachedFromServer = false;
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
