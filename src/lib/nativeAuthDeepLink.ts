import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { DKASU_POS_PRODUCT_HOST, normalizeHostname } from "./productHost";

const AUTH_DEEP_LINK_PATHS = ["/auth/callback", "/auth/recovery", "/reset-password"] as const;

let handlerRegistered = false;

/** OAuth browser flow waits for deep link return (Google sign-in). */
let pendingOAuth: {
  resolve: () => void;
  reject: (err: Error) => void;
} | null = null;

/**
 * Whether a deep link has been ACCEPTED for the flow that is currently pending.
 *
 * A successful OAuth return closes the browser tab too, so `browserFinished` alone cannot mean
 * "the person gave up". This flag is what tells the two apart, and it is set BEFORE the tab is
 * closed so the distinction cannot race.
 */
let callbackDelivered = false;

/** The last callback applied, so a re-delivered deep link cannot be exchanged twice. */
let lastAppliedAppPath: string | null = null;

export function setPendingOAuthHandlers(handlers: {
  resolve: () => void;
  reject: (err: Error) => void;
} | null): void {
  pendingOAuth = handlers;
  // Every new flow starts with "no callback yet"; clearing also ends the previous flow's window.
  if (handlers) callbackDelivered = false;
}

/** True once a deep link has been accepted for the pending flow. */
export function oauthCallbackDelivered(): boolean {
  return callbackDelivered;
}

/** Test hook — module state outlives a single test. */
export function resetNativeAuthDeepLinkStateForTests(): void {
  pendingOAuth = null;
  callbackDelivered = false;
  lastAppliedAppPath = null;
}

/**
 * Hosts whose `/auth/callback` may hand a browser session off into the DKASU POS Android app.
 *
 * THE POS APP MUST NOT HIJACK ANOTHER PRODUCT'S CALLBACK. `tryOpenInstalledAppFromBrowserCallback`
 * used to fire for ANY host whose path contained `/auth/callback`, so a Loyalty customer opening
 * their confirmation link on an Android phone with the POS app installed was pulled into the POS
 * app. This allow list is the fix: the POS surface only, plus the two loopback hosts the web dev
 * flow uses.
 *
 * BOTH GENERATIONS ARE ACCEPTED during the WAKA → DKASU migration: the DKASU POS host is added
 * alongside the WAKA hosts, not instead of them, because auth still returns to `pos.waka.ug`.
 */
export const POS_INTENT_HANDOFF_HOSTS: ReadonlySet<string> = new Set([
  "pos.waka.ug",
  DKASU_POS_PRODUCT_HOST,
  "waka.ug",
  "localhost",
  "127.0.0.1",
]);

/** May a callback on this host be handed off to the DKASU POS Android app? */
export function canHandOffToPosApp(hostname: string | null | undefined): boolean {
  return POS_INTENT_HANDOFF_HOSTS.has(normalizeHostname(hostname));
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

  // A DEEP LINK CAN ARRIVE TWICE. `appUrlOpen` and `App.getLaunchUrl()` can both report the same
  // launch, and Android may re-deliver an intent. Applying it again would navigate a second time
  // and exchange the same PKCE code twice — the second exchange is guaranteed to fail, and would
  // replace a good session with an error screen.
  if (appPath === lastAppliedAppPath) return;
  lastAppliedAppPath = appPath;

  // Set BEFORE closing the tab: closing it fires `browserFinished`, and the cancellation listener
  // must be able to tell "we have the callback" from "the person walked away".
  callbackDelivered = true;

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

/**
 * On mobile web, try to hand off the Supabase callback to the installed Android app.
 *
 * This serves links that land in a BROWSER — email confirmation and password recovery, which are
 * addressed to the public host — not the native Google flow, which now returns to the app directly
 * through `wakapos://callback` (`getNativeGoogleOAuthRedirectUrl`).
 *
 * Host-scoped on purpose: only the POS surface may be pulled into the POS app.
 */
export function tryOpenInstalledAppFromBrowserCallback(): void {
  if (typeof window === "undefined" || Capacitor.isNativePlatform()) return;
  if (!/Android/i.test(navigator.userAgent)) return;
  if (!canHandOffToPosApp(window.location.hostname)) return;
  if (!window.location.pathname.includes("/auth/callback")) return;

  const q = `${window.location.search}${window.location.hash}`;
  const fallback = encodeURIComponent(window.location.href);
  window.location.href = `intent://callback${q}#Intent;scheme=wakapos;package=ug.waka.pos;S.browser_fallback_url=${fallback};end`;
}
