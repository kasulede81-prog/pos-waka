import type { CSSProperties } from "react";
import type { PosShelfBadge, PosShelfColor, PosShelfLayoutConfig, PosShelfSize, Product } from "../types";
import { normalizeShelfHex, launcherBoldTileColorStyle } from "./shelfColor";
import {
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  shelfIconFor,
} from "./productCategories";
import { effectiveShelfOrderKeys, sortPosShelfCards, type PosShelfCard } from "./posShelfOrder";

/** Virtual shelf for owner-picked one-tap products. */
export const QUICK_SELL_SHELF_KEY = "__waka_quick_sell__";

export type PosShelfDisplayCard = PosShelfCard & {
  color: PosShelfColor;
  customColor: string | null;
  scale: number;
  size: PosShelfSize;
  featured: boolean;
  badge: PosShelfBadge | null;
  isQuickSell?: boolean;
};

const SHELF_SCALE_MIN = 25;
const SHELF_SCALE_MAX = 100;

const SHELF_COLORS: PosShelfColor[] = ["default", "red", "orange", "blue", "green", "purple"];

/** Default bold shelf colours for new shops — 1st blue, 2nd pink (red), 3rd orange, then cycle. */
export const DEFAULT_NEW_USER_SHELF_COLORS: PosShelfColor[] = ["blue", "red", "orange", "green", "purple"];

export function defaultShelfColorForIndex(index: number): PosShelfColor {
  return DEFAULT_NEW_USER_SHELF_COLORS[index % DEFAULT_NEW_USER_SHELF_COLORS.length] ?? "blue";
}

/** Guess shelf colour from category name; falls back to position in the shop's shelf list. */
export function inferDefaultShelfColor(category: string, index: number): PosShelfColor {
  const key = category.toLowerCase();
  if (/drink|soda|juice|water|beer|soft/.test(key)) return "red";
  if (/bakery|bread|cake|pastry/.test(key)) return "blue";
  if (/soap|detergent|omo|wash|clean|laundry/.test(key)) return "orange";
  if (/rice|grain|maize|flour|food|sugar|posho/.test(key)) return "green";
  if (/snack|biscuit|chips/.test(key)) return "purple";
  return defaultShelfColorForIndex(index);
}

/** Fill missing shelf colours for new categories without overwriting saved customisation. */
export function fillDefaultShelfLayout(
  layout: Record<string, PosShelfLayoutConfig>,
  categories: string[],
  orderKeys: string[] = [],
): Record<string, PosShelfLayoutConfig> {
  if (categories.length === 0) return layout;
  const ordered = effectiveShelfOrderKeys(categories, orderKeys);
  let changed = false;
  const out: Record<string, PosShelfLayoutConfig> = { ...layout };
  ordered.forEach((key, index) => {
    const prev = out[key];
    if (prev?.color) return;
    const icon = prev?.icon ?? shelfIconFor(key) ?? undefined;
    out[key] = {
      ...prev,
      color: inferDefaultShelfColor(key, index),
      ...(icon ? { icon } : {}),
    };
    changed = true;
  });
  return changed ? out : layout;
}
const SHELF_SIZES: PosShelfSize[] = ["small", "medium", "large"];

export const SHELF_ICON_OPTIONS = [
  "🥤",
  "🍺",
  "🍚",
  "💊",
  "🍞",
  "🥩",
  "🧴",
  "🍪",
  "🧼",
  "🛢",
  "📦",
  "🔥",
  "⭐",
  "🏷",
  "🌾",
  "🧂",
] as const;

export function isPosShelfColor(v: unknown): v is PosShelfColor {
  return typeof v === "string" && (SHELF_COLORS as string[]).includes(v);
}

export function isPosShelfSize(v: unknown): v is PosShelfSize {
  return typeof v === "string" && (SHELF_SIZES as string[]).includes(v);
}

export function isPosShelfBadge(v: unknown): v is PosShelfBadge {
  return v === "fast_moving" || v === "promotion";
}

export function clampShelfScale(value: number): number {
  return Math.max(SHELF_SCALE_MIN, Math.min(SHELF_SCALE_MAX, Math.round(value)));
}

export function shelfScaleFromConfig(
  config?: PosShelfLayoutConfig,
  featured = false,
  defaultScale = 35,
): number {
  if (typeof config?.scale === "number" && Number.isFinite(config.scale)) {
    return clampShelfScale(config.scale);
  }
  if (config?.size === "large") return 85;
  if (config?.size === "medium") return 55;
  if (config?.size === "small") return 35;
  const base = clampShelfScale(defaultScale);
  return featured ? Math.max(base, 72) : base;
}

