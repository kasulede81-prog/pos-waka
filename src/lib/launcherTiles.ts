import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Search,
  Banknote,
  Settings,
  Briefcase,
  Receipt,
} from "lucide-react";
import type { LauncherTileColor, LauncherTileConfig, Permission } from "../types";
import { POS_RECEIPTS_ROUTE, POS_SELL_ROUTE, POS_SHOP_ROUTE } from "./posNavigation";
import { reorderShelfKeys } from "./posShelfOrder";
import {
  clampShelfScale,
  scaleToShelfSize,
  shelfGridSpanFromScale,
  shelfGridSpanStyle,
  shelfTypographyFromScale,
} from "./posShelfLayout";
import { normalizeShelfHex, launcherBoldTileColorStyle } from "./shelfColor";

export type LauncherTileGroup = "operational" | "management";

export type LauncherTileDef = {
  id: string;
  labelKey: string;
  to: string;
  Icon: LucideIcon;
  perm?: Permission;
  group: LauncherTileGroup | "primary";
  /** Sell cannot be hidden. */
  hideable: boolean;
};

export const LAUNCHER_TILE_CATALOG: LauncherTileDef[] = [
  {
    id: "sell",
    labelKey: "desktopHomeTileSell",
    to: POS_SELL_ROUTE,
    Icon: ShoppingCart,
    perm: "pos.sell",
    group: "primary",
    hideable: false,
  },
  {
    id: "inventory",
    labelKey: "desktopHomeTileInventory",
    to: "/stock",
    Icon: Package,
    perm: "stock.view",
    group: "operational",
    hideable: true,
  },
  {
    id: "debts",
    labelKey: "debts",
    to: "/debts",
    Icon: Users,
    perm: "customers.view",
    group: "operational",
    hideable: true,
  },
  {
    id: "shop",
    labelKey: "desktopHomeTileShop",
    to: POS_SHOP_ROUTE,
    Icon: Briefcase,
    perm: "back_office.access",
    group: "operational",
    hideable: true,
  },
  {
    id: "cash",
    labelKey: "desktopHomeTileCash",
    to: "/office/cash-drawer",
    Icon: Banknote,
    perm: "day.close",
    group: "operational",
    hideable: true,
  },
  {
    id: "salesHistory",
    labelKey: "receipts",
    to: POS_RECEIPTS_ROUTE,
    Icon: Receipt,
    perm: "receipts.view",
    group: "operational",
    hideable: true,
  },
  {
    id: "reports",
    labelKey: "desktopHomeTileReports",
    to: "/reports",
    Icon: BarChart3,
    perm: "reports.view",
    group: "management",
    hideable: true,
  },
  {
    id: "investigation",
    labelKey: "desktopHomeTileInvestigation",
    to: "/office/audit-center",
    Icon: Search,
    perm: "owner.activity",
    group: "management",
    hideable: true,
  },
  {
    id: "settings",
    labelKey: "desktopHomeTileSettings",
    to: "/settings",
    Icon: Settings,
    perm: "settings.view",
    group: "management",
    hideable: true,
  },
];

export const DEFAULT_LAUNCHER_TILE_ORDER: LauncherTileDef["id"][] = [
  "inventory",
  "debts",
  "cash",
  "investigation",
  "salesHistory",
  "shop",
  "reports",
  "settings",
];

/** Branded home menu defaults — merged under saved layout; user edits override per tile. */
export const DEFAULT_LAUNCHER_TILE_LAYOUT: Record<string, LauncherTileConfig> = {
  inventory: { color: "purple", customColor: "#db2777" },
  debts: { color: "purple" },
  cash: { color: "blue" },
  investigation: { color: "red" },
  salesHistory: { color: "green" },
  shop: { color: "orange" },
  reports: { color: "green", customColor: "#0d9488", scale: 50 },
  settings: { color: "orange" },
};

export function mergeLauncherTileLayout(
  saved: Record<string, LauncherTileConfig>,
): Record<string, LauncherTileConfig> {
  const merged: Record<string, LauncherTileConfig> = {};
  for (const [id, cfg] of Object.entries(DEFAULT_LAUNCHER_TILE_LAYOUT)) {
    merged[id] = { ...cfg };
  }
  for (const [key, value] of Object.entries(saved)) {
    const id = migrateLauncherTileId(key);
    merged[id] = { ...merged[id], ...value };
  }
  return merged;
}

