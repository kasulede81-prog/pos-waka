import type { BusinessType } from "../../../types";
import { isHospitalityMode } from "../../../lib/hospitality";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { isWholesaleMode } from "../../../lib/wholesale";
import type { InvestigationBusinessMode } from "./investigationWidgetTypes";

export function resolveInvestigationMode(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean,
): InvestigationBusinessMode {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return "pharmacy";
  if (isHospitalityMode(businessType)) return "hospitality";
  if (isWholesaleMode(businessType)) return "wholesale";
  return "retail";
}

export function investigationModeMatches(
  mode: InvestigationBusinessMode,
  businessTypes: readonly InvestigationBusinessMode[] | "*",
): boolean {
  return businessTypes === "*" || businessTypes.includes(mode);
}
