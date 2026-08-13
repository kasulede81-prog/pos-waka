/**
 * Phase 39.3 — database verification must not require auth.users = 0.
 * Auth counts are applied only after auth.admin.deleteUser.
 */

export const AUTH_VERIFICATION_KEYS = ["owner_auth_account", "staff_auth_accounts"] as const;

export type HardDeleteCountMap = Record<string, number>;

export function isAuthVerificationKey(key: string): boolean {
  return (AUTH_VERIFICATION_KEYS as readonly string[]).includes(key);
}

export function databaseVerificationPassed(counts: HardDeleteCountMap | null | undefined): boolean {
  if (!counts) return false;
  return Object.entries(counts).every(([key, value]) => {
    if (isAuthVerificationKey(key)) return true;
    return Number(value) === 0;
  });
}

export function authVerificationPassed(counts: HardDeleteCountMap | null | undefined): boolean {
  return (
    Number(counts?.owner_auth_account ?? 0) === 0 && Number(counts?.staff_auth_accounts ?? 0) === 0
  );
}

export function mergeAuthVerification(
  dbCounts: HardDeleteCountMap,
  ownerRemaining: number,
  staffRemaining: number,
): { all_passed: boolean; counts: HardDeleteCountMap } {
  const counts = {
    ...dbCounts,
    owner_auth_account: Math.max(0, ownerRemaining),
    staff_auth_accounts: Math.max(0, staffRemaining),
  };
  const dbOk = databaseVerificationPassed(counts);
  const authOk = authVerificationPassed(counts);
  return { all_passed: dbOk && authOk, counts };
}
