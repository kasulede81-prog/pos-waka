import type { User } from "@supabase/supabase-js";

/** OAuth providers treated as verified without separate email confirmation. */
const TRUSTED_OAUTH_PROVIDERS = new Set(["google", "apple"]);

function hasTrustedOAuthProvider(user: User): boolean {
  const appMeta = user.app_metadata ?? {};
  const provider = String(appMeta.provider ?? "").toLowerCase();
  if (TRUSTED_OAUTH_PROVIDERS.has(provider)) return true;
  const providers = appMeta.providers;
  if (Array.isArray(providers) && providers.some((p) => TRUSTED_OAUTH_PROVIDERS.has(String(p).toLowerCase()))) {
    return true;
  }
  return (user.identities ?? []).some((i) => TRUSTED_OAUTH_PROVIDERS.has(String(i.provider).toLowerCase()));
}

/**
 * True when the Supabase user may use cloud-backed features (sync, bootstrap, cloud staff).
 * Google/Apple sign-in is allowed without a separate verification step.
 */
export function isSupabaseEmailVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.email_confirmed_at) return true;
  return hasTrustedOAuthProvider(user);
}

export function emailVerificationRequiredMessage(lang: "en" | "lg" | "sw" = "en"): string {
  if (lang === "lg") {
    return "Kakasa email yo okukakasa okukozesa obw'omukutu (sync, staff, ensimbi).";
  }
  if (lang === "sw") {
    return "Thibitisha barua pepe yako ili kutumia vipengele vya wingu.";
  }
  return "Confirm your email to use cloud features (sync, staff, subscriptions).";
}
