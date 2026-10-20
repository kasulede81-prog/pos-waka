import { usePosStore } from "../store/usePosStore";
import { getHospitalityLowStockPolicyRevision } from "../lib/lowStockPolicyContext";

/**
 * Re-render/memo key for surfaces whose low-stock result depends on the saved
 * Hospitality ingredient policy. Selects only the settings that can change the
 * effective threshold; the revision changes only when the effective policy does.
 */
export function useHospitalityLowStockPolicyRevision(): number {
  usePosStore((s) => s.preferences.businessType);
  usePosStore((s) => s.preferences.hospitalityModeEnabled);
  usePosStore((s) => s.preferences.hospitalityIngredientPolicy);
  return getHospitalityLowStockPolicyRevision();
}
