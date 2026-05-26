/**
 * Auth redirect configuration for Waka POS (Supabase + Google OAuth).
 * Production app URL: https://pos.waka.ug
 */

import { Capacitor } from "@capacitor/core";
import { WAKA_POS_URL } from "../config/company";

export const CANONICAL_APP_URL = WAKA_POS_URL.replace(/\/$/, "");

const AUTH_CALLBACK_PATH = "/auth/callback";
const AUTH_RECOVERY_PATH = "/auth/recovery";

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isUnsafeAppRedirectHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".supabase.co")
  );
}

export function enforceHttpsOrigin(origin: string): string {
  if (!origin) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return u.origin;
    }
    if (u.protocol === "http:") {
      u.protocol = "https:";
      return u.origin;
    }
    return u.origin;
  } catch {
    return origin;
  }
}

/** Origin for email links, OAuth return URLs, and password reset. */
export function authRedirectOrigin(): string {
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    return enforceHttpsOrigin(window.location.origin);
  }

  const fromEnv = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, "");

  if (import.meta.env.PROD) {
    let origin = fromEnv || CANONICAL_APP_URL;
    const host = parseHost(origin);
    if (!host || isUnsafeAppRedirectHost(host)) {
      authDevLog("warn", `Invalid VITE_APP_URL for production (${origin}); using ${CANONICAL_APP_URL}`);
      origin = CANONICAL_APP_URL;
    }
    return enforceHttpsOrigin(origin);
  }

  if (fromEnv) {
    const host = parseHost(fromEnv);
    if (host && !isUnsafeAppRedirectHost(host)) return enforceHttpsOrigin(fromEnv);
  }

  if (typeof window !== "undefined") {
    const live = window.location.origin;
    const host = parseHost(live);
    if (host && !isUnsafeAppRedirectHost(host)) return enforceHttpsOrigin(live);
  }

  return fromEnv || CANONICAL_APP_URL;
}

export function getAuthCallbackUrl(): string {
  return `${authRedirectOrigin()}${AUTH_CALLBACK_PATH}`;
}

export function getAuthRecoveryUrl(): string {
  return `${authRedirectOrigin()}${AUTH_RECOVERY_PATH}`;
}

export function getSupabaseProjectRef(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    return ref || null;
  } catch {
    return null;
  }
}

export function getGoogleOAuthJavaScriptOrigins(): string[] {
  const origins = new Set<string>([CANONICAL_APP_URL, "https://waka.ug"]);
  if (import.meta.env.DEV) {
    origins.add("http://localhost:5173");
  }
  /** Capacitor Android/iOS WebView origin when androidScheme is https */
  origins.add("https://localhost");
  return [...origins];
}

/** Redirect URLs to allow in Supabase Auth (documentation helper). */
export function getSupabaseAuthRedirectUrls(): string[] {
  return [
    `${CANONICAL_APP_URL}/auth/callback`,
    `${CANONICAL_APP_URL}/auth/recovery`,
    "https://waka.ug/auth/callback",
    "https://waka.ug/auth/recovery",
    "https://localhost/auth/callback",
    "https://localhost/auth/recovery",
    "http://localhost:5173/auth/callback",
    "http://localhost:5173/auth/recovery",
  ];
}

export function authDevLog(level: "log" | "warn" | "error", message: string, detail?: unknown): void {
  if (!import.meta.env.DEV) return;
  const prefix = "[waka-auth]";
  if (detail !== undefined) {
    console[level](prefix, message, detail);
  } else {
    console[level](prefix, message);
  }
}

export function formatAuthError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: string }).message === "string") {
    const msg = (err as { message: string }).message;
    if (msg.toLowerCase().includes("redirect")) {
      return "Sign-in could not finish. Please try again, or contact support if this continues.";
    }
    const lower = msg.toLowerCase();
    if (
      lower.includes("supabase") ||
      lower.includes("vite_") ||
      lower.includes(".env") ||
      lower.includes("oauth") ||
      lower.includes("jwt") ||
      lower.includes("rpc")
    ) {
      return "Sign-in did not work. Please try again, or contact Waka support.";
    }
    return msg;
  }
  return "Something went wrong during sign-in. Please try again.";
}

export function parseOAuthCallbackError(): string | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    search.get("error_description") ||
    search.get("error") ||
    hash.get("error_description") ||
    hash.get("error")
  );
}
