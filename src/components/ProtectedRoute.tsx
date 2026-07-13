import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { bootTrace } from "../lib/bootTrace";
import { unauthenticatedEntryPath } from "../lib/nativeApp";
import { EnterpriseSpinner } from "./enterprise/EnterpriseSpinner";

type Props = {
  initializing: boolean;
  isAuthenticated: boolean;
};

export function ProtectedRoute({ initializing, isAuthenticated }: Props) {
  const location = useLocation();

  useEffect(() => {
    bootTrace("BOOT-011", "ProtectedRoute", "START", {
      initializing,
      isAuthenticated,
      path: location.pathname,
    });
    if (!initializing) {
      bootTrace("BOOT-011", "ProtectedRoute", isAuthenticated ? "SUCCESS" : "FAILED", {
        path: location.pathname,
      });
    }
  }, [initializing, isAuthenticated, location.pathname]);

  useEffect(() => {
    if (!initializing) {
      void import("../lib/startupPerformance").then(({ markStartupPerf }) => markStartupPerf("auth_ready"));
    }
  }, [initializing]);

  if (initializing) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-brand-cream px-6 text-center">
        <EnterpriseSpinner size="lg" label="Loading session" />
        <p className="text-sm font-semibold text-muted-foreground">Loading…</p>
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
