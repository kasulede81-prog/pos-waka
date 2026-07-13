import { Suspense, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";
import { fetchWakaInternalAdminMe } from "../../lib/wakaInternalAdmin";
import {
  isInternalAdminPreviewActive,
  isInternalAdminPreviewEnabled,
} from "../../lib/internalAdminPreview";
import {
  resolveInternalAdminGateState,
  type InternalAdminGateState,
} from "../../lib/internalAdminRouteGuard";

type GateState = InternalAdminGateState;

/**
 * Router-level guard for /internal/waka/* — blocks child routes until admin status is verified.
 * Prevents admin UI from mounting for unauthorized users.
 */
export function InternalAdminOutlet() {
  const location = useLocation();
  const previewRequested =
    isInternalAdminPreviewEnabled() && isInternalAdminPreviewActive(location.search);
  const [state, setState] = useState<GateState>(
    resolveInternalAdminGateState({ previewRequested, adminRow: previewRequested ? {} : undefined }),
  );

  useEffect(() => {
    if (previewRequested) {
      setState(resolveInternalAdminGateState({ previewRequested: true, adminRow: null }));
      return;
    }

    let cancelled = false;
    setState(resolveInternalAdminGateState({ previewRequested: false, adminRow: undefined }));
    void fetchWakaInternalAdminMe().then((row) => {
      if (cancelled) return;
      setState(resolveInternalAdminGateState({ previewRequested: false, adminRow: row }));
    });

    return () => {
      cancelled = true;
    };
  }, [previewRequested, location.pathname]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-muted font-admin">
        <EnterpriseSpinner size="lg" label="Checking access" className="text-waka-600" />
        <p className="mt-3 text-sm font-semibold text-muted-foreground">Checking access…</p>
      </div>
    );
  }

  if (state === "denied") {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-muted-foreground">Loading…</div>
      }
    >
      <Outlet />
    </Suspense>
  );
}
