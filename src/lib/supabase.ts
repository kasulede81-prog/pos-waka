import { createClient } from "@supabase/supabase-js";
import { authDevLog, getAuthCallbackUrl } from "./authConfig";

/**
 * Browser client uses the **anon** key only. Row Level Security (RLS) must enforce access.
 * The **service role** key must never be prefixed with VITE_ or shipped to clients.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
}