export function scaleToShelfSize(scale: number): PosShelfSize {
  if (scale >= 72) return "large";
  if (scale >= 42) return "medium";
  return "small";
}

export function shelfGridSpanFromScale(scale: number): { col: number; row: number } {
  const s = clampShelfScale(scale);
  const col = s >= 45 ? 2 : 1;
  const row = s >= 78 ? 2 : 1;
  return { col, row };
}

export function shelfGridSpanStyle(scale: number): CSSProperties {
  const { col, row } = shelfGridSpanFromScale(scale);
  return { gridColumn: `span ${col}`, gridRow: `span ${row}` };
}

export function shelfTypographyFromScale(scale: number): {
  iconRem: number;
  titleRem: number;
  countRem: number;
  paddingRem: number;
} {
  const t = clampShelfScale(scale) / 100;
  return {
    iconRem: 0.72 + t * 0.48,
    titleRem: 0.92 + t * 1.05,
    countRem: 0.58 + t * 0.28,
    paddingRem: 0.5 + t * 0.65,
  };
}

export function normalizePosShelfLayout(
  raw: unknown,
): Record<string, PosShelfLayoutConfig> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PosShelfLayoutConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key).trim().slice(0, 120);
    if (!k || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const entry: PosShelfLayoutConfig = {};
    if (typeof v.displayName === "string" && v.displayName.trim()) {
      entry.displayName = v.displayName.trim().slice(0, 80);
    }
    if (typeof v.icon === "string" && v.icon.trim()) {
      entry.icon = v.icon.trim().slice(0, 8);
    }
    if (isPosShelfColor(v.color)) entry.color = v.color;
    const customColor = normalizeShelfHex(v.customColor);
    if (customColor) entry.customColor = customColor;
    if (isPosShelfSize(v.size)) entry.size = v.size;
    if (typeof v.scale === "number" && Number.isFinite(v.scale)) {
      entry.scale = clampShelfScale(v.scale);
    }
    if (typeof v.featured === "boolean") entry.featured = v.featured;
    if (v.badge === null) entry.badge = null;
    else if (isPosShelfBadge(v.badge)) entry.badge = v.badge;
    out[k] = entry;
  }
  return out;
}

export function mergeShelfLayout(
  card: PosShelfCard,
  config?: PosShelfLayoutConfig,
  defaultScale = 35,
  options?: { fallbackColor?: PosShelfColor },
): PosShelfDisplayCard {
  const featured = Boolean(config?.featured);
  const scale = shelfScaleFromConfig(config, featured, defaultScale);
  const color =
    config?.color ?? (featured ? "orange" : options?.fallbackColor ?? "default");
  return {
    ...card,
    label: config?.displayName?.trim() || card.label,
    icon: config?.icon?.trim() || card.icon,
    color,
    customColor: normalizeShelfHex(config?.customColor),
    scale,
    size: scaleToShelfSize(scale),
    featured,
    badge: config?.badge ?? (featured ? "fast_moving" : null),
  };
}

/** Featured shelves first, then saved order. */
export function sortShelvesForDisplay(cards: PosShelfDisplayCard[], orderKeys: string[]): PosShelfDisplayCard[] {
  const ordered = sortPosShelfCards(cards, orderKeys) as PosShelfDisplayCard[];
  const featured = ordered.filter((c) => c.featured);
  const rest = ordered.filter((c) => !c.featured);
  return [...featured, ...rest];
}

/** Shelf keys from products plus saved order/layout so empty shelves stay visible. */
export function collectShelfCategoryKeys(
  products: Product[],
  orderKeys: string[],
  layout: Record<string, PosShelfLayoutConfig>,
): string[] {
  const fromProducts = distinctTrimmedCategories(products);
  const extras = [...orderKeys, ...Object.keys(layout)].filter(
    (k) => k && k !== QUICK_SELL_SHELF_KEY && k !== UNCATEGORIZED_SENTINEL,
  );
  return [...new Set([...fromProducts, ...extras])];
}

export function shelfHasUncategorizedSlot(
  products: Product[],
  orderKeys: string[],
  layout: Record<string, PosShelfLayoutConfig>,
): boolean {
  if (products.some((p) => !(p.category ?? "").trim())) return true;
  return orderKeys.includes(UNCATEGORIZED_SENTINEL) || UNCATEGORIZED_SENTINEL in layout;
}

