import type { BusinessType, Language } from "../types";
import type { SmartGuess } from "./smartProductGuess";
import { inferFromProductName } from "./smartProductGuess";
import { isPharmacyMode } from "./pharmacy";
import { isWholesaleMode } from "./wholesale";
import { hospitalityPlaceholder, hospitalityUiActive, posSearchAliasesHospitality, type HospitalityPlaceholderKey } from "./hospitalityUx";
import { t } from "./i18n";

/** Terms that must not appear in pharmacy-visible UI copy (tests + audits). */
export const PHARMACY_FORBIDDEN_RETAIL_TERMS = [
  "coca cola",
  "coca-cola",
  "sugar",
  "soap",
  "drinks",
  "groceries",
  "beer",
  "soda",
  "crate",
  "carton",
  "pilau",
  "chapati",
  "nile special",
] as const;

export type PharmacyPlaceholderKey =
  | "simpleAddStep1Example"
  | "simpleAddStep2Hint"
  | "simpleAddShelfPlaceholder"
  | "quickAddStep2Ph"
  | "categoryCustomPlaceholder"
  | "categoryNewPlaceholder"
  | "simpleAddStep1Title"
  | "simpleAddStep2Title"
  | "simpleAddPackToggle"
  | "quickAddTitle"
  | "quickAddSave"
  | "quickAddName"
  | "productNamePh";

const PHARMACY_PLACEHOLDER_I18N: Record<PharmacyPlaceholderKey, string> = {
  simpleAddStep1Example: "pharmacyPlaceholder_nameExample",
  simpleAddStep2Hint: "pharmacyPlaceholder_categoryHint",
  simpleAddShelfPlaceholder: "pharmacyPlaceholder_categoryExample",
  quickAddStep2Ph: "pharmacyPlaceholder_categoryExample",
  categoryCustomPlaceholder: "pharmacyPlaceholder_categoryExample",
  categoryNewPlaceholder: "pharmacyPlaceholder_categoryExample",
  simpleAddStep1Title: "pharmacyAddMedicine_stepName",
  simpleAddStep2Title: "pharmacyAddMedicine_stepCategory",
  simpleAddPackToggle: "pharmacyAddMedicine_packHidden",
  quickAddTitle: "pharmacyPage_addMedicine",
  quickAddSave: "pharmacyAddMedicine_save",
  quickAddName: "pharmacyPage_medicineName",
  productNamePh: "pharmacyPlaceholder_nameExample",
};

const WHOLESALE_PLACEHOLDER_I18N: Record<PharmacyPlaceholderKey, string> = {
  simpleAddStep1Example: "wholesalePlaceholder_nameExample",
  simpleAddStep2Hint: "wholesalePlaceholder_categoryHint",
  simpleAddShelfPlaceholder: "wholesalePlaceholder_categoryExample",
  quickAddStep2Ph: "wholesalePlaceholder_categoryExample",
  categoryCustomPlaceholder: "wholesalePlaceholder_categoryExample",
  categoryNewPlaceholder: "wholesalePlaceholder_categoryExample",
  simpleAddStep1Title: "wholesaleAddItem_stepName",
  simpleAddStep2Title: "wholesaleAddItem_stepCategory",
  simpleAddPackToggle: "wholesaleAddItem_packPriority",
  quickAddTitle: "wholesalePage_addStockItem",
  quickAddSave: "wholesaleAddItem_save",
  quickAddName: "wholesalePage_stockItemName",
  productNamePh: "wholesalePlaceholder_nameExample",
};

export function pharmacyUiActive(
  businessType: BusinessType | undefined | null,
  pharmacyModeEnabled?: boolean | null,
): boolean {
  return isPharmacyMode(businessType, pharmacyModeEnabled);
}

export function wholesaleUiActive(businessType: BusinessType | undefined | null): boolean {
  return isWholesaleMode(businessType);
}

/** Resolve placeholder or label: pharmacy-specific i18n when in pharmacy mode. */
export function uiPlaceholder(
  lang: Language,
  businessType: BusinessType | undefined | null,
  key: PharmacyPlaceholderKey,
  pharmacyModeEnabled?: boolean | null,
  hospitalityModeEnabled?: boolean | null,
): string {
  if (wholesaleUiActive(businessType)) {
    const wholesaleKey = WHOLESALE_PLACEHOLDER_I18N[key];
    return t(lang, wholesaleKey);
  }
  if (pharmacyUiActive(businessType, pharmacyModeEnabled)) {
    const phKey = PHARMACY_PLACEHOLDER_I18N[key];
    return t(lang, phKey);
  }
  if (hospitalityUiActive(businessType, hospitalityModeEnabled)) {
    return hospitalityPlaceholder(lang, businessType, key as HospitalityPlaceholderKey);
  }
  return t(lang, key);
}

