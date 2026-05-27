import { getGoogleOAuthClientId } from "./googleIdentity";

/**
 * UI-only gate for Google Sign-In buttons and OAuth onboarding copy.
 * Backend Google provider config (Supabase, GIS, native OAuth) stays intact.
 *
 * Re-enable in production: VITE_ENABLE_GOOGLE_AUTH=true
 * Default when unset: false (hidden from auth screens).
 */
export function isGoogleAuthUiEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_GOOGLE_AUTH?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return false;
}

/** Google button may render only when the flag is on and a Web client ID is configured. */
export function isGoogleAuthUiAvailable(): boolean {
  return isGoogleAuthUiEnabled() && Boolean(getGoogleOAuthClientId());
}
