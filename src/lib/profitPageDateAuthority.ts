/**
 * RPT-P2-06 — ProfitPage date authority.
 *
 * Embedded Reports tab: parent DateFilterValue is authoritative.
 * Standalone /office/profit: ProfitPage keeps its own filter.
 */

import { resolveDateFilterBounds, type DateFilterBounds, type DateFilterValue } from "./dateFilters";

export function resolveProfitPageDateAuthority(input: {
  controlledFilter?: DateFilterValue | null;
  localFilter: DateFilterValue;
}): { filter: DateFilterValue; bounds: DateFilterBounds; controlled: boolean } {
  if (input.controlledFilter != null) {
    return {
      filter: input.controlledFilter,
      bounds: resolveDateFilterBounds(input.controlledFilter),
      controlled: true,
    };
  }
  return {
    filter: input.localFilter,
    bounds: resolveDateFilterBounds(input.localFilter),
    controlled: false,
  };
}
