import { useDeferredValue } from "react";
import type { Sale } from "../types";
import { usePosStore } from "../store/usePosStore";

/** Keeps typing responsive while large `sales` arrays recompute summaries. */
export function useDeferredSales(): Sale[] {
  const sales = usePosStore((s) => s.sales);
  return useDeferredValue(sales);
}