export type ResolvedLauncherTile = LauncherTileDef & {
  color: LauncherTileColor;
  pinned: boolean;
  badge?: number;
};

export type ResolvedHomeTile = LauncherTileDef & {
  color: LauncherTileColor;
  customColor: string | null;
  scale: number;
  pinned: boolean;
  hidden: boolean;
  badge?: number;
};

const LAUNCHER_COLORS: LauncherTileColor[] = ["default", "red", "orange", "blue", "green", "purple"];

export function migrateLauncherTileId(id: string): string {
  return id === "backOffice" ? "shop" : id;
}

export function launcherTileLayoutEntry(
  layout: Record<string, LauncherTileConfig>,
  tileId: string,
): LauncherTileConfig | undefined {
  if (layout[tileId]) return layout[tileId];
  if (tileId === "shop" && layout.backOffice) return layout.backOffice;
  return undefined;
}

export function normalizeLauncherTileLayout(raw: unknown): Record<string, LauncherTileConfig> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, LauncherTileConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = migrateLauncherTileId(String(key).trim().slice(0, 40));
    if (!k || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const entry: LauncherTileConfig = {};
    if (typeof v.hidden === "boolean") entry.hidden = v.hidden;
    if (typeof v.pinned === "boolean") entry.pinned = v.pinned;
    if (typeof v.color === "string" && (LAUNCHER_COLORS as readonly string[]).includes(v.color)) {
      entry.color = v.color as LauncherTileColor;
    }
    if (typeof v.scale === "number" && Number.isFinite(v.scale)) {
      entry.scale = clampShelfScale(v.scale);
    }
    if (v.customColor === null) {
      entry.customColor = null;
    } else if (typeof v.customColor === "string") {
      const hex = normalizeShelfHex(v.customColor);
      if (hex) entry.customColor = hex;
    }
    out[k] = { ...out[k], ...entry };
  }
  return out;
}

export function launcherScaleFromConfig(config?: LauncherTileConfig): number {
  if (typeof config?.scale === "number" && Number.isFinite(config.scale)) {
    return clampShelfScale(config.scale);
  }
  return 35;
}

export function launcherMasonryGridClass(): string {
  return "grid grid-flow-dense auto-rows-[6.5rem] grid-cols-2 gap-3 sm:auto-rows-[7rem] lg:grid-cols-4";
}

export function launcherTileColorClasses(color: LauncherTileColor, pinned: boolean): string {
  const ring = pinned ? "ring-2 ring-inset ring-white/40" : "";
  const bold =
    "border-white/30 text-white shadow-md hover:brightness-110 hover:shadow-lg active:scale-[0.98]";
  switch (color) {
    case "red":
      return `${bold} bg-gradient-to-br from-rose-500 to-rose-700 shadow-[0_8px_24px_rgba(225,29,72,0.42)] ${ring}`;
    case "orange":
      return `${bold} bg-gradient-to-br from-waka-500 to-waka-700 shadow-[0_8px_32px_rgba(234,88,12,0.4)] ${ring}`;
    case "blue":
      return `${bold} bg-gradient-to-br from-sky-500 to-sky-700 shadow-[0_8px_24px_rgba(2,132,199,0.42)] ${ring}`;
    case "green":
      return `${bold} bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_8px_24px_rgba(5,150,105,0.42)] ${ring}`;
    case "purple":
      return `${bold} bg-gradient-to-br from-violet-500 to-violet-700 shadow-[0_8px_24px_rgba(124,58,237,0.42)] ${ring}`;
    default:
      return `border-waka-200/90 bg-white text-waka-950 shadow-waka-sm hover:border-waka-400 hover:bg-waka-50/80 ${pinned ? "ring-2 ring-waka-300" : ""}`;
  }
}

export function launcherTileSurfaceStyle(tile: Pick<ResolvedHomeTile, "color" | "customColor" | "pinned">): CSSProperties | undefined {
  if (!tile.customColor) return undefined;
  const bold = launcherBoldTileColorStyle(tile.customColor, tile.pinned);
  return {
    background: bold.background,
    borderColor: bold.borderColor,
    color: bold.color,
    boxShadow: bold.boxShadow,
  };
}

export {
  clampShelfScale,
  scaleToShelfSize,
  shelfGridSpanFromScale,
  shelfGridSpanStyle,
  shelfTypographyFromScale,
};

