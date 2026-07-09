import type { Permission, ShopPreferences, UserRole } from "../types";
import { isHospitalityMode } from "./hospitality";
import { hasActorPermission } from "./permissions";

/** Default landing route for the signed-in terminal (business-type aware). */
export function resolveTerminalHomePath(
  prefs: Pick<ShopPreferences, "businessType" | "hospitalityModeEnabled" | "pharmacyModeEnabled">,
  role: UserRole,
  actorPermissions?: Permission[] | null,
): string {
  if (
    isHospitalityMode(prefs.businessType, prefs.hospitalityModeEnabled) &&
    hasActorPermission(role, "hospitality.floor", actorPermissions)
  ) {
    return "/floor";
  }
  return "/";
}
