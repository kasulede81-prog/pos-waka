/**
 * Phase 13.2 — progressive brute-force protection for lock-screen PIN entry.
 * Tiers: 30s → 60s → 5min (no permanent lockout).
 */

export const UNLOCK_MAX_ATTEMPTS = 5;
export const UNLOCK_LOCKOUT_SECONDS = [30, 60, 300] as const;

const STORAGE_KEY = "waka.staff.unlock.limiter.v1";

type LimiterState = {
  failures: number;
  tierIndex: number;
  lockedUntil: string | null;
};

function readState(scopeKey: string): LimiterState {
  if (typeof window === "undefined") {
    return { failures: 0, tierIndex: 0, lockedUntil: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { failures: 0, tierIndex: 0, lockedUntil: null };
    const parsed = JSON.parse(raw) as Record<string, Partial<LimiterState>>;
    const row = parsed[scopeKey];
    if (!row) return { failures: 0, tierIndex: 0, lockedUntil: null };
    return {
      failures: typeof row.failures === "number" ? row.failures : 0,
      tierIndex: typeof row.tierIndex === "number" ? row.tierIndex : 0,
      lockedUntil: typeof row.lockedUntil === "string" ? row.lockedUntil : null,
    };
  } catch {
    return { failures: 0, tierIndex: 0, lockedUntil: null };
  }
}

function writeState(scopeKey: string, state: LimiterState): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, LimiterState>) : {};
    parsed[scopeKey] = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function unlockLimiterScope(staffId?: string | null): string {
  return staffId?.trim() ? `staff:${staffId}` : "device";
}

export function getUnlockLockoutStatus(scopeKey: string): {
  locked: boolean;
  lockedUntil: string | null;
  waitSeconds: number;
  failures: number;
} {
  const state = readState(scopeKey);
  if (!state.lockedUntil) {
    return { locked: false, lockedUntil: null, waitSeconds: 0, failures: state.failures };
  }
  const remainingMs = Date.parse(state.lockedUntil) - Date.now();
  if (remainingMs <= 0) {
    return { locked: false, lockedUntil: null, waitSeconds: 0, failures: state.failures };
  }
  return {
    locked: true,
    lockedUntil: state.lockedUntil,
    waitSeconds: Math.ceil(remainingMs / 1000),
    failures: state.failures,
  };
}

export function recordUnlockFailure(scopeKey: string, maxAttempts = UNLOCK_MAX_ATTEMPTS): {
  lockedUntil: string | null;
  waitSeconds: number;
  tierIndex: number;
  failures: number;
} {
  const state = readState(scopeKey);
  const failures = state.failures + 1;
  if (failures < maxAttempts) {
    writeState(scopeKey, { ...state, failures });
    return { lockedUntil: null, waitSeconds: 0, tierIndex: state.tierIndex, failures };
  }

  const tierIndex = Math.min(state.tierIndex, UNLOCK_LOCKOUT_SECONDS.length - 1);
  const waitSeconds = UNLOCK_LOCKOUT_SECONDS[tierIndex] ?? 300;
  const lockedUntil = new Date(Date.now() + waitSeconds * 1000).toISOString();
  writeState(scopeKey, {
    failures: 0,
    tierIndex: Math.min(tierIndex + 1, UNLOCK_LOCKOUT_SECONDS.length - 1),
    lockedUntil,
  });
  return { lockedUntil, waitSeconds, tierIndex, failures };
}

export function clearUnlockFailures(scopeKey: string): void {
  writeState(scopeKey, { failures: 0, tierIndex: 0, lockedUntil: null });
}

/** Clears all lock-screen unlock limiter state (staff credential recovery). */
export function clearStaffUnlockLimiter(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
