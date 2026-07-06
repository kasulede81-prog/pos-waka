import type { ShopPreferences, UserRole } from "../types";
import { isHospitalityMode } from "./hospitality";
import { isPharmacyMode } from "./pharmacy";
import { PHARMACY_HOME_ROUTE } from "./pharmacyNav";
import { hasPermission } from "./permissions";

/** Default landing route for the signed-in terminal (business-type aware). */
export function resolveTerminalHomePath(
  prefs: Pick<ShopPreferences, "businessType" | "hospitalityModeEnabled" | "pharmacyModeEnabled">,
  role: UserRole,
): string {
  if (isHospitalityMode(prefs.businessType, prefs.hospitalityModeEnabled) && hasPermission(role, "hospitality.floor")) {
    return "/floor";
  }
  if (isPharmacyMode(prefs.businessType, prefs.pharmacyModeEnabled)) {
    return PHARMACY_HOME_ROUTE;
  }
  return "/";
}
