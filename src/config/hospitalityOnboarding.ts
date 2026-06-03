import type { BusinessType } from "../types";
import { BUSINESS_TYPE_IDS } from "./businessTypes";
import { isHospitalityBusinessType } from "../lib/hospitality";

/** Onboarding card id for the grouped hospitality & food service tile. */
export const HOSPITALITY_ONBOARDING_GROUP_ID = "hospitality_food_service";

export type HospitalityOnboardingStyleId =
  | "restaurant"
  | "cafe"
  | "bar"
  | "restaurant_bar"
  | "hotel";

export type HospitalityOnboardingStyle = {
  id: HospitalityOnboardingStyleId;
  businessType: BusinessType;
  labelKey: string;
  emoji: string;
};

/** Second-step options after the hospitality group card is chosen. */
export const HOSPITALITY_ONBOARDING_STYLES: HospitalityOnboardingStyle[] = [
  { id: "restaurant", businessType: "restaurant", labelKey: "onboardHospitalityStyle_restaurant", emoji: "🍽️" },
  { id: "cafe", businessType: "restaurant", labelKey: "onboardHospitalityStyle_cafe", emoji: "☕" },
  { id: "bar", businessType: "bar", labelKey: "onboardHospitalityStyle_bar", emoji: "🍺" },
  {
    id: "restaurant_bar",
    businessType: "restaurant_bar",
    labelKey: "onboardHospitalityStyle_restaurantBar",
    emoji: "🍸",
  },
  { id: "hotel", businessType: "hotel", labelKey: "onboardHospitalityStyle_hotel", emoji: "🏨" },
];

export function businessTypeForHospitalityStyle(styleId: HospitalityOnboardingStyleId): BusinessType {
  const row = HOSPITALITY_ONBOARDING_STYLES.find((s) => s.id === styleId);
  return row?.businessType ?? "restaurant";
}

/** Best-effort style for an existing hospitality shop (café stored as restaurant). */
export function hospitalityStyleIdForBusinessType(
  businessType: BusinessType | undefined | null,
): HospitalityOnboardingStyleId | null {
  if (!isHospitalityBusinessType(businessType)) return null;
  if (businessType === "bar") return "bar";
  if (businessType === "restaurant_bar") return "restaurant_bar";
  if (businessType === "hotel") return "hotel";
  if (businessType === "restaurant") return "restaurant";
  return null;
}

export function isHospitalityOnboardingGroupCard(cardId: string): boolean {
  return cardId === HOSPITALITY_ONBOARDING_GROUP_ID;
}

export const NON_HOSPITALITY_BUSINESS_TYPE_IDS = BUSINESS_TYPE_IDS.filter(
  (id) => !isHospitalityBusinessType(id),
);
