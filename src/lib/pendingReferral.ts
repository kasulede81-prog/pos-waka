import { normalizeReferralCode } from "./referralAgents";

export const PENDING_REFERRAL_KEY = "waka-pending-referral";

/** Persist referral across tabs, email-verify links, and OAuth redirects. */
export function storePendingReferralCode(code: string): void {
  const normalized = normalizeReferralCode(code);
  if (normalized.length < 3) return;
  try {
    sessionStorage.setItem(PENDING_REFERRAL_KEY, normalized);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(PENDING_REFERRAL_KEY, normalized);
  } catch {
    /* ignore */
  }
}

export function readPendingReferralCode(metaReferralCode?: string | null): string {
  const fromMeta = metaReferralCode?.trim() ?? "";
  if (fromMeta.length >= 3) return normalizeReferralCode(fromMeta);
  try {
    const fromSession = sessionStorage.getItem(PENDING_REFERRAL_KEY)?.trim() ?? "";
    if (fromSession.length >= 3) return normalizeReferralCode(fromSession);
  } catch {
    /* ignore */
  }
  try {
    const fromLocal = localStorage.getItem(PENDING_REFERRAL_KEY)?.trim() ?? "";
    if (fromLocal.length >= 3) return normalizeReferralCode(fromLocal);
  } catch {
    /* ignore */
  }
  return "";
}

export function hasPendingReferralCode(metaReferralCode?: string | null): boolean {
  return readPendingReferralCode(metaReferralCode).length >= 3;
}

export function clearPendingReferralCode(): void {
  try {
    sessionStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* ignore */
  }
}
