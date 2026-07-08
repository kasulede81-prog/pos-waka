import { resolveModuleExit } from "./moduleExit";
import { isHospitalityOperationalRoute } from "./hospitalityNav";
import { isPharmacyOperationalRoute } from "./pharmacyNav";
import { isPosSellPath } from "./posSellExit";
import { isInternalAdminAppPath } from "./internalAdminPreview";
import { WAKA_TABLET_MIN_PX } from "./responsiveBreakpoints";

/** Supported bottom chrome modes — exactly one may be active at a time. */
export type EnterpriseBottomChromeMode =
  | "none"
  | "module-exit"
  | "pharmacy"
  | "hospitality"
  | "floor";

export type EnterpriseBottomChromeState = {
  mode: EnterpriseBottomChromeMode;
  /** Whether a fixed bottom bar should render in AppShell. */
  showMobileBar: boolean;
  /** CSS shell modifier applied to `.app-shell-root`. */
  shellClass: string | null;
  /** CSS custom property name for bar height (without `--`). */
  heightVar: string | null;
  /** Whether MobileScrollTail should reserve space below scroll content. */
  needsScrollTail: boolean;
};

export type ResolveBottomChromeInput = {
  pathname: string;
  terminalHome: string;
  isDesktopLayout: boolean;
  pharmacyWorkspace: boolean;
  hospitalityBusiness: boolean;
};

const HEIGHT_VARS = {
  "module-exit": "waka-module-exit-h",
  pharmacy: "waka-pharmacy-nav-h",
  hospitality: "waka-hospitality-nav-h",
  floor: "waka-floor-nav-h",
} as const;

const SHELL_CLASSES: Record<Exclude<EnterpriseBottomChromeMode, "none">, string> = {
  "module-exit": "app-shell--module-exit",
  pharmacy: "app-shell--pharmacy-nav",
  hospitality: "app-shell--hospitality-nav",
  floor: "app-shell--floor-nav",
};

/** Floor plan uses its own in-page bottom bar — not the global hospitality tab bar. */
export function isFloorPlanHomeRoute(pathname: string): boolean {
  return pathname === "/floor";
}

/** Table order and POS-style operational screens hide global bottom chrome. */
export function isOperationalViewportRoute(pathname: string): boolean {
  if (isPosSellPath(pathname)) return true;
  if (pathname.startsWith("/floor/order/")) return true;
  return false;
}

/**
 * Resolves which bottom chrome mode is active. Priority (highest wins):
 * none (desktop / admin / sell / table-order) → floor → pharmacy → hospitality → module-exit
 */
export function resolveEnterpriseBottomChrome(input: ResolveBottomChromeInput): EnterpriseBottomChromeState {
  const { pathname, terminalHome, isDesktopLayout, pharmacyWorkspace, hospitalityBusiness } = input;

  const none: EnterpriseBottomChromeState = {
    mode: "none",
    showMobileBar: false,
    shellClass: null,
    heightVar: null,
    needsScrollTail: false,
  };

  if (isInternalAdminAppPath(pathname)) return none;
  if (isDesktopLayout) return none;
  if (isOperationalViewportRoute(pathname)) return none;

  if (isFloorPlanHomeRoute(pathname)) {
    return {
      mode: "floor",
      showMobileBar: false,
      shellClass: SHELL_CLASSES.floor,
      heightVar: HEIGHT_VARS.floor,
      needsScrollTail: true,
    };
  }

  if (pharmacyWorkspace && isPharmacyOperationalRoute(pathname)) {
    return {
      mode: "pharmacy",
      showMobileBar: true,
      shellClass: SHELL_CLASSES.pharmacy,
      heightVar: HEIGHT_VARS.pharmacy,
      needsScrollTail: true,
    };
  }

  if (hospitalityBusiness && isHospitalityOperationalRoute(pathname)) {
    return {
      mode: "hospitality",
      showMobileBar: true,
      shellClass: SHELL_CLASSES.hospitality,
      heightVar: HEIGHT_VARS.hospitality,
      needsScrollTail: true,
    };
  }

  if (resolveModuleExit(pathname, terminalHome)) {
    return {
      mode: "module-exit",
      showMobileBar: true,
      shellClass: SHELL_CLASSES["module-exit"],
      heightVar: HEIGHT_VARS["module-exit"],
      needsScrollTail: true,
    };
  }

  return none;
}

/** Bottom chrome is hidden from tablet breakpoint upward (768px). */
export function bottomChromeHiddenAtPx(): number {
  return WAKA_TABLET_MIN_PX;
}
