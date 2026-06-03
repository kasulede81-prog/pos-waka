import type { BusinessType, SellingMode, ShopSellingStyle } from "../types";
import { HOSPITALITY_ONBOARDING_GROUP_ID } from "./hospitalityOnboarding";

export type OnboardingBusinessCard = {
  id: string;
  labelKey: string;
  emoji: string;
  /** Set for direct shop types; omitted for the hospitality group card. */
  businessType?: BusinessType;
  /** User picks restaurant / bar / hotel style on the next step. */
  hospitalityGroup?: boolean;
};

/** Big touch cards shown in onboarding step 2 */
export const ONBOARDING_BUSINESS_CARDS: OnboardingBusinessCard[] = [
  { id: "retail", businessType: "kiosk_duka", labelKey: "onboardBiz_retail", emoji: "🏪" },
  { id: "boutique", businessType: "boutique", labelKey: "onboardBiz_boutique", emoji: "👗" },
  {
    id: HOSPITALITY_ONBOARDING_GROUP_ID,
    labelKey: "onboardBiz_hospitality",
    emoji: "🍽️",
    hospitalityGroup: true,
  },
  { id: "pharmacy", businessType: "pharmacy", labelKey: "onboardBiz_pharmacy", emoji: "💊" },
  { id: "hardware", businessType: "hardware", labelKey: "onboardBiz_hardware", emoji: "🔧" },
  { id: "electronics", businessType: "electronics", labelKey: "onboardBiz_electronics", emoji: "📱" },
  { id: "wholesale", businessType: "wholesale", labelKey: "onboardBiz_wholesale", emoji: "📦" },
];

export type OnboardingSellingStyleCard = {
  id: ShopSellingStyle;
  labelKey: string;
  hintKey: string;
  emoji: string;
};

export const ONBOARDING_SELLING_STYLES: OnboardingSellingStyleCard[] = [
  { id: "piece", labelKey: "onboardSell_piece", hintKey: "onboardSell_pieceHint", emoji: "🔢" },
  { id: "carton", labelKey: "onboardSell_carton", hintKey: "onboardSell_cartonHint", emoji: "📦" },
  { id: "sack", labelKey: "onboardSell_sack", hintKey: "onboardSell_sackHint", emoji: "🛍️" },
  { id: "mixed", labelKey: "onboardSell_mixed", hintKey: "onboardSell_mixedHint", emoji: "✨" },
];

export type FirstProductTemplate = {
  id: string;
  nameKey: string;
  inferName: string;
  defaultPriceUgx: number;
  defaultStock: number;
  sellingMode: SellingMode;
  baseUnit: string;
  /** When shop uses mixed selling, seed pack tracking on these items */
  preferPackWhenMixed?: boolean;
};

export const FIRST_PRODUCT_TEMPLATES: FirstProductTemplate[] = [
  { id: "sugar", nameKey: "starterItem_sugar", inferName: "sugar", defaultPriceUgx: 3500, defaultStock: 20, sellingMode: "weighted", baseUnit: "kg", preferPackWhenMixed: true },
  { id: "rice", nameKey: "starterItem_rice", inferName: "rice", defaultPriceUgx: 4500, defaultStock: 25, sellingMode: "weighted", baseUnit: "kg", preferPackWhenMixed: true },
  { id: "soda", nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 48, sellingMode: "unit", baseUnit: "ea", preferPackWhenMixed: true },
  { id: "beer", nameKey: "starterItem_beer", inferName: "beer", defaultPriceUgx: 2500, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", preferPackWhenMixed: true },
  { id: "water", nameKey: "starterItem_water", inferName: "water", defaultPriceUgx: 1000, defaultStock: 36, sellingMode: "unit", baseUnit: "ea" },
  { id: "bread", nameKey: "starterItem_bread", inferName: "bread", defaultPriceUgx: 2000, defaultStock: 30, sellingMode: "unit", baseUnit: "ea" },
];

export const ONBOARDING_STAFF_ROLES = ["cashier", "manager", "stock_keeper"] as const;
export type OnboardingStaffRole = (typeof ONBOARDING_STAFF_ROLES)[number];
