/**
 * Google Sign-In on Capacitor (Android/iOS).
 *
 * GIS popup mode does not work reliably inside the WebView. Native uses
 * Supabase OAuth in the system browser, then returns to https://localhost/auth/callback.
 *
 * Supabase → Auth → URL configuration must include:
 *   https://localhost/auth/callback
 *   https://pos.waka.ug/auth/callback
 */
import { Browser } from "@capacitor/browser";
import { getAuthCallbackUrl } from "./authConfig";
import {
  getSupabaseOAuthCallbackUrl,
  resolveNativeGoogleOAuthBrowserUrl,
} from "./nativeOAuthBrandedProxy";
import { registerNativeAuthDeepLinkHandler, setPendingOAuthHandlers } from "./nativeAuthDeepLink";
import { supabase } from "./supabase";

export function registerNativeOAuthDeepLinkHandler(): void {
  registerNativeAuthDeepLinkHandler();
}

/** System-browser Google OAuth for native shell (not GIS popup). */
export async function signInWithGoogleNative(): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const redirectTo = getAuthCallbackUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("Could not start Google sign-in.");

  const url = await resolveNativeGoogleOAuthBrowserUrl(data.url);

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      setPendingOAuthHandlers(null);
      reject(new Error("Google sign-in timed out. Please try again."));
    }, 180_000);

    setPendingOAuthHandlers({
      resolve: () => {
        window.clearTimeout(timeoutId);
        resolve();
      },
      reject: (err) => {
        window.clearTimeout(timeoutId);
        reject(err);
      },
    });

    void Browser.open({ url, presentationStyle: "popover" }).catch((e) => {
      setPendingOAuthHandlers(null);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/** @deprecated use getSupabaseOAuthCallbackUrl from nativeOAuthBrandedProxy */
export { getSupabaseOAuthCallbackUrl };
