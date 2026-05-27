/**
 * Google Sign-In on Capacitor (Android/iOS).
 *
 * GIS popup mode does not work reliably inside the WebView. Native uses
 * Supabase OAuth in the system browser, then returns to https://localhost/auth/callback.
 *
 * Supabase → Auth → URL configuration must include:
 *   https://localhost/auth/callback
 */
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { getAuthCallbackUrl } from "./authConfig";
import {
  getSupabaseOAuthCallbackUrl,
  resolveNativeGoogleOAuthBrowserUrl,
} from "./nativeOAuthBrandedProxy";
import { supabase } from "./supabase";

let deepLinkRegistered = false;
let pendingOAuth: {
  resolve: () => void;
  reject: (err: Error) => void;
} | null = null;

async function finishOAuthFromUrl(url: string): Promise<boolean> {
  if (!supabase) return false;
  if (!url.includes("/auth/callback")) return false;

  try {
    await Browser.close();
  } catch {
    /* already closed */
  }

  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  const hash = parsed.hash.replace(/^#/, "");
  if (hash) {
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      return true;
    }
  }

  const err =
    parsed.searchParams.get("error_description") ||
    parsed.searchParams.get("error") ||
    new URLSearchParams(hash).get("error_description");
  if (err) {
    if (String(err).includes("redirect_uri_mismatch")) {
      const supabaseCb = getSupabaseOAuthCallbackUrl();
      const brandedCb = "https://pos.waka.ug/auth/v1/callback";
      throw new Error(
        supabaseCb
          ? `Google redirect URI mismatch. In Google Cloud → your Web OAuth client → Authorized redirect URIs, add BOTH:\n${supabaseCb}\n${brandedCb}\nSave, wait 2 minutes, then try again.`
          : "Google redirect URI mismatch. Add your Supabase /auth/v1/callback and https://pos.waka.ug/auth/v1/callback in Google Cloud (see docs/GOOGLE_OAUTH_BRANDING.md).",
      );
    }
    throw new Error(err);
  }
  return false;
}

export function registerNativeOAuthDeepLinkHandler(): void {
  if (!Capacitor.isNativePlatform() || deepLinkRegistered) return;
  deepLinkRegistered = true;

  void App.addListener("appUrlOpen", ({ url }) => {
    void (async () => {
      try {
        const handled = await finishOAuthFromUrl(url);
        if (handled && pendingOAuth) {
          pendingOAuth.resolve();
          pendingOAuth = null;
        }
      } catch (e) {
        if (pendingOAuth) {
          pendingOAuth.reject(e instanceof Error ? e : new Error(String(e)));
          pendingOAuth = null;
        }
      }
    })();
  });
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
      if (pendingOAuth) {
        pendingOAuth.reject(new Error("Google sign-in timed out. Please try again."));
        pendingOAuth = null;
      }
    }, 180_000);

    pendingOAuth = {
      resolve: () => {
        window.clearTimeout(timeoutId);
        resolve();
      },
      reject: (err) => {
        window.clearTimeout(timeoutId);
        reject(err);
      },
    };

    void Browser.open({ url, presentationStyle: "popover" }).catch((e) => {
      if (pendingOAuth) {
        pendingOAuth.reject(e instanceof Error ? e : new Error(String(e)));
        pendingOAuth = null;
      }
    });
  });
}
