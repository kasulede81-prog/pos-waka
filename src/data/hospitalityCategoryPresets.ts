/** Stable keys → i18n `hospitalityCat_${key}` */
export const HOSPITALITY_CATEGORY_PRESET_KEYS = [
  "beer",
  "wine",
  "spirits",
  "soft_drinks",
  "water",
  "cocktails",
  "food",
  "chicken",
  "pork",
  "fish",
  "goat",
  "rice",
  "desserts",
  "coffee",
  "snacks",
] as const;

export type HospitalityCategoryPresetKey = (typeof HOSPITALITY_CATEGORY_PRESET_KEYS)[number];

export const HOSPITALITY_CATEGORY_LABELS: Record<HospitalityCategoryPresetKey, string> = {
  beer: "Beer",
  wine: "Wine",
  spirits: "Spirits",
  soft_drinks: "Soft Drinks",
  water: "Water",
  cocktails: "Cocktails",
  food: "Food",
  chicken: "Chicken",
  pork: "Pork",
  fish: "Fish",
  goat: "Goat",
  rice: "Rice",
  desserts: "Desserts",
  coffee: "Coffee",
  snacks: "Snacks",
};

/** Default category shelf for bar-heavy venues */
export const BAR_CATEGORY_KEYS: HospitalityCategoryPresetKey[] = [
  "beer",
  "spirits",
  "soft_drinks",
  "water",
  "cocktails",
  "snacks",
];

/** Default category shelf for restaurant-heavy venues */
export const RESTAURANT_CATEGORY_KEYS: HospitalityCategoryPresetKey[] = [
  "food",
  "chicken",
  "pork",
  "fish",
  "goat",
  "rice",
  "soft_drinks",
  "water",
  "desserts",
  "coffee",
];

export const RESTAURANT_BAR_CATEGORY_KEYS: HospitalityCategoryPresetKey[] = [
  ...RESTAURANT_CATEGORY_KEYS,
  "beer",
  "wine",
  "spirits",
  "cocktails",
];
