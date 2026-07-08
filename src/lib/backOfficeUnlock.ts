import type { ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import { isShopSecurityPinConfigured } from "./enterpriseSecurity/shopPinSecret";
import { staffHasBackOfficeUnlockSecret } from "./staffSecret";
import {
  verifyBackOfficeShellCredential,
  verifyBackOfficeShellCredentialSync,
} from "./enterpriseSecurity/EnterpriseSecurityService";

export type BackOfficeUnlockVia = "staff_pin" | "shop_pin" | "open_no_pin";

export type BackOfficeUnlockSuccess = {
  ok: true;
  via: BackOfficeUnlockVia;
  role: import("../types").UserRole;
  actorUserId: string;
  actorLabel: string;
  staffId?: string;
};

export type BackOfficeUnlockFailure = {
  ok: false;
  via: "staff_pin" | "shop_pin";
};

export type BackOfficeUnlockResult = BackOfficeUnlockSuccess | BackOfficeUnlockFailure;

function mapShellResult(result: Awaited<ReturnType<typeof verifyBackOfficeShellCredential>>): BackOfficeUnlockResult {
  if (!result.ok) {
    return {
      ok: false,
      via: result.credentialAttempted === "shop_security_pin" ? "shop_pin" : "staff_pin",
    };
  }
  const via: BackOfficeUnlockVia =
    result.via === "staff_pin"
      ? "staff_pin"
      : result.via === "open_no_pin"
        ? "open_no_pin"
        : "shop_pin";
  return {
    ok: true,
    via,
    role: result.user.role,
    actorUserId: result.user.actorUserId,
    actorLabel: result.user.actorLabel,
    staffId: result.user.staffId,
  };
}

/** Whether Back Office requires a PIN modal before access. */
export function isBackOfficePinRequired(
  preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts">,
): boolean {
  if (isShopSecurityPinConfigured(preferences.backOfficePin)) return true;
  return (preferences.staffAccounts ?? []).some(staffHasBackOfficeUnlockSecret);
}

/** Resolve Back Office unlock — delegates to Enterprise Security Service (sync legacy path). */
export function resolveBackOfficeUnlock(
  pin: string,
  preferences: ShopPreferences,
  sessionActor: SessionActor | null,
): BackOfficeUnlockResult {
  return mapShellResult(verifyBackOfficeShellCredentialSync(pin, preferences, sessionActor));
}

/** Async unlock — supports Argon2 staff PINs and hashed shop PIN. */
export async function resolveBackOfficeUnlockAsync(
  pin: string,
  preferences: ShopPreferences,
  sessionActor: SessionActor | null,
  deviceId: string,
): Promise<BackOfficeUnlockResult> {
  return mapShellResult(await verifyBackOfficeShellCredential(pin, preferences, sessionActor, deviceId));
}
