/**
 * Product-level kitchen/bar routing — replaces keyword heuristics when metadata is set.
 */

import type {
  HospitalityCourse,
  KitchenStation,
  KitchenStationType,
  Product,
  ProductHospitalityRouting,
} from "../types";
import { HOSPITALITY_CATEGORY_LABELS } from "../data/hospitalityCategoryPresets";

export const KITCHEN_STATION_TYPES: readonly KitchenStationType[] = [
  "kitchen",
  "bar",
  "grill",
  "coffee",
  "dessert",
  "pizza",
  "fryer",
  "other",
] as const;

/** Station types included when waiter taps “Send to Kitchen”. */
export const KITCHEN_FIRE_STATION_TYPES: KitchenStationType[] = [
  "kitchen",
  "grill",
  "coffee",
  "dessert",
  "pizza",
  "fryer",
  "other",
];

/** Station types included when waiter taps “Send to Bar”. */
export const BAR_FIRE_STATION_TYPES: KitchenStationType[] = ["bar"];

export const HOSPITALITY_COURSES: readonly HospitalityCourse[] = [
  "starter",
  "main",
  "side",
  "dessert",
  "drink",
  "other",
] as const;

/** When a floor station of exact type is missing, try these in order. */
export const STATION_RESOLVE_FALLBACKS: Record<KitchenStationType, KitchenStationType[]> = {
  kitchen: ["kitchen", "grill", "fryer", "pizza", "other"],
  bar: ["bar", "coffee"],
  grill: ["grill", "kitchen", "fryer"],
  coffee: ["coffee", "bar", "kitchen"],
  dessert: ["dessert", "kitchen", "other"],
  pizza: ["pizza", "kitchen", "grill"],
  fryer: ["fryer", "kitchen", "grill"],
  other: ["other", "kitchen"],
};

const DRINK_KEYWORDS =
  /beer|wine|spirit|cocktail|soda|soft|water|juice|drink|lager|gin|vodka|whisky|whiskey|rum|brandy|cider/i;
const FOOD_KEYWORDS =
  /food|chicken|pork|fish|goat|rice|chips|plate|meat|soup|bread|breakfast|lunch|dinner|burger|pizza|pasta|steak|grill|fries|salad/i;
const COFFEE_KEYWORDS = /coffee|espresso|latte|cappuccino|tea|chai/i;
const DESSERT_KEYWORDS = /dessert|cake|ice cream|pastry|sweet|pudding/i;

/** Category label / key → default production station. */
const CATEGORY_DEFAULT_STATION = buildCategoryStationMap();

function buildCategoryStationMap(): Map<string, KitchenStationType> {
  const map = new Map<string, KitchenStationType>();
  const entries: Array<[string, KitchenStationType]> = [
    ["beer", "bar"],
    ["wine", "bar"],
    ["spirits", "bar"],
    ["soft_drinks", "bar"],
    ["soft drinks", "bar"],
    ["water", "bar"],
    ["cocktails", "bar"],
    ["snacks", "bar"],
    ["food", "kitchen"],
    ["chicken", "grill"],
    ["pork", "kitchen"],
    ["fish", "kitchen"],
    ["goat", "kitchen"],
    ["rice", "kitchen"],
    ["desserts", "dessert"],
    ["coffee", "coffee"],
  ];
  for (const [key, station] of entries) {
    map.set(normalizeCategoryKey(key), station);
  }
  for (const [key, label] of Object.entries(HOSPITALITY_CATEGORY_LABELS)) {
    if (!map.has(normalizeCategoryKey(label))) {
      map.set(normalizeCategoryKey(label), map.get(normalizeCategoryKey(key)) ?? "kitchen");
    }
    map.set(normalizeCategoryKey(key), map.get(normalizeCategoryKey(key)) ?? "kitchen");
  }
  return map;
}

function normalizeCategoryKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function inferStationFromKeywords(product: Product): KitchenStationType {
  const cat = (product.category ?? "").toLowerCase();
  const name = product.name.toLowerCase();
  if (DRINK_KEYWORDS.test(cat) || DRINK_KEYWORDS.test(name)) return "bar";
  if (COFFEE_KEYWORDS.test(cat) || COFFEE_KEYWORDS.test(name)) return "coffee";
  if (DESSERT_KEYWORDS.test(cat) || DESSERT_KEYWORDS.test(name)) return "dessert";
  if (FOOD_KEYWORDS.test(cat) || FOOD_KEYWORDS.test(name)) return "kitchen";
  return "kitchen";
}

function inferStationFromCategory(product: Product): KitchenStationType | null {
  const cat = normalizeCategoryKey(product.category ?? "");
  if (!cat) return null;
  return CATEGORY_DEFAULT_STATION.get(cat) ?? null;
}

