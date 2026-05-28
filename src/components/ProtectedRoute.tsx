import { Navigate, Outlet, useLocation } from "react-router-dom";
import { hasLikelyPersistedSupabaseSession } from "../lib/authSessionHint";

type Props = {
  initializing: boolean;
  isAuthenticated: boolean;
};

export function ProtectedRoute({ initializing, isAuthenticated }: Props) {
  const location = useLocation();
  const likelySession = hasLikelyPersistedSupabaseSession();

  if (initializing && !likelySession && !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated && !initializing) {
    const p = location.pathname.split("?")[0] || "/";
    const to = p === "/" || p === "" ? "/home" : "/login";
    return <Navigate to={to} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
