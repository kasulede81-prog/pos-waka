/** Stable keys → i18n `productCat_${key}` */
export const PRODUCT_CATEGORY_PRESET_KEYS = [
  "sugar",
  "rice",
  "oil",
  "soda",
  "water",
  "soap",
  "salt",
  "bread",
  "airtime",
  "eggs",
  "charcoal",
  "posho",
  "beans",
  "milk",
  "beer",
  "cement",
  "nails",
  "phone_accessories",
] as const;

export type ProductCategoryPresetKey = (typeof PRODUCT_CATEGORY_PRESET_KEYS)[number];
