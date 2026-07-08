/**
 * Manager / supervisor PIN verification — delegates to Enterprise Security Service.
 */

import type { ShopPreferences, UserRole } from "../types";
import {
  verifyFloatVerifyOverrideSync,
} from "./enterpriseSecurity/EnterpriseSecurityService";
import type { EnterpriseSecurityResult } from "./enterpriseSecurity/types";

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

function mapOverrideResult(result: EnterpriseSecurityResult): FloatVerifyOverrideResult {
  if (!result.ok) return { ok: false };
  const via: FloatVerifyOverrideVia =
    result.via === "role_session"
      ? "role_session"
      : result.via === "shop_pin"
        ? "shop_pin"
        : "staff_pin";
  return {
    ok: true,
    via,
    role: result.user.role,
    actorUserId: result.user.actorUserId,
    actorLabel: result.user.actorLabel,
    staffId: result.user.staffId,
  };
}

/** Resolve manager override PIN — Enterprise Security Service (sync legacy path). */
export function resolveFloatVerifyOverride(
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): FloatVerifyOverrideResult {
  return mapOverrideResult(
    verifyFloatVerifyOverrideSync(pin, preferences, sessionRole, sessionUserId, sessionLabel),
  );
}

/** Async override — supports Argon2 staff PINs and hashed shop PIN. */
export async function resolveFloatVerifyOverrideAsync(
  pin: string,
  preferences: ShopPreferences,
  sessionRole: UserRole,
  sessionUserId: string,
  sessionLabel: string,
): Promise<FloatVerifyOverrideResult> {
  const { verifyFloatVerifyOverride } = await import("./enterpriseSecurity/EnterpriseSecurityService");
  return mapOverrideResult(
    await verifyFloatVerifyOverride(pin, preferences, sessionRole, sessionUserId, sessionLabel),
  );
}
