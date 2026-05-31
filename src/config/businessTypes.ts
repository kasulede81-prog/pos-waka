import type { BusinessType } from "../types";

/** Stored on shop / local preferences — drives labels, nav, and defaults */
export const BUSINESS_TYPE_IDS: readonly BusinessType[] = [
  "kiosk_duka",
  "boutique",
  "restaurant",
  "bar",
  "restaurant_bar",
  "pharmacy",
  "hardware",
  "electronics",
] as const;

export type DashboardVariant = "kiosk" | "retail" | "service" | "agent";

export type BusinessProfile = {
  /** i18n key suffix: businessType_kiosk_duka */
  id: BusinessType;
  dashboardVariant: DashboardVariant;
  /** Feature hints — UI reads these; not all are implemented yet */
  kioskQuickSellDefault: boolean;
  receiptsDefaultOff: boolean;
  showQuickPresetsDefault: boolean;
  showBarcodeIdeas: boolean;
  showCategoriesIdeas: boolean;
  emphasizeDebt: boolean;
  emphasizeFloat: boolean;
};

const profiles: Record<BusinessType, BusinessProfile> = {
  kiosk_duka: {
    id: "kiosk_duka",
    dashboardVariant: "kiosk",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  wholesale: {
    id: "wholesale",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: true,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  mini_supermarket: {
    id: "mini_supermarket",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: false,
    showQuickPresetsDefault: false,
    showBarcodeIdeas: true,
    showCategoriesIdeas: true,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  hardware: {
    id: "hardware",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  restaurant: {
    id: "restaurant",
    dashboardVariant: "service",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: true,
    emphasizeDebt: false,
    emphasizeFloat: false,
  },
  bar: {
    id: "bar",
    dashboardVariant: "service",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: true,
    emphasizeDebt: false,
    emphasizeFloat: false,
  },
  restaurant_bar: {
    id: "restaurant_bar",
    dashboardVariant: "service",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: true,
    emphasizeDebt: false,
    emphasizeFloat: false,
  },
  hotel: {
    id: "hotel",
    dashboardVariant: "service",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: false,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: true,
    emphasizeDebt: false,
    emphasizeFloat: false,
  },
  salon: {
    id: "salon",
    dashboardVariant: "service",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  pharmacy: {
    id: "pharmacy",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: false,
    showQuickPresetsDefault: false,
    showBarcodeIdeas: true,
    showCategoriesIdeas: true,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  boutique: {
    id: "boutique",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: false,
    showQuickPresetsDefault: false,
    showBarcodeIdeas: true,
    showCategoriesIdeas: true,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  electronics: {
    id: "electronics",
    dashboardVariant: "retail",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: false,
    showQuickPresetsDefault: false,
    showBarcodeIdeas: true,
    showCategoriesIdeas: true,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  produce_market: {
    id: "produce_market",
    dashboardVariant: "kiosk",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
  mobile_money_agent: {
    id: "mobile_money_agent",
    dashboardVariant: "agent",
    kioskQuickSellDefault: false,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: false,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: false,
    emphasizeFloat: true,
  },
  other: {
    id: "other",
    dashboardVariant: "kiosk",
    kioskQuickSellDefault: true,
    receiptsDefaultOff: true,
    showQuickPresetsDefault: true,
    showBarcodeIdeas: false,
    showCategoriesIdeas: false,
    emphasizeDebt: true,
    emphasizeFloat: false,
  },
};

export function getBusinessProfile(type: BusinessType | undefined | null): BusinessProfile {
  if (!type || !(type in profiles)) return profiles.kiosk_duka;
  return profiles[type];
}
