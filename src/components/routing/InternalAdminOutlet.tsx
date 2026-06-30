import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-stone-100 font-admin">
        <Loader2 className="h-8 w-8 animate-spin text-waka-600" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-stone-600">Checking access…</p>
      </div>
    );
  }

  if (state === "denied") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
