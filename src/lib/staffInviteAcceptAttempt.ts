/**
 * Single-flight controller for staff invite acceptance.
 *
 * Distinguishes true unmount from dependency rerenders:
 * - only markUnmounted() blocks immediate UI apply
 * - setPhase("accepting") / effect rerenders must NOT cancel an in-flight attempt
 * - Strict Mode remount applies a deferred terminal result (no duplicate RPC)
 */

export type StaffInviteAcceptAttemptController = {
  /** Start an attempt; null if already in flight or settled for this token. */
  tryBegin(token: string): number | null;
  /**
   * Apply terminal UI for this attempt.
   * If temporarily unmounted (Strict Mode), defers apply until noteMounted().
   * Returns true when apply ran immediately.
   */
  complete(attemptId: number, apply: () => void): boolean;
  /** True unmount — do not apply React state after this (unless remounted). */
  markUnmounted(): void;
  /** Remount / Strict Mode remount — flush deferred terminal apply if any. */
  noteMounted(): void;
  /** Record that this token reached a terminal UI state (success or error). */
  markSettled(token: string): void;
  clearSettled(): void;
  isInFlight(): boolean;
  settledToken(): string | null;
};

export function createStaffInviteAcceptAttemptController(): StaffInviteAcceptAttemptController {
  let mounted = true;
  let inFlightId: number | null = null;
  let nextId = 1;
  let settled: string | null = null;
  let deferred: { attemptId: number; apply: () => void } | null = null;

  return {
    tryBegin(token: string) {
      const trimmed = token.trim();
      if (!trimmed || !mounted) return null;
      if (settled === trimmed) return null;
      if (inFlightId != null || deferred != null) return null;
      inFlightId = nextId++;
      return inFlightId;
    },
    complete(attemptId: number, apply: () => void) {
      if (inFlightId !== attemptId) return false;
      inFlightId = null;
      if (mounted) {
        apply();
        return true;
      }
      deferred = { attemptId, apply };
      return false;
    },
    markUnmounted() {
      mounted = false;
    },
    noteMounted() {
      mounted = true;
      if (deferred) {
        const pending = deferred;
        deferred = null;
        pending.apply();
      }
    },
    markSettled(token: string) {
      settled = token.trim() || null;
    },
    clearSettled() {
      settled = null;
    },
    isInFlight() {
      return inFlightId != null || deferred != null;
    },
    settledToken() {
      return settled;
    },
  };
}

export function shouldStartStaffInviteAccept(input: {
  initializing: boolean;
  isAuthenticated: boolean;
  token: string;
  inFlight: boolean;
  settledToken: string | null;
}): boolean {
  if (input.initializing || !input.isAuthenticated) return false;
  const token = input.token.trim();
  if (!token) return false;
  if (input.inFlight) return false;
  if (input.settledToken === token) return false;
  return true;
}

/** True when the explicit accept page owns the invitation (bootstrap must not consume). */
export function isStaffAcceptPagePath(pathname: string | null | undefined): boolean {
  const path = (pathname ?? "").split("?")[0] || "";
  return path === "/staff/accept";
}
