import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { authDevLog, getAuthCallbackUrl } from "./authConfig";

/**
 * Browser / Capacitor client uses the **anon** key only. Row Level Security (RLS) must enforce access.
 * The **service role** key must never be prefixed with VITE_ or shipped to clients.
 *
 * Capacitor iOS/Android load either:
 * - Bundled `dist/` (production) with `https://localhost` origin, or
 * - Vite live-reload (`CAPACITOR_DEV_SERVER_URL`) during development.
 * Session persistence uses WebView `localStorage` (same as web) — works across app restarts.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      },
    })
  : null;

/** @deprecated use authRedirectOrigin from ./authConfig */
export { authRedirectOrigin, getAuthCallbackUrl, getAuthRecoveryUrl } from "./authConfig";

if (import.meta.env.DEV && hasSupabaseConfig) {
  authDevLog("log", "Supabase auth redirect callback", getAuthCallbackUrl());
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    authDevLog("log", "Native Capacitor origin", window.location.origin);
  }
}
