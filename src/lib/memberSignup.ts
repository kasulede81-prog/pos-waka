/**
 * Public WAKA Loyalty member signup (Phase 2B).
 *
 * The member counterpart to the merchant `signUp` in `useAuth.ts`, and deliberately a separate
 * function rather than a mode of it. The merchant path writes `pos_role`/`business_name`/
 * `organization_name` and then calls `ensureWorkspaceForSession`, which provisions an organization,
 * shop, trial subscription and owner membership. A member must never reach any of that, so the
 * safest shape is a path that CANNOT express merchant intent: this function writes exactly one
 * metadata key and never touches workspace bootstrap.
 *
 * WHAT MAKES THIS SAFE, precisely:
 *
 *   `waka_account_identity()` classifies a user as `member` only when member intent AND a
 *   `loyalty_members` row are BOTH present. A fresh signup has the intent and no row, so it
 *   classifies as `unknown` — and every bootstrap path in the codebase treats `unknown` as
 *   "provision nothing". That is why this signup cannot produce a tenancy even though it runs the
 *   same `onAuthStateChange` -> `ensureWorkspaceForSession` machinery every other session does.
 *   The refusal is the default, not something this file arranges.
 *
 * Conventions reused verbatim from the merchant signup, so the two do not drift:
 * `getAuthEmailCallbackUrl()` for the redirect, the one retry on Supabase's
 * "database error saving new user", the already-registered -> sign-in-with-password recovery, and
 * `formatAuthError()` for anything shown to the user. Rate limiting is Supabase's own auth
 * throttling — this adds no endpoint and no second limiter.
 */

import { getAuthEmailCallbackUrl } from "./authConfig";
import { hasSupabaseConfig, supabase } from "./supabase";

export type MemberSignUpResult =
  | { ok: true; needsEmailVerification: boolean }
  | { ok: false; error: string };

const PASSWORD_MIN = 8;

/** Mirrors the merchant form's rule so both surfaces reject the same addresses. */
function looksLikeEmail(value: string): boolean {
  return value.includes("@") && value.includes(".");
}

/**
 * Guard against a double submit racing itself into two signups. Mirrors `signUpLockRef` in
 * `useAuth`; module-level because this module is not a hook.
 */
let signUpInFlight = false;

export async function signUpLoyaltyMember(input: {
  email: string;
  password: string;
}): Promise<MemberSignUpResult> {
  if (!hasSupabaseConfig || !supabase) {
    return { ok: false, error: "Signing up is unavailable right now. Please try again later." };
  }
  if (signUpInFlight) {
    return { ok: false, error: "Registration is already in progress. Please wait a moment." };
  }

  const email = input.email.trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.password.length < PASSWORD_MIN) {
    return { ok: false, error: `Use at least ${PASSWORD_MIN} characters for your password.` };
  }

  // The ONLY metadata written. No pos_role, no business_name, no organization_name, no shop
  // identifiers, no onboarding flags — nothing a bootstrap path could read as merchant intent.
  const data: Record<string, unknown> = { account_kind: "member" };
  const emailRedirectTo = getAuthEmailCallbackUrl();

  signUpInFlight = true;
  try {
    let { data: result, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: { emailRedirectTo, data },
    });

    // Same retry the merchant signup performs, for the same transient Supabase failure.
    if ((error?.message ?? "").toLowerCase().includes("database error saving new user")) {
      ({ data: result, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: { emailRedirectTo, data },
      }));
    }

    // An address that already has an account is not an error the member must resolve with a
    // developer — try the password they just typed, exactly as the merchant signup does.
    if (error && /already registered|already exists|user already/i.test(error.message ?? "")) {
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: input.password,
      });
      if (signInErr) {
        return {
          ok: false,
          error: "That email already has a WAKA account. Sign in instead, or use another email.",
        };
      }
      return { ok: true, needsEmailVerification: !signInData.session };
    }

    if (error) {
      return { ok: false, error: formatSignUpError(error.message) };
    }

    return { ok: true, needsEmailVerification: !result.session };
  } catch {
    return { ok: false, error: "Something went wrong creating your account. Please try again." };
  } finally {
    signUpInFlight = false;
  }
}

/**
 * Supabase returns raw auth errors. Surface the ones a member can act on and keep infrastructure
 * detail out of the UI.
 */
function formatSignUpError(message: string): string {
  const lower = (message ?? "").toLowerCase();
  if (lower.includes("database error saving new user")) {
    return "We could not finish creating your account. Please try again.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (lower.includes("password")) {
    return `Use at least ${PASSWORD_MIN} characters for your password.`;
  }
  if (lower.includes("email") && (lower.includes("valid") || lower.includes("invalid"))) {
    return "Enter a valid email address.";
  }
  return "We could not create your account. Please try again.";
}
