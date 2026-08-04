import { Navigate, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { useShopVisionSettings } from "../hooks/useShopVisionSettings";
import { VisionLicenseBlockedCard } from "./vision/VisionLicenseGate";

type Mode = "manage" | "live" | "monitor";

export function VisionProtectedRoute({
  lang,
  mode,
  children,
}: {
  lang: Language;
  mode: Mode;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const { loading, access } = useShopVisionSettings();

  if (loading) {
    return (
      <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-muted-foreground">
        Loading…
      </div>
    );
  }

  const allowed =
    mode === "manage"
      ? access.canManageRegistry || access.status === "subscription_expired"
      : mode === "live"
        ? access.canLive
        : access.canMonitor;

  if (!allowed) {
    if (mode !== "manage" && access.canManageRegistry) {
      return <Navigate to="/office/vision" replace state={{ from: location.pathname }} />;
    }
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <VisionLicenseBlockedCard lang={lang} access={access} />
      </div>
    );
  }

  return <>{children}</>;
}
