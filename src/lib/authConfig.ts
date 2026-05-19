/**
 * Canonical auth redirect configuration for Waka POS (Supabase + Google OAuth).
 * Production must always return https://waka-ug.com — never localhost or supabase.co as the app redirect base.
 */

import { WAKA_SITE_URL } from "../config/company";

/** Production site — must match Supabase Auth Site URL and Google OAuth branding domain (with custom auth domain). */
export const CANONICAL_APP_URL = WAKA_SITE_URL.replace(/\/$/, "");

const AUTH_CALLBACK_PATH = "/auth/callback";
const AUTH_RECOVERY_PATH = "/auth/recovery";

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts that must never be used as the post-auth redirect base in production builds. */
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

/**
 * Origin used for emailRedirectTo, redirectTo, and OAuth return URLs.
 * Production: VITE_APP_URL → canonical https://waka-ug.com (never window.origin fallback).
 */
export function authRedirectOrigin(): string {
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

/** Supabase project ref from VITE_SUPABASE_URL (for dashboard / Google redirect URI docs). */
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

export function getSupabaseOAuthCallbackUrl(): string | null {
  const ref = getSupabaseProjectRef();
  if (!ref) return null;
  return `https://${ref}.supabase.co/auth/v1/callback`;
}

/** Google Cloud → Authorized redirect URI (required for Supabase Google provider). */
export function getGoogleOAuthRedirectUris(): string[] {
  const supabaseCb = getSupabaseOAuthCallbackUrl();
  return supabaseCb ? [supabaseCb] : [];
}

/** Google Cloud → Authorized JavaScript origins. */
export function getGoogleOAuthJavaScriptOrigins(): string[] {
  const origins = new Set<string>([CANONICAL_APP_URL]);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (supabaseUrl) origins.add(supabaseUrl);
  if (import.meta.env.DEV) {
    origins.add("http://localhost:5173");
  }
  return [...origins];
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
