import type { BusinessType, Language } from "../types";
import { isHospitalityMode } from "./hospitality";
import { t } from "./i18n";

/** Retail examples that must not appear in hospitality product UI (tests + audits). */
export const HOSPITALITY_FORBIDDEN_RETAIL_TERMS = [
  "coca cola",
  "coca-cola",
  "sugar",
  "soap",
  "groceries",
  "crate",
  "carton",
] as const;

export type HospitalityPlaceholderKey =
  | "simpleAddStep1Example"
  | "simpleAddStep2Hint"
  | "simpleAddShelfPlaceholder"
  | "quickAddStep2Ph"
  | "categoryCustomPlaceholder"
  | "categoryNewPlaceholder"
  | "quickAddTitle"
  | "quickAddSave"
  | "quickAddName"
  | "productNamePh";

type HospitalitySubtype = "bar" | "restaurant" | "restaurant_bar" | "hotel" | "default";

function hospitalitySubtype(businessType: BusinessType | undefined | null): HospitalitySubtype {
  if (businessType === "bar") return "bar";
  if (businessType === "restaurant") return "restaurant";
  if (businessType === "restaurant_bar") return "restaurant_bar";
  if (businessType === "hotel") return "hotel";
  return "default";
}

const PLACEHOLDER_BY_SUBTYPE: Record<HospitalitySubtype, Record<HospitalityPlaceholderKey, string>> = {
  bar: {
    simpleAddStep1Example: "hospitalityBar_placeholder_nameExample",
    simpleAddStep2Hint: "hospitalityBar_placeholder_categoryHint",
    simpleAddShelfPlaceholder: "hospitalityBar_placeholder_categoryExample",
    quickAddStep2Ph: "hospitalityBar_placeholder_categoryExample",
    categoryCustomPlaceholder: "hospitalityBar_placeholder_categoryExample",
    categoryNewPlaceholder: "hospitalityBar_placeholder_categoryExample",
    quickAddTitle: "hospitalityPage_addMenuItem",
    quickAddSave: "hospitalityAddMenuItem_save",
    quickAddName: "hospitalityBar_placeholder_nameExample",
    productNamePh: "hospitalityBar_placeholder_nameExample",
  },
  restaurant: {
    simpleAddStep1Example: "hospitalityRestaurant_placeholder_nameExample",
    simpleAddStep2Hint: "hospitalityRestaurant_placeholder_categoryHint",
    simpleAddShelfPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    quickAddStep2Ph: "hospitalityRestaurant_placeholder_categoryExample",
    categoryCustomPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    categoryNewPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    quickAddTitle: "hospitalityPage_addMenuItem",
    quickAddSave: "hospitalityAddMenuItem_save",
    quickAddName: "hospitalityRestaurant_placeholder_nameExample",
    productNamePh: "hospitalityRestaurant_placeholder_nameExample",
  },
  restaurant_bar: {
    simpleAddStep1Example: "hospitalityRestaurantBar_placeholder_nameExample",
    simpleAddStep2Hint: "hospitalityRestaurantBar_placeholder_categoryHint",
    simpleAddShelfPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    quickAddStep2Ph: "hospitalityRestaurantBar_placeholder_categoryExample",
    categoryCustomPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    categoryNewPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    quickAddTitle: "hospitalityPage_addMenuItem",
    quickAddSave: "hospitalityAddMenuItem_save",
    quickAddName: "hospitalityRestaurantBar_placeholder_nameExample",
    productNamePh: "hospitalityRestaurantBar_placeholder_nameExample",
  },
  hotel: {
    simpleAddStep1Example: "hospitalityRestaurantBar_placeholder_nameExample",
    simpleAddStep2Hint: "hospitalityRestaurantBar_placeholder_categoryHint",
    simpleAddShelfPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    quickAddStep2Ph: "hospitalityRestaurantBar_placeholder_categoryExample",
    categoryCustomPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    categoryNewPlaceholder: "hospitalityRestaurantBar_placeholder_categoryExample",
    quickAddTitle: "hospitalityPage_addMenuItem",
    quickAddSave: "hospitalityAddMenuItem_save",
    quickAddName: "hospitalityRestaurantBar_placeholder_nameExample",
    productNamePh: "hospitalityRestaurantBar_placeholder_nameExample",
  },
  default: {
    simpleAddStep1Example: "hospitalityRestaurant_placeholder_nameExample",
    simpleAddStep2Hint: "hospitalityRestaurant_placeholder_categoryHint",
    simpleAddShelfPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    quickAddStep2Ph: "hospitalityRestaurant_placeholder_categoryExample",
    categoryCustomPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    categoryNewPlaceholder: "hospitalityRestaurant_placeholder_categoryExample",
    quickAddTitle: "hospitalityPage_addMenuItem",
    quickAddSave: "hospitalityAddMenuItem_save",
    quickAddName: "hospitalityRestaurant_placeholder_nameExample",
    productNamePh: "hospitalityRestaurant_placeholder_nameExample",
  },
};

export function hospitalityUiActive(
  businessType: BusinessType | undefined | null,
  hospitalityModeEnabled?: boolean | null,
): boolean {
  return isHospitalityMode(businessType, hospitalityModeEnabled);
}

export function hospitalityPlaceholder(
  lang: Language,
  businessType: BusinessType | undefined | null,
  key: HospitalityPlaceholderKey,
): string {
  const subtype = hospitalitySubtype(businessType);
  const i18nKey = PLACEHOLDER_BY_SUBTYPE[subtype][key];
  return t(lang, i18nKey);
}

export function textContainsHospitalityRetailLeak(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of HOSPITALITY_FORBIDDEN_RETAIL_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

const BAR_ALIASES: Record<string, string[]> = {
  beer: ["lager", "ale", "stout"],
  whiskey: ["whisky", "spirit"],
  cocktail: ["mix drink"],
};

const RESTAURANT_ALIASES: Record<string, string[]> = {
  pilau: ["pilau rice", "rice dish"],
  chapati: ["roti"],
  chicken: ["chicken stew", "grilled chicken"],
};

const RESTAURANT_BAR_ALIASES: Record<string, string[]> = {
  ...RESTAURANT_ALIASES,
  beer: ["lager", "ale"],
  cocktail: ["mix drink"],
};

export function posSearchAliasesHospitality(
  businessType: BusinessType | undefined | null,
): Record<string, string[]> {
  if (businessType === "bar") return BAR_ALIASES;
  if (businessType === "restaurant") return RESTAURANT_ALIASES;
  if (businessType === "restaurant_bar" || businessType === "hotel") return RESTAURANT_BAR_ALIASES;
  return RESTAURANT_ALIASES;
}
