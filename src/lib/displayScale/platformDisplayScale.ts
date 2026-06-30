import { supabase } from "../supabase";

export type PlatformDisplayScaleSettings = {
  enabled: boolean;
};

const DEFAULT: PlatformDisplayScaleSettings = { enabled: true };

let cached: PlatformDisplayScaleSettings | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

function parseSettings(raw: unknown): PlatformDisplayScaleSettings {
  if (!raw || typeof raw !== "object") return DEFAULT;
  const o = raw as Record<string, unknown>;
  return { enabled: o.enabled !== false };
}

export async function fetchPlatformDisplayScaleSettings(
  force = false,
): Promise<{ settings: PlatformDisplayScaleSettings; fromServer: boolean }> {
  const now = Date.now();
  if (!force && cached && now - cacheAt < CACHE_MS) {
    return { settings: cached, fromServer: true };
  }

  if (!supabase) {
    cached = DEFAULT;
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  const { data, error } = await supabase.rpc("get_platform_pos_display_scale_settings");
  if (error || !data) {
    cached = DEFAULT;
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  cached = parseSettings(data);
  cacheAt = now;
  return { settings: cached, fromServer: true };
}

export function invalidatePlatformDisplayScaleCache(): void {
  cached = null;
  cacheAt = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("waka:platform-display-scale-changed"));
  }
}

export async function adminUpdatePlatformDisplayScaleEnabled(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_update_platform_pos_display_scale_settings", {
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "update_failed" };
  invalidatePlatformDisplayScaleCache();
  return { ok: true };
}
