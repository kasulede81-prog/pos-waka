import {
  WAKA_DESKTOP_MIN_PX,
  WAKA_MOBILE_MAX_PX,
  WAKA_POS_WIDE_MIN_PX,
  WAKA_TABLET_MIN_PX,
  resolvePosLayoutMode,
  type PosLayoutMode,
} from "./responsiveBreakpoints";

/**
 * Phase 32.1 — explicit Sell workspace modes (presentation / focus only).
 * Business rules (pricing, barcode, stock) stay outside this model.
 */
export type PosSellWorkspaceMode =
  | "browsing"
  | "searching"
  | "cart_review"
  | "payment"
  | "receipt";

export type ResolvePosSellWorkspaceModeInput = {
  receiptOpen: boolean;
  searchQuery: string;
  draftLineCount: number;
  /** Mobile/compact: overlay open. Full desktop: checkout expanded (not rail-collapsed). */
  checkoutExpanded: boolean;
  /** Desktop numpad / credit dock active — payment focus without replacing catalog. */
  paymentWorkspaceActive: boolean;
};

export function resolvePosSellWorkspaceMode(input: ResolvePosSellWorkspaceModeInput): PosSellWorkspaceMode {
  if (input.receiptOpen) return "receipt";
  if (input.paymentWorkspaceActive) return "payment";
  if (input.draftLineCount > 0 && input.checkoutExpanded) return "cart_review";
  if (input.searchQuery.trim().length > 0) return "searching";
  return "browsing";
}

export type PosSellWorkspaceChrome = {
  mode: PosSellWorkspaceMode;
  catalogVisible: boolean;
  checkoutVisible: boolean;
  scrollOwner: "catalog" | "checkout" | "none";
};

/** Chrome contract per mode — used for docs + runtime guards. */
export function posSellWorkspaceChrome(mode: PosSellWorkspaceMode, layoutMode: PosLayoutMode): PosSellWorkspaceChrome {
  switch (mode) {
    case "receipt":
      return { mode, catalogVisible: false, checkoutVisible: false, scrollOwner: "none" };
    case "payment":
      return {
        mode,
        catalogVisible: layoutMode === "full",
        checkoutVisible: true,
        scrollOwner: layoutMode === "full" ? "catalog" : "checkout",
      };
    case "cart_review":
      return {
        mode,
        catalogVisible: layoutMode === "full" || layoutMode === "compact",
        checkoutVisible: true,
        scrollOwner: layoutMode === "mobile" ? "checkout" : "catalog",
      };
    case "searching":
    case "browsing":
    default:
      return { mode, catalogVisible: true, checkoutVisible: layoutMode === "full", scrollOwner: "catalog" };
  }
}

/**
 * Zoom-safe layout width for POS band resolution.
 * When a maximized/fullscreen desktop window is browser-zoomed below 1024 CSS px,
 * keep desktop identity using screen width so Sell does not flip to slideover.
 */
export function resolvePosLayoutWidthPx(opts?: {
  innerWidth?: number;
  outerWidth?: number;
  screenWidth?: number;
}): number {
  const inner = opts?.innerWidth ?? (typeof window !== "undefined" ? window.innerWidth : WAKA_MOBILE_MAX_PX);
  const outer = opts?.outerWidth ?? (typeof window !== "undefined" ? window.outerWidth : inner);
  const screenW =
    opts?.screenWidth ?? (typeof window !== "undefined" ? window.screen?.availWidth || window.screen?.width || inner : inner);

  const looksMaximized = outer >= screenW * 0.88;
  // Laptop/desktop screens (≥1280): zoomed CSS width must not demote full → compact
  if (looksMaximized && screenW >= WAKA_POS_WIDE_MIN_PX && inner < WAKA_DESKTOP_MIN_PX) {
    return Math.max(inner, WAKA_DESKTOP_MIN_PX);
  }
  // Tablet-class screens (768–1279): zoomed CSS must not demote compact → mobile
  if (
    looksMaximized &&
    screenW >= WAKA_TABLET_MIN_PX &&
    screenW < WAKA_POS_WIDE_MIN_PX &&
    inner <= WAKA_MOBILE_MAX_PX
  ) {
    return Math.max(inner, WAKA_TABLET_MIN_PX);
  }
  return inner;
}

export function resolvePosLayoutModeZoomSafe(opts?: {
  innerWidth?: number;
  outerWidth?: number;
  screenWidth?: number;
}): PosLayoutMode {
  return resolvePosLayoutMode(resolvePosLayoutWidthPx(opts));
}
