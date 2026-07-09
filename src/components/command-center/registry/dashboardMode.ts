import type { BusinessType } from "../../../types";
import { isHospitalityMode } from "../../../lib/hospitality";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { isWholesaleMode } from "../../../lib/wholesale";
import type { DashboardBusinessMode } from "./dashboardWidgetTypes";

export function resolveDashboardMode(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean,
): DashboardBusinessMode {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return "pharmacy";
  if (isHospitalityMode(businessType)) return "hospitality";
  if (isWholesaleMode(businessType)) return "wholesale";
  return "retail";
}

export function dashboardModeMatches(
  mode: DashboardBusinessMode,
  businessTypes: readonly DashboardBusinessMode[] | "*",
): boolean {
  return businessTypes === "*" || businessTypes.includes(mode);
}
