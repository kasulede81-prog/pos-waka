import type { Session } from "@supabase/supabase-js";
import { authDevLog, formatAuthError, parseOAuthCallbackError } from "./authConfig";
import { supabase } from "./supabase";

export type AuthCallbackBootstrapStatus = "ready" | "invalid" | "expired";

export type AuthCallbackBootstrap = {
  status: AuthCallbackBootstrapStatus;
  session?: Session | null;
  message?: string;
};

const SIGNUP_OTP_TYPES = new Set(["signup", "email", "email_change", "invite", "magiclink"]);

function messageFromAuthError(err: { message?: string; code?: string }): AuthCallbackBootstrap {
  const code = (err.code ?? "").toLowerCase();
  const msg = (err.message ?? "").toLowerCase();
  if (
    code.includes("otp_expired") ||
    msg.includes("expired") ||
    msg.includes("invalid or has expired")
  ) {
    return {
      status: "expired",
      message: "This confirmation link has expired. Sign in and request a new verification email.",
    };
  }
  return {
    status: "invalid",
    message: formatAuthError(err),
  };
}

function hasAuthCallbackUrlHints(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("code") || params.get("token_hash") || params.get("type")) return true;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return false;
  const hashParams = new URLSearchParams(hash);
  return hashParams.has("access_token") || hashParams.has("code") || hashParams.has("type");
}

function logCallbackUrlShape(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  authDevLog("log", "auth callback URL shape", {
    searchKeys: [...params.keys()],
    hashKeys: [...hash.keys()],
    hasCode: params.has("code"),
    hasTokenHash: params.has("token_hash"),
    type: params.get("type"),
  });
}

async function waitForAuthSession(maxMs = 6000): Promise<Session | null> {
  if (!supabase) return null;
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    if (data.session) return data.session;
    await new Promise((r) => window.setTimeout(r, 200));
  }
  return null;
}

function stripAuthCallbackParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("code");
    u.searchParams.delete("type");
    u.searchParams.delete("token_hash");
    u.hash = "";
    window.history.replaceState({}, "", `${u.pathname}${u.search}`);
  } catch {
    /* ignore */
  }
}

async function sessionReadyIfPresent(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  stripAuthCallbackParamsFromUrl();
  authDevLog("log", "auth callback session already present");
  return data.session;
}

/**
 * Establish a Supabase session from OAuth / email confirmation return URLs.
 * Handles PKCE `code`, legacy hash tokens, and direct `token_hash` links.
 */
export async function bootstrapAuthCallbackSession(): Promise<AuthCallbackBootstrap> {
  if (!supabase) {
    return { status: "invalid", message: "Cloud sign-in is not configured." };
  }

  logCallbackUrlShape();

  const urlError = parseOAuthCallbackError();
  if (urlError) {
    const lower = urlError.toLowerCase();
    if (lower.includes("expired")) {
      return {
        status: "expired",
        message: "This confirmation link has expired. Sign in and request a new verification email.",
      };
    }
    return { status: "invalid", message: urlError };
  }

  // Let detectSessionInUrl finish before exchanging the same PKCE code twice.
  await new Promise((r) => window.setTimeout(r, 150));
  const existing = await sessionReadyIfPresent();
  if (existing) {
    return { status: "ready", session: existing };
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") ?? "";

  if (tokenHash && SIGNUP_OTP_TYPES.has(type)) {
    authDevLog("log", "auth callback: verifyOtp(token_hash)", { type });
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "email" | "email_change" | "invite" | "magiclink",
    });
    if (error) {
      const retry = await sessionReadyIfPresent();
      if (retry) return { status: "ready", session: retry };
      authDevLog("error", "verifyOtp callback failed", { code: error.code, message: error.message });
      return messageFromAuthError(error);
    }
    stripAuthCallbackParamsFromUrl();
    return { status: "ready", session: data.session ?? (await sessionReadyIfPresent()) };
  }

  if (code) {
    authDevLog("log", "auth callback: exchangeCodeForSession");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const retry = await sessionReadyIfPresent();
      if (retry) {
        authDevLog("log", "auth callback session ok after exchange error (detectSessionInUrl won race)");
        return { status: "ready", session: retry };
      }
      authDevLog("error", "exchangeCodeForSession failed", { code: error.code, message: error.message });
      return messageFromAuthError(error);
    }
    stripAuthCallbackParamsFromUrl();
    return { status: "ready", session: data.session ?? (await sessionReadyIfPresent()) };
  }

  if (hasAuthCallbackUrlHints()) {
    const session = await waitForAuthSession();
    if (session) {
      stripAuthCallbackParamsFromUrl();
      authDevLog("log", "auth callback session established via URL detect");
      return { status: "ready", session };
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) return messageFromAuthError(error);
  if (!data.session) {
    authDevLog("warn", "auth callback: no session and no redeemable URL params");
    return {
      status: "invalid",
      message: "Could not finish sign-in from this link. Try signing in from the login page.",
    };
  }

  return { status: "ready", session: data.session };
}
