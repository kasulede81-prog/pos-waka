/**
 * Manager / supervisor PIN verification for opening-float overrides.
 */

import type { ShopPreferences, UserRole } from "../types";
import { staffHasBackOfficeUnlockSecret, staffSecretMatches } from "./staffSecret";

export type FloatVerifyOverrideVia = "staff_pin" | "shop_pin" | "role_session";

export type FloatVerifyOverrideSuccess = {
  ok: true;
  via: FloatVerifyOverrideVia;
  role: UserRole;
  actorUserId: string;
  actorLabel: string;
  staffId?: string;
};

export type FloatVerifyOverrideFailure = {
  ok: false;
};

export type FloatVerifyOverrideResult = FloatVerifyOverrideSuccess | FloatVerifyOverrideFailure;

const OVERRIDE_ROLES = new Set<UserRole>(["owner", "manager", "supervisor"]);

export function canVerifyOpeningFloat(role: UserRole): boolean {
  return OVERRIDE_ROLES.has(role);
}

/** Resolve manager override PIN — owner/manager/supervisor staff PIN or shop PIN. */
export function resolveFloatVerifyOverride(
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): FloatVerifyOverrideResult {
  const normalized = pin.trim();
  const staff = preferences.staffAccounts ?? [];
  const matched = staff.find(
    (s) =>
      s.active &&
      OVERRIDE_ROLES.has(s.role) &&
      staffHasBackOfficeUnlockSecret(s) &&
      staffSecretMatches(s, normalized),
  );

  if (matched) {
    return {
      ok: true,
      via: "staff_pin",
      role: matched.role,
      actorUserId: `staff:${matched.id}`,
      actorLabel: matched.name,
      staffId: matched.id,
    };
  }

  const stored = preferences.backOfficePin?.trim() ?? "";
  if (stored && normalized.replace(/\D/g, "") === stored.replace(/\D/g, "")) {
    if (canVerifyOpeningFloat(sessionRole)) {
      return {
        ok: true,
        via: "shop_pin",
        role: sessionRole,
        actorUserId: sessionUserId,
        actorLabel: sessionLabel,
      };
    }
    return {
      ok: true,
      via: "shop_pin",
      role: "owner",
      actorUserId: sessionUserId,
      actorLabel: sessionLabel,
    };
  }

  if (!stored && staff.length === 0 && canVerifyOpeningFloat(sessionRole)) {
    return {
      ok: true,
      via: "role_session",
      role: sessionRole,
      actorUserId: sessionUserId,
      actorLabel: sessionLabel,
    };
  }

  return { ok: false };
}
