import { hasSupabaseConfig } from "./supabase";

/** True when Supabase likely has a persisted session in localStorage (fast startup). */
export function hasLikelyPersistedSupabaseSession(): boolean {
  if (!hasSupabaseConfig || typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.includes("auth-token")) return true;
    }
  } catch {
    return false;
  }
  return false;
}
