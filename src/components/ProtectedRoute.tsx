import { Navigate, Outlet, useLocation } from "react-router-dom";
import { unauthenticatedEntryPath } from "../lib/nativeApp";

type Props = {
  initializing: boolean;
  isAuthenticated: boolean;
};

export function ProtectedRoute({ initializing, isAuthenticated }: Props) {
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#fffaf5] px-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-orange-200 border-t-orange-600" aria-hidden />
        <p className="text-sm font-semibold text-stone-700">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    const p = location.pathname.split("?")[0] || "/";
    const to = p === "/" || p === "" ? unauthenticatedEntryPath() : "/login";
    return <Navigate to={to} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
