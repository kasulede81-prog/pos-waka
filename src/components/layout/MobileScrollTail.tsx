import { useLocation } from "react-router-dom";
import { isInternalAdminAppPath } from "../../lib/internalAdminPreview";
import { resolveEnterpriseBottomChrome } from "../../lib/enterpriseBottomChrome";
import { isPosSellPath } from "../../lib/posSellExit";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { resolveTerminalHomePath } from "../../lib/terminalHome";
import { isHospitalityMode } from "../../lib/hospitality";
import { isPharmacyMode } from "../../lib/pharmacy";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";

/**
 * Real block at the end of the scroll column (not padding on the scroller).
 * iOS Safari often treats padding-bottom as non-scrollable / non-clickable under fixed footers.
 */
export function MobileScrollTail() {
  const { pathname } = useLocation();
  const preferences = usePosStore((s) => s.preferences);
  const actor = useSessionActor();
  const isDesktopLayout = usePosDesktopLayout();
  const terminalHome = resolveTerminalHomePath(preferences, actor.role, actor.permissions);
  const isPos = isPosSellPath(pathname);
  const isInternalAdmin = isInternalAdminAppPath(pathname);

  const hospitalityBusiness = isHospitalityMode(
    preferences.businessType,
    preferences.hospitalityModeEnabled,
  );
  const pharmacyBusiness = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);

  const chrome = resolveEnterpriseBottomChrome({
    pathname,
    terminalHome,
    isDesktopLayout,
    pharmacyWorkspace: pharmacyBusiness && !hospitalityBusiness,
    hospitalityBusiness,
  });

  if (isInternalAdmin) {
    return null;
  }

  if (chrome.needsScrollTail) {
    return (
      <div
        aria-hidden
        className="h-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] shrink-0 md:hidden"
      />
    );
  }

  if (isPos) {
    return <div aria-hidden className="h-[var(--waka-scroll-tail-pos-sale)] shrink-0 md:hidden" />;
  }

  return <div aria-hidden className="h-[calc(var(--waka-safe-bottom)+0.75rem)] shrink-0 md:hidden" />;
}