export function buildPosShelfDisplayCards(
  products: Product[],
  noShelfLabel: string,
  layout: Record<string, PosShelfLayoutConfig>,
  orderKeys: string[],
  defaultScale = 35,
): PosShelfDisplayCard[] {
  const categoryOptions = collectShelfCategoryKeys(products, orderKeys, layout);
  const hasUncategorized = shelfHasUncategorizedSlot(products, orderKeys, layout);
  const categoryCounts = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const p of products) {
    const cat = (p.category ?? "").trim();
    if (!cat) uncategorizedCount += 1;
    else categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }

  const baseCards: PosShelfCard[] = categoryOptions.map((cat) => ({
    key: cat,
    label: cat,
    count: categoryCounts.get(cat) ?? 0,
    icon: shelfIconFor(cat),
  }));
  if (hasUncategorized) {
    baseCards.push({
      key: UNCATEGORIZED_SENTINEL,
      label: noShelfLabel,
      count: uncategorizedCount,
      icon: null,
    });
  }

  const orderForColor = effectiveShelfOrderKeys(
    baseCards.map((c) => c.key),
    orderKeys,
  );

  const merged = baseCards.map((card) => {
    const idx = orderForColor.indexOf(card.key);
    const fallbackColor = idx >= 0 ? inferDefaultShelfColor(card.key, idx) : defaultShelfColorForIndex(0);
    return mergeShelfLayout(card, layout[card.key], defaultScale, { fallbackColor });
  });
  return sortShelvesForDisplay(merged, orderKeys);
}

export function buildQuickSellShelfCard(
  productIds: string[],
  products: Product[],
  label: string,
  layout?: PosShelfLayoutConfig,
  defaultScale = 35,
): PosShelfDisplayCard | null {
  const valid = productIds.filter((id) => products.some((p) => p.id === id));
  if (valid.length === 0) return null;
  const base: PosShelfCard = {
    key: QUICK_SELL_SHELF_KEY,
    label,
    count: valid.length,
    icon: "⚡",
  };
  const merged = mergeShelfLayout(
    base,
    {
      ...layout,
      size: layout?.size ?? "medium",
      color: layout?.color ?? "orange",
      featured: true,
      icon: layout?.icon ?? "⚡",
    },
    defaultScale,
  );
  return { ...merged, isQuickSell: true };
}

export function shelfColorClasses(color: PosShelfColor, featured: boolean): string {
  const ring = featured ? "ring-2 ring-inset ring-white/40" : "";
  const bold =
    "border-white/30 text-white shadow-md hover:brightness-110 active:scale-[0.98]";
  switch (color) {
    case "red":
      return `${bold} bg-gradient-to-br from-rose-500 to-rose-700 shadow-[0_6px_20px_rgba(225,29,72,0.38)] ${ring}`;
    case "orange":
      return `${bold} bg-gradient-to-br from-waka-500 to-waka-700 shadow-[0_6px_24px_rgba(234,88,12,0.38)] ${ring}`;
    case "blue":
      return `${bold} bg-gradient-to-br from-sky-500 to-sky-700 shadow-[0_6px_20px_rgba(2,132,199,0.38)] ${ring}`;
    case "green":
      return `${bold} bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_6px_20px_rgba(5,150,105,0.38)] ${ring}`;
    case "purple":
      return `${bold} bg-gradient-to-br from-violet-500 to-violet-700 shadow-[0_6px_20px_rgba(124,58,237,0.38)] ${ring}`;
    default:
      return `border-border/90 bg-gradient-to-br from-white to-muted text-foreground shadow-sm ${featured ? "ring-2 ring-border/80" : ""}`;
  }
}

export function shelfTileSurfaceStyle(
  shelf: Pick<PosShelfDisplayCard, "color" | "customColor" | "featured">,
): CSSProperties | undefined {
  if (!shelf.customColor) return undefined;
  const bold = launcherBoldTileColorStyle(shelf.customColor, shelf.featured);
  return {
    background: bold.background,
    borderColor: bold.borderColor,
    color: bold.color,
    boxShadow: bold.boxShadow,
  };
}

