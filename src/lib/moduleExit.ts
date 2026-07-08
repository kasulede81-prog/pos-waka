import { isBackOfficePath, isSettingsLauncherPath } from "./backOfficePaths";
import { labelKeyForBackFallback } from "./headerBack";
import { getBackFallbackPath } from "./navigationBack";
import { POS_HOME_ROUTE } from "./posNavigation";
import { isPharmacyOperationalRoute, PHARMACY_DISPENSE_ROUTE } from "./pharmacyNav";

export type ModuleExitAction = {
  labelKey: string;
  fallbackTo: string;
  preferHistoryBack: boolean;
};

export function resolveModuleExit(pathname: string, terminalHome: string = POS_HOME_ROUTE): ModuleExitAction | null {
  if (pathname === POS_HOME_ROUTE) return null;
  if (pathname === terminalHome && terminalHome !== POS_HOME_ROUTE) return null;
  if (pathname === "/pos" || pathname.startsWith("/pos/")) return null;
  if (pathname === PHARMACY_DISPENSE_ROUTE) return null;
  if (isPharmacyOperationalRoute(pathname)) {
    return { labelKey: "pharmacyNavExit", fallbackTo: POS_HOME_ROUTE, preferHistoryBack: false };
  }

  const fallback = getBackFallbackPath(pathname);

  if (pathname === "/office" || pathname === "/settings") {
    return { labelKey: "posNavExit", fallbackTo: terminalHome, preferHistoryBack: false };
  }

  if (pathname === "/owner") {
    return { labelKey: "officeBackToHub", fallbackTo: "/office", preferHistoryBack: true };
  }

  if (isSettingsLauncherPath(pathname) || pathname.startsWith("/settings/")) {
    const target = pathname.startsWith("/settings/") ? fallback : POS_HOME_ROUTE;
    const labelKey = target === "/settings" ? "settingsHubTitle" : "posNavExit";
    return { labelKey, fallbackTo: target, preferHistoryBack: true };
  }

  if (pathname.startsWith("/office/") || (isBackOfficePath(pathname) && pathname !== "/office")) {
    return {
      labelKey: labelKeyForBackFallback(fallback, pathname),
      fallbackTo: fallback,
      preferHistoryBack: true,
    };
  }

  if (pathname.startsWith("/owner/")) {
    return {
      labelKey: labelKeyForBackFallback(fallback, pathname),
      fallbackTo: fallback,
      preferHistoryBack: true,
    };
  }

  if (fallback !== POS_HOME_ROUTE) {
    return {
      labelKey: labelKeyForBackFallback(fallback, pathname),
      fallbackTo: fallback,
      preferHistoryBack: true,
    };
  }

  return { labelKey: "posNavExit", fallbackTo: POS_HOME_ROUTE, preferHistoryBack: false };
}
