import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { InvestigationCategory, InvestigationKpiId, InvestigationTab } from "../types";
import { INVESTIGATION_TABS } from "../types";

function parseTab(raw: string | null): InvestigationTab {
  if (raw && INVESTIGATION_TABS.includes(raw as InvestigationTab)) return raw as InvestigationTab;
  return "timeline";
}

function parseCategory(raw: string | null): InvestigationCategory {
  const allowed: InvestigationCategory[] = [
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
  if (raw && allowed.includes(raw as InvestigationCategory)) return raw as InvestigationCategory;
  return "all";
}

function parseKpi(raw: string | null): InvestigationKpiId | null {
  const allowed: InvestigationKpiId[] = [
    "activities_today",
    "sales",
    "inventory",
    "security",
    "warnings",
    "errors",
    "failed_syncs",
    "refunds",
  ];
  if (raw && allowed.includes(raw as InvestigationKpiId)) return raw as InvestigationKpiId;
  return null;
}

export function useInvestigationCenter() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = parseTab(searchParams.get("tab"));
  const category = parseCategory(searchParams.get("category"));
  const activeKpi = parseKpi(searchParams.get("kpi"));

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
