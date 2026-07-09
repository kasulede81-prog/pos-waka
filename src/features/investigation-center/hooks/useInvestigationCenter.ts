import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { InvestigationCategory, InvestigationKpiId, InvestigationTab, PharmacyInvestigationKpiId } from "../types";
import { INVESTIGATION_TABS, INVESTIGATION_TABS_WITH_COMPLIANCE } from "../types";
import { isPharmacyInvestigationKpiId } from "../extensions/pharmacy/computePharmacyInvestigationKpis";
import { isPharmacyInvestigationCategory } from "../extensions/pharmacy/pharmacyCategoryActions";

const SHARED_CATEGORIES: InvestigationCategory[] = [
  "all",
  "sales",
  "inventory",
  "products",
  "purchases",
  "suppliers",
  "customers",
  "debts",
  "payments",
  "expenses",
  "cash_drawer",
  "refunds",
  "discounts",
  "price_changes",
  "returns",
  "authentication",
  "security",
  "users",
  "permissions",
  "settings",
  "cloud_sync",
  "system",
  "errors",
  "warnings",
];

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

function parseTab(raw: string | null, pharmacyMode: boolean): InvestigationTab {
  const allowed = pharmacyMode ? INVESTIGATION_TABS_WITH_COMPLIANCE : INVESTIGATION_TABS;
  if (raw && allowed.includes(raw as InvestigationTab)) return raw as InvestigationTab;
  return "timeline";
}

function parseCategory(raw: string | null, pharmacyMode: boolean): InvestigationCategory {
  if (raw && SHARED_CATEGORIES.includes(raw as InvestigationCategory)) return raw as InvestigationCategory;
  if (pharmacyMode && raw && isPharmacyInvestigationCategory(raw)) return raw;
  return "all";
}

function parseKpi(raw: string | null, pharmacyMode: boolean): InvestigationKpiId | null {
  if (raw && SHARED_KPIS.includes(raw as InvestigationKpiId)) return raw as InvestigationKpiId;
  if (pharmacyMode && raw && isPharmacyInvestigationKpiId(raw)) return raw as InvestigationKpiId;
  return null;
}

export function useInvestigationCenter(pharmacyMode = false) {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = parseTab(searchParams.get("tab"), pharmacyMode);
  const category = parseCategory(searchParams.get("category"), pharmacyMode);
  const activeKpi = parseKpi(searchParams.get("kpi"), pharmacyMode);

  const setTab = useCallback(
    (next: InvestigationTab) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setCategory = useCallback(
    (next: InvestigationCategory) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("category");
      else params.set("category", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setActiveKpi = useCallback(
    (next: InvestigationKpiId | null) => {
      const params = new URLSearchParams(searchParams);
      if (!next) params.delete("kpi");
      else params.set("kpi", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return useMemo(
    () => ({ tab, setTab, category, setCategory, activeKpi, setActiveKpi }),
    [tab, setTab, category, setCategory, activeKpi, setActiveKpi],
  );
}

export function splitActiveKpis(activeKpi: InvestigationKpiId | null): {
  sharedKpi: InvestigationKpiId | null;
  pharmacyKpi: PharmacyInvestigationKpiId | null;
} {
  if (!activeKpi) return { sharedKpi: null, pharmacyKpi: null };
  if (isPharmacyInvestigationKpiId(activeKpi)) {
    return { sharedKpi: null, pharmacyKpi: activeKpi };
  }
  return { sharedKpi: activeKpi, pharmacyKpi: null };
}
