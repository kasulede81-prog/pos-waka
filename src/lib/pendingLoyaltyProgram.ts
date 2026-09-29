/**
 * Pending WPL context across an authentication round trip (Phase 2C).
 *
 * The problem: a customer opens `/j/WPL2026001`, taps "Continue with Google", and leaves the page
 * for Google's account chooser. When the browser comes back to `loyalty.waka.ug/auth/callback`
 * there is no URL left that says which merchant they were looking at. This stores it.
 *
 * WHAT IS STORED: the public program code, and nothing else. Exactly one string, normalised to
 * upper case, and re-validated against the published format on read.
 *
 * WHAT IS NEVER STORED — and this is the whole security property:
 *   shop_id, account_id, organization_id, member_id, or any other identifier.
 *
 * The code is a PUBLIC MERCHANT IDENTIFIER. It is not a password, an OTP, a Google verification
 * code, or a credential of any kind. Holding it grants nothing; it only tells the app which page to
 * navigate back to. Every entitlement decision — is the program enabled, is the shop entitled, is
 * this person a member, may they join — is re-resolved server-side from the code on arrival, and
 * the member identity comes from `auth.uid()`, never from here.
 *
 * This mirrors `pendingReferral.ts`, which has carried the merchant referral code through the same
 * OAuth journey for a long time. Per host, because a POS session must never pick up a Loyalty join.
 */

import { PROGRAM_CODE_RE, normalizeProgramCode } from "./loyalty/loyaltyPublicProgram";

export const PENDING_PROGRAM_KEY = "waka-pending-loyalty-program";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // localStorage survives the OAuth round trip on mobile browsers that discard sessionStorage
    // when the tab is backgrounded for the account chooser.
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Store the code before leaving for Google. Anything that is not a valid code is ignored. */
export function storePendingProgramCode(code: string): void {
  const normalized = normalizeProgramCode(code);
  if (!PROGRAM_CODE_RE.test(normalized)) return;
  for (const s of [sessionStore(), storage()]) {
    try {
      s?.setItem(PENDING_PROGRAM_KEY, normalized);
    } catch {
      /* storage unavailable — the flow still works, the customer just returns to /member */
    }
  }
}

/**
 * Read the code. Re-validates the format rather than trusting what was written, so a value
 * tampered with in storage cannot reach navigation.
 */
export function readPendingProgramCode(): string | null {
  for (const s of [sessionStore(), storage()]) {
    try {
      const raw = s?.getItem(PENDING_PROGRAM_KEY)?.trim() ?? "";
      if (!raw) continue;
      const normalized = normalizeProgramCode(raw);
      if (PROGRAM_CODE_RE.test(normalized)) return normalized;
      // Present but malformed: drop it rather than leaving it to be re-read forever.
      s?.removeItem(PENDING_PROGRAM_KEY);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Consume it. One shot — a restore must not survive to influence a later sign-in. */
export function clearPendingProgramCode(): void {
  for (const s of [sessionStore(), storage()]) {
    try {
      s?.removeItem(PENDING_PROGRAM_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Where the callback should send the customer back to, or null when there is no pending join. */
export function consumePendingProgramPath(): string | null {
  const code = readPendingProgramCode();
  clearPendingProgramCode();
  return code ? `/j/${encodeURIComponent(code)}` : null;
}
