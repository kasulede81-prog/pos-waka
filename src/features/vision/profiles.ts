import type { BusinessType } from "../../types";
import { isHospitalityMode } from "../../lib/hospitality";
import { isPharmacyMode } from "../../lib/pharmacy";
import type { VisionCameraProfileId } from "./types";

export type VisionCameraProfileSuggestion = {
  id: VisionCameraProfileId;
  nameKey: string;
  locationHintKey: string;
};

const RETAIL_PROFILES: VisionCameraProfileSuggestion[] = [
  { id: "cashier", nameKey: "visionProfileCashier", locationHintKey: "visionProfileCashierHint" },
  { id: "entrance", nameKey: "visionProfileEntrance", locationHintKey: "visionProfileEntranceHint" },
  { id: "store", nameKey: "visionProfileStore", locationHintKey: "visionProfileStoreHint" },
  { id: "warehouse", nameKey: "visionProfileWarehouse", locationHintKey: "visionProfileWarehouseHint" },
];

const PHARMACY_PROFILES: VisionCameraProfileSuggestion[] = [
  { id: "counter", nameKey: "visionProfileCounter", locationHintKey: "visionProfileCounterHint" },
  { id: "dispensary", nameKey: "visionProfileDispensary", locationHintKey: "visionProfileDispensaryHint" },
  { id: "safe", nameKey: "visionProfileSafe", locationHintKey: "visionProfileSafeHint" },
  { id: "entrance", nameKey: "visionProfileEntrance", locationHintKey: "visionProfileEntranceHint" },
];

const RESTAURANT_PROFILES: VisionCameraProfileSuggestion[] = [
  { id: "kitchen", nameKey: "visionProfileKitchen", locationHintKey: "visionProfileKitchenHint" },
  { id: "bar", nameKey: "visionProfileBar", locationHintKey: "visionProfileBarHint" },
  { id: "dining", nameKey: "visionProfileDining", locationHintKey: "visionProfileDiningHint" },
  { id: "cashier", nameKey: "visionProfileCashier", locationHintKey: "visionProfileCashierHint" },
];

/** Suggest camera roles from shop business type (setup polish — no DB migration). */
export function suggestVisionCameraProfiles(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean | null,
  hospitalityModeEnabled?: boolean | null,
): VisionCameraProfileSuggestion[] {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return PHARMACY_PROFILES;
  if (isHospitalityMode(businessType, hospitalityModeEnabled)) return RESTAURANT_PROFILES;
  return RETAIL_PROFILES;
}
