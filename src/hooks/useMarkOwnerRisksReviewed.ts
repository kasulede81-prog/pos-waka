import { useEffect } from "react";
import { usePosStore } from "../store/usePosStore";

/** Mark today's investigation / risk alerts as seen (clears main-menu badges). */
export function useMarkOwnerRisksReviewed(): void {
  const setPreferences = usePosStore((s) => s.setPreferences);

  useEffect(() => {
    setPreferences({ ownerRisksReviewedAt: new Date().toISOString() });
  }, [setPreferences]);
}
