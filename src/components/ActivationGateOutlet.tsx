import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useActivation, pathAllowedWhenActivationLocked } from "../context/ActivationContext";

/**
 * When the shop is not commercially activated, only marketing/support/demo/activate paths pass through.
 * Internal Waka staff bypass via ActivationProvider.
 */
export function ActivationGateOutlet() {
  const location = useLocation();
  const { loading, unlocked, bypass } = useActivation();

  if (loading && !bypass) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 bg-gradient-to-b from-waka-50 to-muted px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-waka-200 border-t-orange-600" aria-hidden />
        <p className="text-sm font-semibold text-muted-foreground">Checking activation…</p>
      </div>
    );
  }

  if (unlocked) return <Outlet />;

  const path = location.pathname.split("?")[0] || "/";
  if (pathAllowedWhenActivationLocked(path)) return <Outlet />;

  return <Navigate to="/activate" replace state={{ from: location.pathname }} />;
}
