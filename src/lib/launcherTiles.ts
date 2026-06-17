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
import { reorderShelfKeys } from "./posShelfOrder";

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
    to: "/pos",
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
    id: "customers",
    labelKey: "desktopHomeTileCustomers",
    to: "/customers",
    Icon: Users,
    perm: "customers.view",
    group: "operational",
    hideable: true,
  },
  {
    id: "backOffice",
    labelKey: "desktopHomeTileBackOffice",
    to: "/office",
    Icon: Briefcase,
    perm: "back_office.access",
    group: "operational",
    hideable: true,
  },
  {
    id: "cash",
    labelKey: "desktopHomeTileCash",
    to: "/office/cash-position",
    Icon: Banknote,
    perm: "day.close",
    group: "operational",
    hideable: true,
  },
  {
    id: "salesHistory",
    labelKey: "receipts",
    to: "/receipts",
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

export const DEFAULT_LAUNCHER_TILE_ORDER = LAUNCHER_TILE_CATALOG.filter((t) => t.group !== "primary").map(
  (t) => t.id,
);

export type ResolvedLauncherTile = LauncherTileDef & {
  color: LauncherTileColor;
  pinned: boolean;
  badge?: number;
};

export function normalizeLauncherTileLayout(raw: unknown): Record<string, LauncherTileConfig> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, LauncherTileConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key).trim().slice(0, 40);
    if (!k || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const entry: LauncherTileConfig = {};
    if (typeof v.hidden === "boolean") entry.hidden = v.hidden;
    if (typeof v.pinned === "boolean") entry.pinned = v.pinned;
    const colors = ["default", "red", "orange", "blue", "green", "purple"] as const;
    if (typeof v.color === "string" && (colors as readonly string[]).includes(v.color)) {
      entry.color = v.color as LauncherTileColor;
    }
    out[k] = entry;
  }
  return out;
}

export function effectiveLauncherTileOrder(savedOrder: string[], visibleIds: string[]): string[] {
  const ordered = savedOrder.filter((id) => visibleIds.includes(id));
  const rest = visibleIds.filter((id) => !ordered.includes(id));
  const catalogOrder = DEFAULT_LAUNCHER_TILE_ORDER;
  rest.sort((a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b));
  return [...ordered, ...rest];
}

export function resolveLauncherTiles(params: {
  catalog: LauncherTileDef[];
  savedOrder: string[];
  layout: Record<string, LauncherTileConfig>;
  hasPermission: (perm?: Permission) => boolean;
  badges?: Record<string, number | undefined>;
}): { hero: ResolvedLauncherTile | null; pinned: ResolvedLauncherTile[]; operational: ResolvedLauncherTile[]; management: ResolvedLauncherTile[] } {
  const visible = params.catalog.filter((tile) => !tile.perm || params.hasPermission(tile.perm));
  const heroDef = visible.find((t) => t.id === "sell") ?? null;

  const secondaryIds = visible
    .filter((t) => t.group !== "primary")
    .filter((t) => !params.layout[t.id]?.hidden)
    .map((t) => t.id);

  const order = effectiveLauncherTileOrder(params.savedOrder, secondaryIds);

  const resolveOne = (def: LauncherTileDef): ResolvedLauncherTile => {
    const cfg = params.layout[def.id];
    return {
      ...def,
      color: cfg?.color ?? "default",
      pinned: Boolean(cfg?.pinned),
      badge: params.badges?.[def.id],
    };
  };

  const secondary = order.map((id) => visible.find((t) => t.id === id)).filter((t): t is LauncherTileDef => Boolean(t));

  const pinned = secondary.filter((t) => params.layout[t.id]?.pinned).map(resolveOne);
  const unpinned = secondary.filter((t) => !params.layout[t.id]?.pinned).map(resolveOne);

  return {
    hero: heroDef ? resolveOne(heroDef) : null,
    pinned,
    operational: unpinned.filter((t) => t.group === "operational"),
    management: unpinned.filter((t) => t.group === "management"),
  };
}

export function launcherTileColorClasses(color: LauncherTileColor, pinned: boolean): string {
  const ring = pinned ? "ring-1 ring-inset ring-waka-400/60" : "";
  switch (color) {
    case "red":
      return `border-rose-500/40 bg-gradient-to-br from-rose-950/90 to-stone-900 text-rose-50 ${ring}`;
    case "orange":
      return `border-waka-500/50 bg-gradient-to-br from-waka-950/80 to-stone-900 text-waka-50 ${ring}`;
    case "blue":
      return `border-sky-500/40 bg-gradient-to-br from-sky-950/90 to-stone-900 text-sky-50 ${ring}`;
    case "green":
      return `border-emerald-500/40 bg-gradient-to-br from-emerald-950/90 to-stone-900 text-emerald-50 ${ring}`;
    case "purple":
      return `border-violet-500/40 bg-gradient-to-br from-violet-950/90 to-stone-900 text-violet-50 ${ring}`;
    default:
      return `border-stone-600/50 bg-stone-800/95 text-stone-50 ${pinned ? "ring-waka-500/40" : ""}`;
  }
}

export function reorderLauncherTiles(orderKeys: string[], activeKey: string, overKey: string): string[] {
  return reorderShelfKeys(orderKeys, activeKey, overKey);
}

export function updateLauncherTileLayout(
  layout: Record<string, LauncherTileConfig>,
  tileId: string,
  patch: Partial<LauncherTileConfig>,
): Record<string, LauncherTileConfig> {
  return { ...layout, [tileId]: { ...layout[tileId], ...patch } };
}
