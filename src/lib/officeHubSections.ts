import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Cloud,
  HelpCircle,
  Settings,
  Sun,
} from "lucide-react";
import type { LauncherTileColor, LauncherTileConfig } from "../types";
import { reorderShelfKeys } from "./posShelfOrder";
import { normalizeLauncherTileLayout, launcherTileLayoutEntry } from "./launcherTiles";

export type OfficeHubSectionId = "daily" | "insights" | "shop-control" | "data" | "help";

export type OfficeHubSectionDef = {
  id: OfficeHubSectionId;
  titleKey:
    | "officeSectionDaily"
    | "officeSectionInsights"
    | "officeSectionShopControl"
    | "officeSectionData"
    | "officeSectionHelp";
  subKey:
    | "officeSectionDailySub"
    | "officeSectionInsightsSub"
    | "officeSectionShopControlSub"
    | "officeSectionDataSub"
    | "officeSectionHelpSub";
  Icon: LucideIcon;
};

export const OFFICE_HUB_SECTIONS: OfficeHubSectionDef[] = [
  { id: "daily", titleKey: "officeSectionDaily", subKey: "officeSectionDailySub", Icon: Sun },
  { id: "insights", titleKey: "officeSectionInsights", subKey: "officeSectionInsightsSub", Icon: BarChart3 },
  { id: "shop-control", titleKey: "officeSectionShopControl", subKey: "officeSectionShopControlSub", Icon: Settings },
  { id: "data", titleKey: "officeSectionData", subKey: "officeSectionDataSub", Icon: Cloud },
  { id: "help", titleKey: "officeSectionHelp", subKey: "officeSectionHelpSub", Icon: HelpCircle },
];

export const DEFAULT_OFFICE_HUB_TILE_ORDER = OFFICE_HUB_SECTIONS.map((s) => s.id);

export type ResolvedOfficeHubSection = OfficeHubSectionDef & {
  color: LauncherTileColor;
  customColor: string | null;
  hidden: boolean;
};

export function isOfficeHubSectionId(value: string | undefined): value is OfficeHubSectionId {
  return OFFICE_HUB_SECTIONS.some((s) => s.id === value);
}

export function officeHubSectionPath(id: OfficeHubSectionId): string {
  return `/office/section/${id}`;
}

export function normalizeOfficeHubTileLayout(raw: unknown): Record<string, LauncherTileConfig> {
  return normalizeLauncherTileLayout(raw);
}

export function effectiveOfficeHubTileOrder(savedOrder: string[], visibleIds: string[]): string[] {
  const ordered = savedOrder.filter((id) => visibleIds.includes(id));
  const rest = visibleIds.filter((id) => !ordered.includes(id));
  const catalogOrder = DEFAULT_OFFICE_HUB_TILE_ORDER;
  rest.sort((a, b) => catalogOrder.indexOf(a as OfficeHubSectionId) - catalogOrder.indexOf(b as OfficeHubSectionId));
  return [...ordered, ...rest];
}

export function resolveOfficeHubSections(params: {
  savedOrder: string[];
  layout: Record<string, LauncherTileConfig>;
  sectionVisible: Record<OfficeHubSectionId, boolean>;
  /** When true, include hidden tiles (settings arrange preview). */
  includeHidden?: boolean;
}): ResolvedOfficeHubSection[] {
  const permitted = OFFICE_HUB_SECTIONS.filter((s) => params.sectionVisible[s.id]);
  const hubIds = permitted
    .filter((s) => params.includeHidden || !launcherTileLayoutEntry(params.layout, s.id)?.hidden)
    .map((s) => s.id);

  const order = effectiveOfficeHubTileOrder(params.savedOrder, hubIds);

  return order
    .map((id) => permitted.find((s) => s.id === id))
    .filter((s): s is OfficeHubSectionDef => Boolean(s))
    .map((def) => {
      const cfg = launcherTileLayoutEntry(params.layout, def.id);
      return {
        ...def,
        color: cfg?.color ?? "orange",
        customColor: cfg?.customColor ?? null,
        hidden: Boolean(cfg?.hidden),
      };
    });
}

export function reorderOfficeHubTiles(orderKeys: string[], activeKey: string, overKey: string): string[] {
  return reorderShelfKeys(orderKeys, activeKey, overKey);
}

export function updateOfficeHubTileLayout(
  layout: Record<string, LauncherTileConfig>,
  tileId: string,
  patch: Partial<LauncherTileConfig>,
): Record<string, LauncherTileConfig> {
  return { ...layout, [tileId]: { ...layout[tileId], ...patch } };
}
