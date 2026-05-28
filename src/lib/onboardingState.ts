import type { ShopPreferences } from "../types";

/** Owner finished the post-signup wizard (or legacy onboarding). */
export function isShopOnboardingComplete(prefs: ShopPreferences): boolean {
  if (prefs.onboardingWizardDone === true) return true;
  return prefs.onboardingDone === true && (prefs.schemaVersion ?? 0) >= 2;
}
