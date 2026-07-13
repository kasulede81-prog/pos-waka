/**
 * Phase 22.6 — Enterprise premium motion language.
 * One timing curve across modals, sheets, buttons, cards, and loading states.
 */

/** Shared easing — matches `.transition-waka` in index.css */
export const ENTERPRISE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)" as const;

export const enterpriseMotion = {
  /** Standard interactive transition (matches .transition-waka) */
  standard: "transition-waka",
  /** Press feedback for touch targets */
  press: "active:scale-[0.98] motion-reduce:active:scale-100",
  /** Subtle hover lift for desktop pointer surfaces */
  hoverLift: "md:hover:shadow-md md:hover:-translate-y-px motion-reduce:transform-none",
  /** Interactive cards / KPI tiles */
  cardInteractive:
    "transition-waka active:scale-[0.99] motion-reduce:active:scale-100 md:hover:border-border/90 md:hover:shadow-sm",
  /** Modal / sheet overlay fade */
  overlayEnter: "animate-enterprise-overlay-in motion-reduce:animate-none",
  /** Bottom sheet slide-up */
  sheetEnter: "animate-enterprise-sheet-in motion-reduce:animate-none",
  /** Centered dialog scale-in */
  dialogEnter: "animate-enterprise-dialog-in motion-reduce:animate-none",
  /** Toast / banner slide-down */
  toastEnter: "animate-enterprise-toast-in motion-reduce:animate-none",
  /** Shimmer skeleton (preferred over pulse) */
  skeleton: "waka-skeleton-bar",
  /** Inline spinner */
  spin: "animate-spin motion-reduce:animate-none",
  /** Focus-visible ring bundle */
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
} as const;

export const enterpriseDurationMs = {
  fast: 120,
  normal: 180,
  slow: 280,
  sheet: 320,
} as const;
