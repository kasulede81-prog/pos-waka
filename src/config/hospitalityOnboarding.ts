import type { BusinessType, HospitalityOperatingStyle } from "../types";
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
  /**
   * Operating configuration stored alongside businessType "hospitality".
   * UI emphasis only — never a separate engine. Omitted for hotel, which
   * remains its own business type.
   */
  style?: HospitalityOperatingStyle;
  labelKey: string;
  emoji: string;
};

/**
 * Second-step options after the hospitality group card is chosen.
 * Restaurant / Bar / Restaurant + Bar are operating configurations of the ONE
 * Hospitality business type — all store businessType "hospitality".
 */
export const HOSPITALITY_ONBOARDING_STYLES: HospitalityOnboardingStyle[] = [
  { id: "restaurant", businessType: "hospitality", style: "restaurant", labelKey: "onboardHospitalityStyle_restaurant", emoji: "🍽️" },
  { id: "cafe", businessType: "hospitality", style: "restaurant", labelKey: "onboardHospitalityStyle_cafe", emoji: "☕" },
  { id: "bar", businessType: "hospitality", style: "bar", labelKey: "onboardHospitalityStyle_bar", emoji: "🍺" },
  {
    id: "restaurant_bar",
    businessType: "hospitality",
    style: "restaurant_bar",
    labelKey: "onboardHospitalityStyle_restaurantBar",
    emoji: "🍸",
  },
  { id: "hotel", businessType: "hotel", labelKey: "onboardHospitalityStyle_hotel", emoji: "🏨" },
];

/** All styles store ONE business type — the whole point of the consolidation. */
export function businessTypeForHospitalityStyle(styleId: HospitalityOnboardingStyleId): BusinessType {
  const row = HOSPITALITY_ONBOARDING_STYLES.find((s) => s.id === styleId);
  return row?.businessType ?? "hospitality";
}

/** Operating configuration for a style id (null for hotel). */
export function hospitalityStyleForStyleId(
  styleId: HospitalityOnboardingStyleId,
): HospitalityOperatingStyle | null {
  return HOSPITALITY_ONBOARDING_STYLES.find((s) => s.id === styleId)?.style ?? null;
}

/**
 * Best-effort style id for an existing shop. New "hospitality" shops use their
 * stored operating configuration; legacy restaurant / bar / restaurant_bar
 * shops derive it from the stored business type (café was stored as restaurant).
 */
export function hospitalityStyleIdForBusinessType(
  businessType: BusinessType | undefined | null,
  style?: HospitalityOperatingStyle | null,
): HospitalityOnboardingStyleId | null {
  if (!isHospitalityBusinessType(businessType)) return null;
  if (businessType === "hospitality") {
    if (style === "bar") return "bar";
    if (style === "restaurant_bar") return "restaurant_bar";
    return "restaurant";
  }
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
