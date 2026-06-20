/**
 * Recent re-authentication gate for owner self-delete (password or OAuth refresh).
 */

import type { User } from "@supabase/supabase-js";
import { isGoogleAuthUiEnabled } from "./authFeatureFlags";
import { requestGoogleIdToken, requireGoogleOAuthClientId } from "./googleIdentity";
import { signInWithGoogleNative } from "./nativeGoogleAuth";
import { isNativeApp } from "./nativeApp";
import { supabase } from "./supabase";
import { TRUSTED_OAUTH_PROVIDERS } from "./emailVerification";

export const OWNER_DELETE_REAUTH_TTL_MS = 5 * 60 * 1000;
const REAUTH_STORAGE_KEY = "waka.ownerDelete.reauthAt";

export type OwnerDeleteReauthResult =
  | { ok: true }
  | { ok: false; message: string; code?: "invalid_password" | "oauth_failed" | "reauth_required" };

function readStoredReauthAt(): number | null {
  try {
    const raw = sessionStorage.getItem(REAUTH_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markOwnerDeleteReauthComplete(): void {
  try {
    sessionStorage.setItem(REAUTH_STORAGE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearOwnerDeleteReauth(): void {
  try {
    sessionStorage.removeItem(REAUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a password or OAuth re-auth completed within the TTL window. */
export function hasRecentOwnerDeleteReauth(nowMs: number = Date.now()): boolean {
  const at = readStoredReauthAt();
  if (at == null) return false;
  return nowMs - at <= OWNER_DELETE_REAUTH_TTL_MS;
}

/** Session last_sign_in_at within TTL (server-side signal after signInWithPassword). */
export function sessionHasRecentSignIn(user: User | null | undefined, nowMs: number = Date.now()): boolean {
  if (!user?.last_sign_in_at) return false;
  const at = new Date(user.last_sign_in_at).getTime();
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= OWNER_DELETE_REAUTH_TTL_MS;
}

export function userRequiresPasswordReauth(user: User | null | undefined): boolean {
  if (!user) return true;
  const identities = user.identities ?? [];
  if (identities.some((i) => i.provider === "email")) return true;
  return !identities.some((i) => TRUSTED_OAUTH_PROVIDERS.has(String(i.provider).toLowerCase()));
}

export function userSupportsOAuthReauth(user: User | null | undefined): boolean {
  if (!user) return false;
  const identities = user.identities ?? [];
  return identities.some((i) => TRUSTED_OAUTH_PROVIDERS.has(String(i.provider).toLowerCase()));
}

export async function reauthenticateOwnerWithPassword(
  email: string,
  password: string,
): Promise<OwnerDeleteReauthResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured.", code: "reauth_required" };
  const trimmed = email.trim();
  if (!trimmed || !password) {
    return { ok: false, message: "Enter your password to confirm deletion.", code: "reauth_required" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (error) {
    return {
      ok: false,
      message: error.message || "Password verification failed.",
      code: "invalid_password",
    };
  }

  markOwnerDeleteReauthComplete();
  return { ok: true };
}

export async function reauthenticateOwnerWithGoogle(): Promise<OwnerDeleteReauthResult> {
  if (!supabase) return { ok: false, message: "Supabase is not configured.", code: "reauth_required" };
  if (!isGoogleAuthUiEnabled()) {
    return { ok: false, message: "Google sign-in is not available.", code: "oauth_failed" };
  }

  try {
    if (isNativeApp()) {
      await signInWithGoogleNative();
    } else {
      const googleClientId = requireGoogleOAuthClientId();
      const idToken = await requestGoogleIdToken(googleClientId);
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
      });
      if (error) throw error;
    }
    markOwnerDeleteReauthComplete();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message ?? "Google verification failed.",
      code: "oauth_failed",
    };
  }
}

/** Fail closed unless local re-auth marker or fresh session sign-in is present. */
export function assertRecentOwnerDeleteReauth(user: User | null | undefined): OwnerDeleteReauthResult {
  if (hasRecentOwnerDeleteReauth() || sessionHasRecentSignIn(user)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "Confirm your identity with your password or Google account before deleting.",
    code: "reauth_required",
  };
}
