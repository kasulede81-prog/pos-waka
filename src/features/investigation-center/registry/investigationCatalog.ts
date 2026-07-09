import type { InvestigationBusinessMode } from "./investigationWidgetTypes";
import type { InvestigationCategory, InvestigationKpiId, InvestigationTab } from "../types";
import { INVESTIGATION_CATEGORIES, INVESTIGATION_TABS } from "../types";
import { PHARMACY_INVESTIGATION_CATEGORIES, isPharmacyInvestigationCategory } from "../extensions/pharmacy/pharmacyCategoryActions";
import { isPharmacyInvestigationKpiId } from "../extensions/pharmacy/computePharmacyInvestigationKpis";
import {
  PHARMACY_INVESTIGATION_ACCENT_CATEGORIES,
  PHARMACY_INVESTIGATION_TABS,
} from "./pharmacyWidgets";

const SHARED_KPIS: InvestigationKpiId[] = [
  "activities_today",
  "sales",
  "inventory",
  "security",
  "warnings",
  "errors",
  "failed_syncs",
  "refunds",
];

export function resolveInvestigationTabs(mode: InvestigationBusinessMode): InvestigationTab[] {
  if (mode === "pharmacy") return PHARMACY_INVESTIGATION_TABS;
  return INVESTIGATION_TABS;
}

export function resolveInvestigationCategories(mode: InvestigationBusinessMode): InvestigationCategory[] {
  if (mode === "pharmacy") return [...INVESTIGATION_CATEGORIES, ...PHARMACY_INVESTIGATION_CATEGORIES];
  return INVESTIGATION_CATEGORIES;
}

export function resolveInvestigationAccentCategories(
  mode: InvestigationBusinessMode,
): ReadonlySet<InvestigationCategory> {
  if (mode === "pharmacy") return PHARMACY_INVESTIGATION_ACCENT_CATEGORIES;
  return new Set();
}

const PHARMACY_INVESTIGATION_KPI_IDS: InvestigationKpiId[] = [
  "rx_today",
  "medicines_dispensed",
  "controlled_events",
  "near_expiry",
  "expired_medicines",
  "batch_writeoffs",
  "fefo_overrides",
  "compliance_alerts",
];

export function resolveInvestigationKpiIds(mode: InvestigationBusinessMode): InvestigationKpiId[] {
  if (mode === "pharmacy") return [...SHARED_KPIS, ...PHARMACY_INVESTIGATION_KPI_IDS];
  return SHARED_KPIS;
}

export function parseInvestigationTab(raw: string | null, mode: InvestigationBusinessMode): InvestigationTab {
  const allowed = resolveInvestigationTabs(mode);
  if (raw && allowed.includes(raw as InvestigationTab)) return raw as InvestigationTab;
  return "timeline";
}

export function parseInvestigationCategory(
  raw: string | null,
  mode: InvestigationBusinessMode,
): InvestigationCategory {
  if (raw && INVESTIGATION_CATEGORIES.includes(raw as InvestigationCategory)) return raw as InvestigationCategory;
  if (mode === "pharmacy" && raw && isPharmacyInvestigationCategory(raw)) return raw;
  return "all";
}

export function parseInvestigationKpi(raw: string | null, mode: InvestigationBusinessMode): InvestigationKpiId | null {
  const allowed = resolveInvestigationKpiIds(mode);
  if (raw && allowed.includes(raw as InvestigationKpiId)) return raw as InvestigationKpiId;
  return null;
}

export function resolveKpiTabTarget(kpi: InvestigationKpiId): InvestigationTab {
  if (kpi === "refunds") return "refunds";
  if (isPharmacyInvestigationKpiId(kpi) && kpi === "compliance_alerts") return "compliance";
  return "timeline";
}
