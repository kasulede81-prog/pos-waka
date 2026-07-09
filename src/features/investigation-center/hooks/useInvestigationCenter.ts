import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { InvestigationCategory, InvestigationKpiId, InvestigationTab, PharmacyInvestigationKpiId } from "../types";
import { isPharmacyInvestigationKpiId } from "../extensions/pharmacy/computePharmacyInvestigationKpis";
import type { InvestigationBusinessMode } from "../registry/investigationWidgetTypes";
import {
  parseInvestigationCategory,
  parseInvestigationKpi,
  parseInvestigationTab,
} from "../registry/investigationCatalog";

export function useInvestigationCenter(mode: InvestigationBusinessMode) {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = parseInvestigationTab(searchParams.get("tab"), mode);
  const category = parseInvestigationCategory(searchParams.get("category"), mode);
  const activeKpi = parseInvestigationKpi(searchParams.get("kpi"), mode);

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
