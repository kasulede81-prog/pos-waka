import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { AnalyticsCategory } from "../types";
import { ANALYTICS_CATEGORIES } from "../types";

function parseCategory(raw: string | null, legacyTab: string | null): AnalyticsCategory {
  if (raw && ANALYTICS_CATEGORIES.includes(raw as AnalyticsCategory)) return raw as AnalyticsCategory;
  if (legacyTab === "profit") return "profit";
  if (legacyTab === "monthly") return "performance";
  if (legacyTab === "products") return "products";
  if (legacyTab === "summary") return "overview";
  return "overview";
}

export function useBusinessAnalyticsCategory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = parseCategory(searchParams.get("category"), searchParams.get("tab"));

  const setCategory = useCallback(
    (next: AnalyticsCategory) => {
      const params = new URLSearchParams(searchParams);
      if (next === "overview") params.delete("category");
      else params.set("category", next);
      params.delete("tab");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return useMemo(() => ({ category, setCategory }), [category, setCategory]);
}
