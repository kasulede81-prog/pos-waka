import type { AuditLogEntry } from "../../../types";
import { InvestigationComplianceSection } from "../components/InvestigationComplianceSection";
import { InvestigationPharmacyKpiGrid } from "../components/InvestigationPharmacyKpiGrid";
import {
  pharmacyInvestigationTimelineSubtitle,
  pharmacyInvestigationTimelineTitle,
} from "../extensions/pharmacy/pharmacyTimelinePresentation";
import { PHARMACY_INVESTIGATION_CATEGORIES } from "../extensions/pharmacy/pharmacyCategoryActions";
import type { InvestigationCategory, InvestigationTab } from "../types";
import { INVESTIGATION_TABS_WITH_COMPLIANCE } from "../types";
import type { InvestigationWidgetDef, InvestigationWidgetProps, TimelinePresentation } from "./investigationWidgetTypes";

function PharmacyKpiGridWidget({ ctx }: InvestigationWidgetProps) {
  if (ctx.pharmacyKpiCards.length === 0) return null;
  return (
    <InvestigationPharmacyKpiGrid
      lang={ctx.lang}
      cards={ctx.pharmacyKpiCards}
      activeKpi={ctx.pharmacyKpi}
      periodLabel={ctx.periodLabel}
      onSelect={ctx.handlePharmacyKpiSelect}
    />
  );
}

function PharmacyComplianceWidget({ ctx }: InvestigationWidgetProps) {
  return <InvestigationComplianceSection lang={ctx.lang} register={ctx.pharmacyRegister} />;
}

export function pharmacyTimelinePresentation(
  lang: InvestigationWidgetProps["ctx"]["lang"],
  entry: AuditLogEntry,
  productById: Map<string, { name: string }>,
): TimelinePresentation | null {
  const titleOverride = pharmacyInvestigationTimelineTitle(lang, entry);
  const subtitleOverride = pharmacyInvestigationTimelineSubtitle(lang, entry, productById);
  if (!titleOverride && !subtitleOverride) return null;
  return { titleOverride, subtitleOverride };
}

export const PHARMACY_INVESTIGATION_TABS: InvestigationTab[] = INVESTIGATION_TABS_WITH_COMPLIANCE;

export const PHARMACY_INVESTIGATION_ACCENT_CATEGORIES = new Set<InvestigationCategory>(
  PHARMACY_INVESTIGATION_CATEGORIES,
);

/** Pharmacy investigation extensions — composed into the shared Enterprise shell. */
export const PHARMACY_INVESTIGATION_WIDGETS: InvestigationWidgetDef[] = [
  {
    id: "pharmacy-kpi-grid",
    slot: "kpi-grid",
    priority: 200,
    businessTypes: ["pharmacy"],
    Component: PharmacyKpiGridWidget,
  },
  {
    id: "pharmacy-compliance-panel",
    slot: "compliance",
    priority: 100,
    businessTypes: ["pharmacy"],
    visible: (ctx) => ctx.tab === "compliance",
    Component: PharmacyComplianceWidget,
  },
];
