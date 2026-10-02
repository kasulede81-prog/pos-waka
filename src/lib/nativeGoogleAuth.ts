/**
 * Google Sign-In on Capacitor (Android/iOS).
 *
 * GIS popup mode does not work reliably inside the WebView, so native uses Supabase OAuth in the
 * system browser and returns through the app's own custom scheme:
 *
 *   Google → Supabase → wakapos://callback?code=… → app → /auth/callback → PKCE exchange
 *
 * IT USED TO COME BACK VIA `https://localhost/auth/callback`, WHICH THE APP COULD NOT RELIABLY
 * RECEIVE. `localhost` on a phone is the phone itself, where nothing listens, and an https URL only
 * reaches the app through an App Link — every https filter in the manifest is `autoVerify="false"`
 * and no `assetlinks.json` is served, so Android was under no obligation to route it here. The
 * custom scheme is registered, needs no verification, and is already mapped to the in-app route by
 * `normalizeAuthDeepLinkToAppPath`.
 *
 * Supabase → Auth → URL configuration must include `wakapos://callback`
 * (see `getSupabaseAuthRedirectUrls`).
 */
import { Browser } from "@capacitor/browser";
import { getNativeGoogleOAuthRedirectUrl } from "./authConfig";
import {
  getSupabaseOAuthCallbackUrl,
  resolveNativeGoogleOAuthBrowserUrl,
} from "./nativeOAuthBrandedProxy";
import {
  oauthCallbackDelivered,
  registerNativeAuthDeepLinkHandler,
  setPendingOAuthHandlers,
} from "./nativeAuthDeepLink";
import { supabase } from "./supabase";

/** Shown when the person closes the Google tab without finishing. Not an error they caused. */
export const GOOGLE_SIGN_IN_CANCELLED = "Google sign-in was cancelled.";

export function registerNativeOAuthDeepLinkHandler(): void {
  registerNativeAuthDeepLinkHandler();
}

/** System-browser Google OAuth for native shell (not GIS popup). */
export async function signInWithGoogleNative(): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");

  // The app's own scheme. NOT `getAuthCallbackUrl()` — that stays on the public/localhost origin
  // for email confirmation, password recovery and web development.
  const redirectTo = getNativeGoogleOAuthRedirectUrl();

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
    /**
     * Cleanup is centralised so the browser listener can never accumulate. Every exit from this
     * flow — return, cancellation, timeout, open failure — goes through `settle` exactly once.
     */
    let settled = false;
    let removeBrowserListener: (() => void) | undefined;

    const settle = (outcome: { ok: true } | { ok: false; error: Error }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      removeBrowserListener?.();
      removeBrowserListener = undefined;
      setPendingOAuthHandlers(null);
      if (outcome.ok) resolve();
      else reject(outcome.error);
    };

    /**
     * CLOSING THE TAB IS NOT A SUCCESSFUL SIGN-IN — AND IT MUST NOT HANG.
     *
     * This flow used to be escapable only by the deep link or a 180-second timeout, so a person who
     * backed out of Google sat on "Signing in…" for three minutes. Dismissing the Custom Tab fires
     * `browserFinished` immediately, which cancels the attempt and lets them press the button again.
     *
     * A SUCCESSFUL return closes the tab too, so the event alone proves nothing: `applyAuthDeepLink`
     * marks the callback as delivered before it closes the browser, and that flag is what separates
     * "we have the code" from "they walked away".
     */
    const onBrowserFinished = () => {
      if (oauthCallbackDelivered()) return;
      settle({ ok: false, error: new Error(GOOGLE_SIGN_IN_CANCELLED) });
    };

    // Safety net only. Cancellation and success both resolve long before this now.
    const timeoutId = window.setTimeout(() => {
      settle({ ok: false, error: new Error("Google sign-in timed out. Please try again.") });
    }, 180_000);

    setPendingOAuthHandlers({
      resolve: () => settle({ ok: true }),
      reject: (err) => settle({ ok: false, error: err }),
    });

    void Browser.addListener("browserFinished", onBrowserFinished)
      .then((handle) => {
        // The flow may already have settled while the listener was being attached.
        if (settled) {
          void handle.remove();
          return;
        }
        removeBrowserListener = () => void handle.remove();
      })
      .catch(() => {
        /* plugin unavailable — the timeout still protects the flow */
      });

    void Browser.open({ url, presentationStyle: "popover" }).catch((e) => {
      settle({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
    });
  });
}

/** @deprecated use getSupabaseOAuthCallbackUrl from nativeOAuthBrandedProxy */
export { getSupabaseOAuthCallbackUrl };
