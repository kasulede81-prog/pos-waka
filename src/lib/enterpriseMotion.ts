/**
 * Phase 22.2 — Enterprise motion tokens.
 */

export const enterpriseMotion = {
  /** Standard interactive transition (matches .transition-waka) */
  standard: "transition-waka",
  /** Press feedback for touch targets */
  press: "active:scale-[0.98] motion-reduce:active:scale-100",
  /** Dialog / sheet enter — CSS only; admin framer-motion stays isolated */
  overlay: "transition-opacity duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
  /** Loading pulse */
  skeleton: "animate-pulse",
  /** Spinner */
  spin: "animate-spin",
} as const;

export const enterpriseDurationMs = {
  fast: 120,
  normal: 180,
  slow: 300,
} as const;