/** Resolve production station: explicit metadata → category → legacy keywords. */
export function resolveProductProductionStation(product: Product): KitchenStationType {
  const explicit = product.hospitality?.productionStation;
  if (explicit && KITCHEN_STATION_TYPES.includes(explicit)) return explicit;
  return inferStationFromCategory(product) ?? inferStationFromKeywords(product);
}

/** @deprecated Use resolveProductProductionStation — kept for reports. */
export function resolveProductStationType(product: Product): KitchenStationType {
  return resolveProductProductionStation(product);
}

export function resolveProductPrintableStation(product: Product): KitchenStationType {
  const printable = product.hospitality?.printableStation;
  if (printable && KITCHEN_STATION_TYPES.includes(printable)) return printable;
  return resolveProductProductionStation(product);
}

export function resolveProductDefaultCourse(product: Product): HospitalityCourse {
  const course = product.hospitality?.defaultCourse;
  if (course && HOSPITALITY_COURSES.includes(course)) return course;
  const station = resolveProductProductionStation(product);
  if (station === "bar" || station === "coffee") return "drink";
  if (station === "dessert") return "dessert";
  return "main";
}

export function resolveProductPrepTimeMinutes(product: Product): number | null {
  const mins = product.hospitality?.prepTimeMinutes;
  if (mins != null && Number.isFinite(mins) && mins > 0) return Math.round(mins);
  return null;
}

export function productModifiersAllowed(product: Product): boolean {
  return product.hospitality?.modifiersAllowed !== false;
}

export function productCookingPreferencesAllowed(product: Product): boolean {
  return product.hospitality?.cookingPreferencesAllowed === true;
}

export function resolveStationForProduct(
  product: Product,
  stations: KitchenStation[],
): KitchenStation | null {
  const active = stations.filter((s) => s.isActive);
  if (!active.length) return null;
  const explicitId = product.hospitality?.productionStationId;
  if (explicitId) {
    const direct = active.find((s) => s.id === explicitId);
    if (direct) return direct;
  }
  const preferred = resolveProductProductionStation(product);
  const candidates = STATION_RESOLVE_FALLBACKS[preferred] ?? [preferred];
  for (const type of candidates) {
    const match = active.find((s) => s.stationType === type);
    if (match) return match;
  }
  return active[0] ?? null;
}

export function normalizeProductHospitalityRouting(
  raw: ProductHospitalityRouting | null | undefined,
  product: Product,
): ProductHospitalityRouting | null {
  if (!raw && !product.category) return null;
  const productionStation =
    raw?.productionStation && KITCHEN_STATION_TYPES.includes(raw.productionStation)
      ? raw.productionStation
      : raw?.routingAutoInferred
        ? inferStationFromCategory(product) ?? inferStationFromKeywords(product)
        : null;
  if (!raw && !productionStation) return null;

  const prep =
    raw?.prepTimeMinutes != null && Number.isFinite(raw.prepTimeMinutes) && raw.prepTimeMinutes > 0
      ? Math.round(raw.prepTimeMinutes)
      : null;
  const printableStation =
    raw?.printableStation && KITCHEN_STATION_TYPES.includes(raw.printableStation)
      ? raw.printableStation
      : null;
  const defaultCourse =
    raw?.defaultCourse && HOSPITALITY_COURSES.includes(raw.defaultCourse) ? raw.defaultCourse : null;

  return {
    productionStation: productionStation ?? null,
    prepTimeMinutes: prep,
    defaultCourse,
    printableStation,
    modifiersAllowed: raw?.modifiersAllowed !== false,
    cookingPreferencesAllowed: raw?.cookingPreferencesAllowed === true,
    routingAutoInferred: raw?.routingAutoInferred === true,
  };
}

/** Build routing block inferred from category/keywords (bulk migration helper). */
export function inferProductHospitalityRouting(product: Product): ProductHospitalityRouting {
  const fromCategory = inferStationFromCategory(product);
  return {
    productionStation: fromCategory ?? inferStationFromKeywords(product),
    prepTimeMinutes: null,
    defaultCourse: resolveProductDefaultCourse({
      ...product,
      hospitality: { productionStation: fromCategory ?? "kitchen" },
    }),
    printableStation: null,
    modifiersAllowed: true,
    cookingPreferencesAllowed: false,
    routingAutoInferred: true,
  };
}

export function hospitalityRoutingLabelKey(station: KitchenStationType): string {
  return `hospitalityStation_${station}`;
}

export function hospitalityCourseLabelKey(course: HospitalityCourse): string {
  return `hospitalityCourse_${course}`;
}
