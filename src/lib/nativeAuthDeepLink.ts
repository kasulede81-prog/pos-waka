import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

const AUTH_DEEP_LINK_PATHS = ["/auth/callback", "/auth/recovery", "/reset-password"] as const;

let handlerRegistered = false;

/** OAuth browser flow waits for deep link return (Google sign-in). */
let pendingOAuth: {
  resolve: () => void;
  reject: (err: Error) => void;
} | null = null;

export function setPendingOAuthHandlers(handlers: {
  resolve: () => void;
  reject: (err: Error) => void;
} | null): void {
  pendingOAuth = handlers;
}

/** Map email / universal-link URLs into in-app routes (Capacitor WebView paths). */
export function normalizeAuthDeepLinkToAppPath(url: string): string | null {
  if (url.startsWith("wakapos://")) {
    const raw = url.replace(/^wakapos:\/\//, "");
    const q = raw.indexOf("?");
    const pathPart = (q >= 0 ? raw.slice(0, q) : raw).replace(/^\/+/, "");
    const qs = q >= 0 ? raw.slice(q) : "";
    if (pathPart === "callback" || pathPart === "auth/callback") return `/auth/callback${qs}`;
    if (pathPart === "recovery" || pathPart === "auth/recovery") return `/auth/recovery${qs}`;
    if (pathPart === "reset-password") return `/reset-password${qs}`;
    return null;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "") || "/";
    const match = AUTH_DEEP_LINK_PATHS.find((p) => path === p || path.endsWith(p));
    if (!match) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    for (const p of AUTH_DEEP_LINK_PATHS) {
      const idx = url.indexOf(p);
      if (idx >= 0) return url.slice(idx);
    }
    return null;
  }
}

async function applyAuthDeepLink(url: string): Promise<void> {
  const appPath = normalizeAuthDeepLinkToAppPath(url);
  if (!appPath) return;

  try {
    await Browser.close();
  } catch {
    /* browser may already be closed */
  }

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== appPath) {
    window.location.replace(appPath);
  }

  if (pendingOAuth) {
    pendingOAuth.resolve();
    pendingOAuth = null;
  }
}

/** Register deep links for email confirm, password reset, and OAuth return. */
export function registerNativeAuthDeepLinkHandler(): void {
  if (!Capacitor.isNativePlatform() || handlerRegistered) return;
  handlerRegistered = true;

  const onUrl = (url: string) => {
    void applyAuthDeepLink(url);
  };

  void App.addListener("appUrlOpen", ({ url }) => onUrl(url));
  void App.getLaunchUrl().then((result) => {
    if (result?.url) onUrl(result.url);
  });
}

/** On mobile web, try to hand off the Supabase callback to the installed Android app. */
export function tryOpenInstalledAppFromBrowserCallback(): void {
  if (typeof window === "undefined" || Capacitor.isNativePlatform()) return;
  if (!/Android/i.test(navigator.userAgent)) return;
  if (!window.location.pathname.includes("/auth/callback")) return;

  const q = `${window.location.search}${window.location.hash}`;
  const fallback = encodeURIComponent(window.location.href);
  window.location.href = `intent://callback${q}#Intent;scheme=wakapos;package=ug.waka.pos;S.browser_fallback_url=${fallback};end`;
}
