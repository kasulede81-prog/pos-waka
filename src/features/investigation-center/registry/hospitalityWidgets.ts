import type { InvestigationWidgetDef } from "./investigationWidgetTypes";

function HospitalityPlaceholderWidget() {
  return null;
}

/** Hospitality investigation placeholders — registered for future extension. */
export const HOSPITALITY_INVESTIGATION_WIDGETS: InvestigationWidgetDef[] = [
  {
    id: "hospitality-kitchen-events",
    slot: "timeline-categories",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-waiter-activity",
    slot: "reports",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-table-actions",
    slot: "timeline",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-discount-overrides",
    slot: "alerts",
    priority: 900,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-kitchen-overrides",
    slot: "alerts",
    priority: 910,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
  {
    id: "hospitality-reservations",
    slot: "reports",
    priority: 910,
    businessTypes: ["hospitality"],
    visible: () => false,
    Component: HospitalityPlaceholderWidget,
  },
];
