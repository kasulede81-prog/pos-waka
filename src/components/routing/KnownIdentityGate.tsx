import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";
import { resolveAccountIdentity, type IdentityResolution } from "../../lib/memberIdentity";
import { useAuth } from "../../hooks/useAuth";

/**
 * Phase 1 — routes a session to the surface that matches who it is.
 *
 * This is the navigation half of the member identity work. `ensureWorkspaceForSession` decides
 * whether a session may be PROVISIONED a tenancy; this gate decides where it lands. They are
 * deliberately separate: classification is a read (`waka_account_identity` is `stable` and writes
 * nothing), so it is safe to call here purely for routing.
 *
 * Shape mirrors the existing guards (`BusinessProfileRequiredRoute`, `ActivationGateOutlet`):
 * a pathless layout route that either renders `<Outlet/>` or `<Navigate/>`. It wraps the MERCHANT
 * branch only — `/member` and `/welcome` sit beside it, so they are never bounced back here.
 *
 *   merchant -> pass through (unchanged behaviour for every real merchant)
 *   member   -> /member
 *   unknown  -> /welcome, and notably NOT a new shop
 */
export function KnownIdentityGate() {
  const { user, mode, initializing } = useAuth();
  const location = useLocation();
  const [resolution, setResolution] = useState<IdentityResolution | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Local/offline mode has no classifier and no tenancy to protect; never gate it.
    if (mode !== "supabase") {
      setResolution({ kind: "merchant", reason: "non_supabase_mode", identity: null });
      return;
    }
    if (!user?.id) {
      setResolution(null);
      return;
    }
    void resolveAccountIdentity({
      userId: user.id,
      metadata: user.user_metadata as Record<string, unknown> | undefined,
    }).then((r) => {
      if (!cancelled) setResolution(r);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, user?.id, user?.user_metadata]);

  if (initializing || resolution === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EnterpriseSpinner />
      </div>
    );
  }

  if (resolution.kind === "merchant") return <Outlet />;

  const target = resolution.kind === "member" ? "/member" : "/welcome";
  if (location.pathname === target) return <Outlet />;
  return <Navigate to={target} replace />;
}
