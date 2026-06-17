import type { PosShelfLayoutConfig, PosShelfPresetId, Product } from "../types";
import { distinctTrimmedCategories } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";

export type ShelfPresetResult = {
  presetId: PosShelfPresetId;
  orderKeys: string[];
  layout: Record<string, PosShelfLayoutConfig>;
  quickSellProductIds: string[];
};

type PresetShelfDef = {
  match: RegExp;
  config: PosShelfLayoutConfig;
};

const PRESET_DEFS: Record<PosShelfPresetId, { shelves: PresetShelfDef[]; quickMatch?: RegExp[] }> = {
  retail: {
    shelves: [
      { match: /fast|mover|popular/i, config: { displayName: "Fast Movers", icon: "🔥", color: "orange", size: "large", featured: true, badge: "fast_moving" } },
      { match: /drink|soda|soft|water/i, config: { displayName: "Soft Drinks", icon: "🥤", color: "blue", size: "medium" } },
      { match: /beer|alcohol|spirit/i, config: { displayName: "Beer", icon: "🍺", color: "orange", size: "medium" } },
      { match: /snack|biscuit|chips/i, config: { displayName: "Snacks", icon: "🍪", color: "green", size: "small" } },
      { match: /promo|deal|offer/i, config: { displayName: "Promotions", icon: "🏷", color: "red", size: "medium", badge: "promotion" } },
    ],
    quickMatch: [/coke|cola|water|bread|milk/i],
  },
  supermarket: {
    shelves: [
      { match: /fast|mover|popular/i, config: { displayName: "Fast Movers", icon: "🔥", color: "orange", size: "large", featured: true, badge: "fast_moving" } },
      { match: /rice|grain|maize|flour/i, config: { displayName: "Rice & Grains", icon: "🍚", color: "green", size: "medium" } },
      { match: /drink|soda|juice/i, config: { displayName: "Drinks", icon: "🥤", color: "blue", size: "medium" } },
      { match: /soap|detergent|clean/i, config: { displayName: "Household", icon: "🧼", color: "purple", size: "small" } },
      { match: /snack|biscuit/i, config: { displayName: "Snacks", icon: "🍪", color: "orange", size: "small" } },
    ],
    quickMatch: [/coke|water|bread|sugar|salt/i],
  },
  pharmacy: {
    shelves: [
      { match: /pain|fever|paracetamol/i, config: { displayName: "Pain Relief", icon: "💊", color: "red", size: "medium" } },
      { match: /antibiot|malaria|cough/i, config: { displayName: "Medicines", icon: "💊", color: "blue", size: "large", featured: true, badge: "fast_moving" } },
      { match: /vitamin|supplement/i, config: { displayName: "Vitamins", icon: "💊", color: "green", size: "small" } },
      { match: /first aid|bandage/i, config: { displayName: "First Aid", icon: "💊", color: "orange", size: "small" } },
    ],
    quickMatch: [/paracetamol|panadol|cough/i],
  },
  restaurant: {
    shelves: [
      { match: /main|meal|plate/i, config: { displayName: "Main Dishes", icon: "🍽", color: "orange", size: "large", featured: true } },
      { match: /drink|juice|soda/i, config: { displayName: "Drinks", icon: "🥤", color: "blue", size: "medium" } },
      { match: /side|extra/i, config: { displayName: "Sides", icon: "🍞", color: "green", size: "small" } },
    ],
    quickMatch: [/water|soda|chips/i],
  },
  bar: {
    shelves: [
      { match: /beer|lager|stout/i, config: { displayName: "Beer", icon: "🍺", color: "orange", size: "large", featured: true, badge: "fast_moving" } },
      { match: /spirit|whisky|gin|vodka/i, config: { displayName: "Spirits", icon: "🍺", color: "purple", size: "medium" } },
      { match: /soft|soda|mixer/i, config: { displayName: "Soft Drinks", icon: "🥤", color: "blue", size: "medium" } },
      { match: /snack|chips|nuts/i, config: { displayName: "Snacks", icon: "🍪", color: "green", size: "small" } },
    ],
    quickMatch: [/beer|soda|water/i],
  },
  hardware: {
    shelves: [
      { match: /tool|hammer|drill/i, config: { displayName: "Tools", icon: "🔧", color: "orange", size: "large", featured: true } },
      { match: /paint|brush/i, config: { displayName: "Paint", icon: "🎨", color: "blue", size: "medium" } },
      { match: /nail|screw|bolt/i, config: { displayName: "Fasteners", icon: "📦", color: "green", size: "small" } },
    ],
    quickMatch: [/tape|glue|bulb/i],
  },
  boutique: {
    shelves: [
      { match: /dress|gown|outfit/i, config: { displayName: "Dresses", icon: "👗", color: "purple", size: "large", featured: true } },
      { match: /shoe|sandal/i, config: { displayName: "Footwear", icon: "👟", color: "orange", size: "medium" } },
      { match: /bag|accessory|jewel/i, config: { displayName: "Accessories", icon: "👜", color: "green", size: "small" } },
    ],
    quickMatch: [/scarf|belt|socks/i],
  },
};

export const POS_SHELF_PRESET_IDS: PosShelfPresetId[] = [
  "retail",
  "supermarket",
  "pharmacy",
  "restaurant",
  "bar",
  "hardware",
  "boutique",
];

function matchCategory(categories: string[], def: PresetShelfDef): string | null {
  for (const cat of categories) {
    if (def.match.test(cat)) return cat;
  }
  return null;
}

export function applyShelfPreset(presetId: PosShelfPresetId, products: Product[]): ShelfPresetResult {
  const preset = PRESET_DEFS[presetId];
  const categories = distinctTrimmedCategories(products);
  const layout: Record<string, PosShelfLayoutConfig> = {
    [QUICK_SELL_SHELF_KEY]: {
      displayName: "Quick Sell",
      icon: "⚡",
      color: "orange",
      size: "medium",
      featured: true,
      badge: "fast_moving",
    },
  };
  const orderKeys: string[] = [QUICK_SELL_SHELF_KEY];
  const used = new Set<string>();

  for (const def of preset.shelves) {
    const cat = matchCategory(categories, def);
    if (!cat || used.has(cat)) continue;
    used.add(cat);
    layout[cat] = { ...def.config };
    orderKeys.push(cat);
    if (def.config.featured && def.config.size === "large") {
      // featured large shelves stay near top via order
    }
  }

  for (const cat of categories) {
    if (!used.has(cat)) orderKeys.push(cat);
  }

  const quickSellProductIds: string[] = [];
  if (preset.quickMatch) {
    for (const p of products) {
      const hay = `${p.name} ${p.category}`.toLowerCase();
      if (preset.quickMatch.some((rx) => rx.test(hay))) {
        quickSellProductIds.push(p.id);
        if (quickSellProductIds.length >= 8) break;
      }
    }
  }

  return { presetId, orderKeys, layout, quickSellProductIds };
}
