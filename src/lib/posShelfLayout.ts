import type { CSSProperties } from "react";
import type { PosShelfBadge, PosShelfColor, PosShelfLayoutConfig, PosShelfSize, Product } from "../types";
import { normalizeShelfHex, shelfTileColorStyle } from "./shelfColor";
import {
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  shelfIconFor,
} from "./productCategories";
import { sortPosShelfCards, type PosShelfCard } from "./posShelfOrder";

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

export function shelfScaleFromConfig(config?: PosShelfLayoutConfig, featured = false): number {
  if (typeof config?.scale === "number" && Number.isFinite(config.scale)) {
    return clampShelfScale(config.scale);
  }
  if (config?.size === "large") return 85;
  if (config?.size === "medium") return 55;
  if (config?.size === "small") return 35;
  return featured ? 85 : 35;
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
    iconRem: 1.05 + t * 2.25,
    titleRem: 0.7 + t * 1.15,
    countRem: 0.58 + t * 0.38,
    paddingRem: 0.5 + t * 0.9,
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
): PosShelfDisplayCard {
  const featured = Boolean(config?.featured);
  const scale = shelfScaleFromConfig(config, featured);
  const color = config?.color ?? (featured ? "orange" : "default");
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

export function buildPosShelfDisplayCards(
  products: Product[],
  noShelfLabel: string,
  layout: Record<string, PosShelfLayoutConfig>,
  orderKeys: string[],
): PosShelfDisplayCard[] {
  const categoryOptions = distinctTrimmedCategories(products);
  const hasUncategorized = products.some((p) => !(p.category ?? "").trim());
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

  const merged = baseCards.map((card) => mergeShelfLayout(card, layout[card.key]));
  return sortShelvesForDisplay(merged, orderKeys);
}

export function buildQuickSellShelfCard(
  productIds: string[],
  products: Product[],
  label: string,
  layout?: PosShelfLayoutConfig,
): PosShelfDisplayCard | null {
  const valid = productIds.filter((id) => products.some((p) => p.id === id));
  if (valid.length === 0) return null;
  const base: PosShelfCard = {
    key: QUICK_SELL_SHELF_KEY,
    label,
    count: valid.length,
    icon: "⚡",
  };
  const merged = mergeShelfLayout(base, {
    ...layout,
    size: layout?.size ?? "medium",
    color: layout?.color ?? "orange",
    featured: true,
    icon: layout?.icon ?? "⚡",
  });
  return { ...merged, isQuickSell: true };
}

export function shelfColorClasses(color: PosShelfColor, featured: boolean): string {
  const boost = featured ? "ring-1 ring-inset" : "";
  switch (color) {
    case "red":
      return `border-rose-300/80 bg-gradient-to-br from-rose-50 to-rose-100/90 text-rose-950 ${boost} ring-rose-200/80`;
    case "orange":
      return `border-waka-300/80 bg-gradient-to-br from-waka-50 to-orange-100/90 text-waka-950 ${boost} ring-waka-200/80`;
    case "blue":
      return `border-sky-300/80 bg-gradient-to-br from-sky-50 to-sky-100/90 text-sky-950 ${boost} ring-sky-200/80`;
    case "green":
      return `border-emerald-300/80 bg-gradient-to-br from-emerald-50 to-emerald-100/90 text-emerald-950 ${boost} ring-emerald-200/80`;
    case "purple":
      return `border-violet-300/80 bg-gradient-to-br from-violet-50 to-violet-100/90 text-violet-950 ${boost} ring-violet-200/80`;
    default:
      return `border-stone-200/90 bg-gradient-to-br from-white to-stone-50 text-stone-950 ${featured ? "ring-stone-200/80" : ""}`;
  }
}

export function shelfTileSurfaceStyle(
  shelf: Pick<PosShelfDisplayCard, "color" | "customColor" | "featured">,
): CSSProperties | undefined {
  if (!shelf.customColor) return undefined;
  return shelfTileColorStyle(shelf.customColor, shelf.featured);
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

/** Shared masonry grid: fixed row tracks so row-span-2 large tiles get real height. */
export function shelfMasonryGridClass(): string {
  return "grid grid-flow-dense auto-rows-[4.75rem] grid-cols-2 items-stretch gap-2 sm:auto-rows-[5rem] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";
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
