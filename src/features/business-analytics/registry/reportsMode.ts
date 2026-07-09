import type { BusinessType } from "../../../types";
import { isHospitalityMode } from "../../../lib/hospitality";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { isWholesaleMode } from "../../../lib/wholesale";
import type { ReportsBusinessMode } from "./reportWidgetTypes";

export function resolveReportsMode(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean,
): ReportsBusinessMode {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return "pharmacy";
  if (isHospitalityMode(businessType)) return "hospitality";
  if (isWholesaleMode(businessType)) return "wholesale";
  return "retail";
}

export function reportsModeMatches(
  mode: ReportsBusinessMode,
  businessTypes: readonly ReportsBusinessMode[] | "*",
): boolean {
  return businessTypes === "*" || businessTypes.includes(mode);
}
