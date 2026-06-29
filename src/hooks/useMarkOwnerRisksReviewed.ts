import { useEffect } from "react";
import { authorizePreferencesPatch } from "../lib/settingsAuthorization";
import { getStoreSubscriptionContext } from "../lib/storeSubscriptionContext";
import { usePosStore } from "../store/usePosStore";

/** Mark today's investigation / risk alerts as seen (clears main-menu badges). */
export function useMarkOwnerRisksReviewed(): void {
  const setPreferences = usePosStore((s) => s.setPreferences);

  useEffect(() => {
    const state = usePosStore.getState();
    const patch = { ownerRisksReviewedAt: new Date().toISOString() };
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const allowed = authorizePreferencesPatch(state.sessionActor, patch, {
      snapshot,
      authMode,
      currentStaffAccounts: state.preferences.staffAccounts ?? [],
    });
    if (!allowed.ok) return;
    setPreferences(patch);
  }, [setPreferences]);
}
