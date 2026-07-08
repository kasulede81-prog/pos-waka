import type { ShopPreferences, UserRole } from "../types";
import { isHospitalityMode } from "./hospitality";
import { hasPermission } from "./permissions";

/** Default landing route for the signed-in terminal (business-type aware). */
export function resolveTerminalHomePath(
  prefs: Pick<ShopPreferences, "businessType" | "hospitalityModeEnabled" | "pharmacyModeEnabled">,
  role: UserRole,
): string {
  if (isHospitalityMode(prefs.businessType, prefs.hospitalityModeEnabled) && hasPermission(role, "hospitality.floor")) {
    return "/floor";
  }
  return "/";
}