export function effectiveLauncherTileOrder(savedOrder: string[], visibleIds: string[]): string[] {
  const migrated = savedOrder.map(migrateLauncherTileId);
  const ordered = migrated.filter((id) => visibleIds.includes(id));
  const rest = visibleIds.filter((id) => !ordered.includes(id));
  const catalogOrder = DEFAULT_LAUNCHER_TILE_ORDER;
  rest.sort((a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b));
  return [...ordered, ...rest];
}

export function resolveHomeMenuTiles(params: {
  savedOrder: string[];
  layout: Record<string, LauncherTileConfig>;
  hasPermission: (perm?: Permission) => boolean;
  badges?: Record<string, number | undefined>;
  /** When true, include hidden tiles (settings arrange preview). */
  includeHidden?: boolean;
}): { hero: ResolvedHomeTile | null; secondary: ResolvedHomeTile[] } {
  const effectiveLayout = mergeLauncherTileLayout(params.layout);
  const visible = LAUNCHER_TILE_CATALOG.filter((tile) => !tile.perm || params.hasPermission(tile.perm));
  const heroDef = visible.find((t) => t.id === "sell") ?? null;
  const secondaryDefs = visible.filter((t) => t.group !== "primary");

  const secondaryIds = secondaryDefs
    .filter((t) => params.includeHidden || !launcherTileLayoutEntry(effectiveLayout, t.id)?.hidden)
    .map((t) => t.id);

  const arrangeIds = secondaryDefs.map((t) => t.id);
  const order = effectiveLauncherTileOrder(params.savedOrder, params.includeHidden ? arrangeIds : secondaryIds);

  const resolveOne = (def: LauncherTileDef): ResolvedHomeTile => {
    const cfg = launcherTileLayoutEntry(effectiveLayout, def.id);
    return {
      ...def,
      color: cfg?.color ?? "default",
      customColor: cfg?.customColor ?? null,
      scale: launcherScaleFromConfig(cfg),
      pinned: Boolean(cfg?.pinned),
      hidden: Boolean(cfg?.hidden),
      badge: params.badges?.[def.id],
    };
  };

  return {
    hero: heroDef ? resolveOne(heroDef) : null,
    secondary: order
      .map((id) => secondaryDefs.find((t) => t.id === id))
      .filter((t): t is LauncherTileDef => Boolean(t))
      .map(resolveOne),
  };
}

export function resolveLauncherTiles(params: {
  catalog: LauncherTileDef[];
  savedOrder: string[];
  layout: Record<string, LauncherTileConfig>;
  hasPermission: (perm?: Permission) => boolean;
  badges?: Record<string, number | undefined>;
}): { hero: ResolvedLauncherTile | null; pinned: ResolvedLauncherTile[]; operational: ResolvedLauncherTile[]; management: ResolvedLauncherTile[] } {
  const { hero, secondary } = resolveHomeMenuTiles({
    savedOrder: params.savedOrder,
    layout: params.layout,
    hasPermission: params.hasPermission,
    badges: params.badges,
  });

  const resolveLegacy = (tile: ResolvedHomeTile): ResolvedLauncherTile => ({
    id: tile.id,
    labelKey: tile.labelKey,
    to: tile.to,
    Icon: tile.Icon,
    perm: tile.perm,
    group: tile.group,
    hideable: tile.hideable,
    color: tile.color,
    pinned: tile.pinned,
    badge: tile.badge,
  });

  const pinned = secondary.filter((t) => t.pinned).map(resolveLegacy);
  const unpinned = secondary.filter((t) => !t.pinned).map(resolveLegacy);

  return {
    hero: hero ? resolveLegacy(hero) : null,
    pinned,
    operational: unpinned.filter((t) => t.group === "operational"),
    management: unpinned.filter((t) => t.group === "management"),
  };
}

export function reorderLauncherTiles(orderKeys: string[], activeKey: string, overKey: string): string[] {
  return reorderShelfKeys(orderKeys, activeKey, overKey);
}

export function updateLauncherTileLayout(
  layout: Record<string, LauncherTileConfig>,
  tileId: string,
  patch: Partial<LauncherTileConfig>,
): Record<string, LauncherTileConfig> {
  const id = migrateLauncherTileId(tileId);
  const next = { ...layout[id], ...patch };
  if (id === "shop" && layout.backOffice) {
    const { backOffice: _removed, ...rest } = layout;
    return { ...rest, [id]: next };
  }
  return { ...layout, [id]: next };
}
