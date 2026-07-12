/**
 * Manager / owner PIN approvals for day close, variance, sync override, emergency, and reopen.
 */

import type { ShopPreferences, UserRole } from "../types";
import {
  resolveFloatVerifyOverride,
  resolveFloatVerifyOverrideAsync,
  type FloatVerifyOverrideSuccess,
} from "./managerFloatVerify";

export type DayCloseApprovalKind =
  | "variance"
  | "sync_override"
  | "reclose_override"
  | "emergency_close"
  | "reopen_day"
  | "sequential_day";

export type DayCloseApprovalResult =
  | { ok: true; auth: FloatVerifyOverrideSuccess; kind: DayCloseApprovalKind }
  | { ok: false; errorKey: "auth_forbidden" | "dayCloseApprovalPinRequired" | "dayCloseApprovalOwnerOnly" };

const MANAGER_KINDS = new Set<DayCloseApprovalKind>([
  "variance",
  "sync_override",
  "reclose_override",
  "emergency_close",
]);

function resolveDayCloseApprovalFromAuth(
  kind: DayCloseApprovalKind,
  auth: FloatVerifyOverrideSuccess | { ok: false },
): DayCloseApprovalResult {
  if (!auth.ok) return { ok: false, errorKey: "auth_forbidden" };

  if (kind === "reopen_day" || kind === "sequential_day") {
    if (auth.role !== "owner") return { ok: false, errorKey: "dayCloseApprovalOwnerOnly" };
    return { ok: true, auth, kind };
  }

  if (MANAGER_KINDS.has(kind)) {
    if (!["owner", "manager", "supervisor"].includes(auth.role)) {
      return { ok: false, errorKey: "auth_forbidden" };
    }
    return { ok: true, auth, kind };
  }

  return { ok: false, errorKey: "auth_forbidden" };
}

export function resolveDayCloseApproval(
  kind: DayCloseApprovalKind,
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): DayCloseApprovalResult {
  const normalized = pin.trim();
  if (!normalized) return { ok: false, errorKey: "dayCloseApprovalPinRequired" };

  const auth = resolveFloatVerifyOverride(normalized, preferences, sessionRole, sessionUserId, sessionLabel);
  return resolveDayCloseApprovalFromAuth(kind, auth);
}

/** Async approval — supports Argon2-hashed shop PIN and staff PINs. */
export async function resolveDayCloseApprovalAsync(
  kind: DayCloseApprovalKind,
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): Promise<DayCloseApprovalResult> {
  const normalized = pin.trim();
  if (!normalized) return { ok: false, errorKey: "dayCloseApprovalPinRequired" };

  const auth = await resolveFloatVerifyOverrideAsync(
    normalized,
    preferences,
    sessionRole,
    sessionUserId,
    sessionLabel,
  );
  return resolveDayCloseApprovalFromAuth(kind, auth);
}

export function dayCloseVarianceIsFlagged(
  expectedCashUgx: number,
  differenceUgx: number,
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">,
): boolean {
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;
  const exp = Math.max(1, expectedCashUgx);
  const absDiff = Math.abs(differenceUgx);
  return absDiff > Math.max((pct / 100) * exp, fixed);
}
