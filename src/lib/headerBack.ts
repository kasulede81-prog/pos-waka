import { isBackOfficePath } from "./backOfficePaths";
import { getBackFallbackPath, historyCanGoBack } from "./navigationBack";
import { hasNestedModuleBack, shouldShowHeaderExit } from "./headerExit";

export type HeaderBackResolve = {
  show: boolean;
  fallback: string;
  labelKey: string;
};

export function labelKeyForBackFallback(fallback: string, pathname: string): string {
  if (fallback === "/settings" || pathname.startsWith("/settings/")) return "settingsHubTitle";
  if (fallback === "/office" || pathname.startsWith("/office/")) return "officeBackToHub";
  return "pageBack";
}

/** Desktop header: one level up (folder / hub), separate from Exit → main menu. */
export function resolveHeaderBack(pathname: string, desktopTerminal: boolean): HeaderBackResolve {
  const hidden = { show: false, fallback: "/", labelKey: "pageBack" };
  if (!desktopTerminal || !shouldShowHeaderExit(pathname)) return hidden;

  const fallback = getBackFallbackPath(pathname, { desktopTerminal: true });
  const labelKey = labelKeyForBackFallback(fallback, pathname);

  if (hasNestedModuleBack(pathname)) {
    return { show: true, fallback, labelKey };
  }

  if (pathname === "/settings" || pathname === "/owner" || pathname === "/office") {
    return hidden;
  }

  if (isBackOfficePath(pathname) && fallback !== "/") {
    return { show: true, fallback, labelKey };
  }

  if (historyCanGoBack()) {
    return { show: true, fallback, labelKey: "pageBack" };
  }

  return hidden;
}

export function shouldHidePageBackBar(pathname: string, desktopTerminal: boolean): boolean {
  return resolveHeaderBack(pathname, desktopTerminal).show;
}