const RETAIL_POS_ALIASES: Record<string, string[]> = {
  blueband: ["margarine"],
  margarine: ["blueband"],
  soda: ["coke", "coca cola", "pepsi", "fanta", "sprite", "mirinda", "soft drink"],
  sugar: ["kakira", "kinyara", "brown sugar", "sack"],
};

const PHARMACY_POS_ALIASES: Record<string, string[]> = {
  paracetamol: ["panadol", "pcm"],
  amoxicillin: ["amox", "amoxicillin"],
  ibuprofen: ["brufen", "ibu"],
  omeprazole: ["omeprazole", "omez"],
  metronidazole: ["flagyl", "metro"],
  "vitamin c": ["vitc", "ascorbic"],
  cetirizine: ["cetirizine", "zyrtec"],
  artemether: ["coartem", "lumefantrine", "malaria"],
  ors: ["oral rehydration", "rehydration salts"],
  diclofenac: ["voltaren", "diclofenac"],
};

const WHOLESALE_POS_ALIASES: Record<string, string[]> = {
  rice: ["25kg bag", "50kg bag", "bagged rice"],
  sugar: ["50kg sack", "bulk sugar", "kakira", "kinyara"],
  flour: ["wheat flour", "maize flour"],
  soap: ["laundry soap", "bar soap carton"],
  "cooking oil": ["oil carton", "jerrican", "sunflower oil"],
  "soft drinks": ["crate", "soda crate", "fanta crate"],
  water: ["mineral water", "water case"],
  detergent: ["detergent carton", "washing powder"],
  biscuits: ["biscuit carton"],
  salt: ["salt bag"],
};

export function posSearchAliases(
  businessType: BusinessType | undefined | null,
  pharmacyModeEnabled?: boolean | null,
  hospitalityModeEnabled?: boolean | null,
): Record<string, string[]> {
  if (wholesaleUiActive(businessType)) {
    return WHOLESALE_POS_ALIASES;
  }
  if (pharmacyUiActive(businessType, pharmacyModeEnabled)) {
    return PHARMACY_POS_ALIASES;
  }
  if (hospitalityUiActive(businessType, hospitalityModeEnabled)) {
    return posSearchAliasesHospitality(businessType);
  }
  return RETAIL_POS_ALIASES;
}

function inferPharmacyFromProductName(raw: string): SmartGuess {
  const n = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  if (/\b(syrup|suspension|susp)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "bottle",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [1000, 2000, 5000],
      quickPresetsQty: [1, 1, 1],
    };
  }
  if (/\b(ors|rehydration)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "sachet",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [500, 1000, 2000],
      quickPresetsQty: [1, 2, 5],
    };
  }
  if (/\b(cream|ointment|gel|drops)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "tube",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [2000, 5000, 10000],
      quickPresetsQty: [1, 1, 1],
    };
  }

  return {
    sellingMode: "unit",
    baseUnit: "tablet",
    buyingUnit: null,
    conversionRate: null,
    quickPresetsMoneyUgx: [500, 1000, 2000],
    quickPresetsQty: [1, 2, 10],
  };
}

function inferWholesaleFromProductName(raw: string): SmartGuess {
  const n = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/\b(crate|soft drink|soda|beer)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "bottle",
      buyingUnit: "crate",
      conversionRate: 24,
      quickPresetsMoneyUgx: [1500, 3000, 6000],
      quickPresetsQty: [1, 6, 12],
    };
  }
  if (/\b(case|water)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "bottle",
      buyingUnit: "case",
      conversionRate: 24,
      quickPresetsMoneyUgx: [1000, 2000, 5000],
      quickPresetsQty: [1, 6, 12],
    };
  }
  if (/\b(carton|soap|detergent|biscuit)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "piece",
      buyingUnit: "carton",
      conversionRate: 24,
      quickPresetsMoneyUgx: [2000, 5000, 10000],
      quickPresetsQty: [1, 6, 12],
    };
  }
  if (/\b(sack|bag|rice|sugar|salt|flour)\b/.test(n)) {
    return {
      sellingMode: "weighted",
      baseUnit: "kg",
      buyingUnit: "bag",
      conversionRate: 50,
      quickPresetsMoneyUgx: [3000, 6000, 12000],
      quickPresetsQty: [1, 5, 10],
    };
  }
  return {
    sellingMode: "unit",
    baseUnit: "piece",
    buyingUnit: "carton",
    conversionRate: 12,
    quickPresetsMoneyUgx: [2000, 5000, 10000],
    quickPresetsQty: [1, 6, 12],
  };
}

export function inferProductGuess(
  raw: string,
  businessType: BusinessType | undefined | null,
  pharmacyModeEnabled?: boolean | null,
): SmartGuess {
  if (wholesaleUiActive(businessType)) {
    return inferWholesaleFromProductName(raw);
  }
  if (!pharmacyUiActive(businessType, pharmacyModeEnabled)) {
    return inferFromProductName(raw);
  }
  return inferPharmacyFromProductName(raw);
}

export function textContainsRetailLeak(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of PHARMACY_FORBIDDEN_RETAIL_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}
