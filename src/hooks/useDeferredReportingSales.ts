import { useDeferredValue } from "react";
import type { Sale } from "../types";
import { useReportingSales } from "./useReportingSales";

/** Merged active + archived sales, deferred so toggling “include archived” does not freeze the UI. */
export function useDeferredReportingSales(includeArchived: boolean): Sale[] {
  const merged = useReportingSales(includeArchived);
  return useDeferredValue(merged);
}