export function clearShelfScaleOverrides(
  layout: Record<string, PosShelfLayoutConfig>,
): Record<string, PosShelfLayoutConfig> {
  const out: Record<string, PosShelfLayoutConfig> = {};
  for (const [key, cfg] of Object.entries(layout)) {
    const { scale: _scale, size: _size, ...rest } = cfg;
    out[key] = rest;
  }
  return out;
}

/** Tailwind grid span classes for masonry shelf grid. */
export function shelfGridSpanClass(size: PosShelfSize): string {
  switch (size) {
    case "large":
      return "col-span-2 row-span-2 sm:col-span-2 sm:row-span-2 lg:col-span-2 lg:row-span-2";
    case "medium":
      return "col-span-2 row-span-1 sm:col-span-2 sm:row-span-1 lg:col-span-2 lg:row-span-1";
    default:
      return "col-span-1 row-span-1";
  }
}

/** Uniform catalog grid for mobile (4-col) and enterprise desktop sell (5-col). */
export function sellCatalogGridClass(desktop = false): string {
  if (desktop) {
    return "grid grid-cols-5 gap-2 lg:gap-2.5";
  }
  return "grid grid-cols-4 gap-2 sm:gap-2.5";
}

/** Icon circle background from shelf color preset. */
export function shelfIconCircleClass(color: PosShelfColor): string {
  switch (color) {
    case "red":
      return "bg-rose-100 text-rose-700";
    case "orange":
      return "bg-waka-100 text-waka-700";
    case "blue":
      return "bg-sky-100 text-sky-700";
    case "green":
      return "bg-emerald-100 text-emerald-700";
    case "purple":
      return "bg-violet-100 text-violet-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Shared masonry grid: fixed row tracks so row-span-2 large tiles get real height. */
export function shelfMasonryGridClass(sellFocusedMobile = false): string {
  if (sellFocusedMobile) {
    return "grid grid-flow-dense auto-rows-[7.5rem] grid-cols-2 items-stretch gap-3 sm:auto-rows-[5.75rem] sm:grid-cols-3 sm:gap-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
  }
  return "grid grid-flow-dense auto-rows-[5.5rem] grid-cols-2 items-stretch gap-2 sm:auto-rows-[5.75rem] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
}

export function shelfMinHeightClass(_size: PosShelfSize): string {
  return "h-full min-h-0";
}

export function shelfPaddingClass(size: PosShelfSize): string {
  switch (size) {
    case "large":
      return "p-3.5 sm:p-4";
    case "medium":
      return "p-3";
    default:
      return "p-2.5";
  }
}

export function shelfIconClass(size: PosShelfSize): string {
  switch (size) {
    case "large":
      return "text-[2.75rem] leading-none sm:text-5xl";
    case "medium":
      return "text-3xl leading-none sm:text-4xl";
    default:
      return "text-xl leading-none sm:text-2xl";
  }
}

export function shelfTitleClass(size: PosShelfSize): string {
  switch (size) {
    case "large":
      return "text-xl font-black leading-[1.05] sm:text-2xl lg:text-[1.65rem]";
    case "medium":
      return "text-base font-black leading-tight sm:text-lg lg:text-xl";
    default:
      return "text-xs font-black leading-tight sm:text-sm";
  }
}

export function shelfCountClass(size: PosShelfSize): string {
  switch (size) {
    case "large":
      return "text-xs font-bold opacity-80 sm:text-sm";
    case "medium":
      return "text-[11px] font-bold opacity-75 sm:text-xs";
    default:
      return "text-[10px] font-bold opacity-70 sm:text-[11px]";
  }
}

export function updateShelfLayoutEntry(
  layout: Record<string, PosShelfLayoutConfig>,
  key: string,
  patch: Partial<PosShelfLayoutConfig>,
): Record<string, PosShelfLayoutConfig> {
  const prev = layout[key] ?? {};
  const next: PosShelfLayoutConfig = { ...prev, ...patch };
  if (patch.badge === null) next.badge = null;
  if ("customColor" in patch && patch.customColor === undefined) delete next.customColor;
  return { ...layout, [key]: next };
}

export function effectiveShelfOrderWithQuickSell(orderKeys: string[], hasQuickSell: boolean): string[] {
  if (!hasQuickSell) return orderKeys.filter((k) => k !== QUICK_SELL_SHELF_KEY);
  const without = orderKeys.filter((k) => k !== QUICK_SELL_SHELF_KEY);
  return [QUICK_SELL_SHELF_KEY, ...without];
}

export { effectiveShelfOrderKeys, reorderShelfKeys } from "./posShelfOrder";
