import { Navigate, Outlet, useLocation } from "react-router-dom";

type Props = {
  initializing: boolean;
  isAuthenticated: boolean;
};

export function ProtectedRoute({ initializing, isAuthenticated }: Props) {
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    const p = location.pathname.split("?")[0] || "/";
    const to = p === "/" || p === "" ? "/home" : "/login";
    return <Navigate to={to} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
