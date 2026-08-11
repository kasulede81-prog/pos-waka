import { useCallback, useState } from "react";
import { isExplicitLogoutInProgress } from "../lib/auth/enterpriseLogout";

/**
 * UI helper for logout buttons — prevents double taps and surfaces a busy flag.
 * Always delegates to the single centralized `onSignOut` (useAuth → performEnterpriseLogout).
 */
export function useLogoutAction(onSignOut: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    if (busy || isExplicitLogoutInProgress()) return;
    setBusy(true);
    void Promise.resolve(onSignOut()).catch(() => {
      setBusy(false);
    });
  }, [busy, onSignOut]);

  return { logout, loggingOut: busy };
}
