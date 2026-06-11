import { supabase } from "../supabase";
import { parsePlatformAiSettings } from "./aiProductSchemas";
import {
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  type PlatformAiSettingsV2,
} from "./platformAiSettings.v2";

let cached: PlatformAiSettingsV2 | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

export type PlatformAiSettingsResult = {
  settings: PlatformAiSettingsV2;
  fromServer: boolean;
};

export async function fetchPlatformAiSettings(force = false): Promise<PlatformAiSettingsResult> {
  const now = Date.now();
  if (!force && cached && now - cacheAt < CACHE_MS) {
    return { settings: cached, fromServer: true };
  }

  if (!supabase) {
    cached = DEFAULT_PLATFORM_AI_SETTINGS_V2;
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  const { data, error } = await supabase.rpc("get_platform_ai_settings");
  if (error || !data) {
    cached = DEFAULT_PLATFORM_AI_SETTINGS_V2;
    cacheAt = now;
    return { settings: cached, fromServer: false };
  }

  cached = parsePlatformAiSettings(data);
  cacheAt = now;
  return { settings: cached, fromServer: true };
}

export function invalidatePlatformAiSettingsCache(): void {
  cached = null;
  cacheAt = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("waka:ai-settings-changed"));
  }
}
