import { authDevLog, formatAuthError, parseOAuthCallbackError } from "./authConfig";
import { supabase } from "./supabase";

export type PasswordRecoveryBootstrapStatus = "loading" | "ready" | "invalid" | "expired";

export type PasswordRecoveryBootstrap = {
  status: PasswordRecoveryBootstrapStatus;
  message?: string;
};

function recoveryMessageFromAuthError(err: { message?: string; code?: string }): PasswordRecoveryBootstrap {
  const code = (err.code ?? "").toLowerCase();
  const msg = (err.message ?? "").toLowerCase();
  if (
    code.includes("otp_expired") ||
    msg.includes("expired") ||
    msg.includes("invalid or has expired")
  ) {
    return {
      status: "expired",
      message: "This reset link has expired. Request a new link from the sign-in page.",
    };
  }
  if (
    code.includes("otp_disabled") ||
    msg.includes("already been used") ||
    msg.includes("invalid") ||
    msg.includes("not found")
  ) {
    return {
      status: "invalid",
      message: "This reset link is invalid or was already used. Request a new link.",
    };
  }
  return { status: "invalid", message: formatAuthError(err) };
}

function hasRecoveryUrlHints(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("code") || params.get("token_hash") || params.get("type") === "recovery") return true;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return false;
  const hashParams = new URLSearchParams(hash);
  return (
    hashParams.has("access_token") ||
    hashParams.has("code") ||
    hashParams.get("type") === "recovery"
  );
}

/** DEV-only: log URL shape without token values (safe diagnostics). */
function logRecoveryUrlShape(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  authDevLog("log", "recovery URL shape", {
    searchKeys: [...params.keys()],
    hashKeys: [...hash.keys()],
    hasCode: params.has("code"),
    hasTokenHash: params.has("token_hash"),
    type: params.get("type"),
  });
}

async function waitForRecoverySession(maxMs = 4500): Promise<boolean> {
  if (!supabase) return false;
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const { data, error } = await supabase.auth.getSession();
    if (error) return false;
    if (data.session) return true;
    await new Promise((r) => window.setTimeout(r, 200));
  }
  return false;
}

function stripRecoveryParamsFromUrl(): void {
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

async function sessionReadyIfPresent(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return false;
  stripRecoveryParamsFromUrl();
  authDevLog("log", "recovery session already present");
  return true;
}

/**
 * Establish a Supabase recovery session from the email link (PKCE code or legacy hash).
 * Never log passwords or tokens.
 */
export async function bootstrapPasswordRecoverySession(): Promise<PasswordRecoveryBootstrap> {
  if (!supabase) {
    return { status: "invalid", message: "Cloud sign-in is not configured." };
  }

  logRecoveryUrlShape();

  const urlError = parseOAuthCallbackError();
  if (urlError) {
    const lower = urlError.toLowerCase();
    if (lower.includes("expired")) return { status: "expired", message: "This reset link has expired. Request a new link." };
    return { status: "invalid", message: "This reset link is invalid. Request a new link." };
  }

  // Let detectSessionInUrl finish (PKCE / hash) before we exchange the same code again.
  await new Promise((r) => window.setTimeout(r, 150));
  if (await sessionReadyIfPresent()) {
    return { status: "ready" };
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (tokenHash && type === "recovery") {
    authDevLog("log", "recovery bootstrap: verifyOtp(token_hash)");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error) {
      if (await sessionReadyIfPresent()) return { status: "ready" };
      authDevLog("error", "verifyOtp recovery failed", { code: error.code, message: error.message });
      return recoveryMessageFromAuthError(error);
    }
    stripRecoveryParamsFromUrl();
    authDevLog("log", "recovery session established via verifyOtp");
    return { status: "ready" };
  }

  if (code) {
    authDevLog("log", "recovery bootstrap: exchangeCodeForSession");
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      if (await sessionReadyIfPresent()) {
        authDevLog("log", "recovery session ok after exchange error (detectSessionInUrl won race)");
        return { status: "ready" };
      }
      authDevLog("error", "exchangeCodeForSession failed", { code: error.code, message: error.message });
      return recoveryMessageFromAuthError(error);
    }
    stripRecoveryParamsFromUrl();
    authDevLog("log", "recovery session established via PKCE code");
    return { status: "ready" };
  }

  if (hasRecoveryUrlHints()) {
    const ready = await waitForRecoverySession();
    if (ready) {
      stripRecoveryParamsFromUrl();
      authDevLog("log", "recovery session established via URL detect");
      return { status: "ready" };
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) return recoveryMessageFromAuthError(error);
  if (!data.session) {
    authDevLog("warn", "recovery bootstrap: no session and no redeemable URL params");
    return {
      status: "invalid",
      message: "Open the reset link from your email, or request a new link below.",
    };
  }

  return { status: "ready" };
}
