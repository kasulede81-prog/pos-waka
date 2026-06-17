import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Cloud,
  HelpCircle,
  Settings,
  Sun,
} from "lucide-react";

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

export function isOfficeHubSectionId(value: string | undefined): value is OfficeHubSectionId {
  return OFFICE_HUB_SECTIONS.some((s) => s.id === value);
}

export function officeHubSectionPath(id: OfficeHubSectionId): string {
  return `/office/section/${id}`;
}
