/**
 * Phase 29.1 — Enterprise spacing scale (8px rhythm).
 * Prefer these tokens over ad-hoc p-* / gap-* freestyle outside POS density.
 *
 * Scale: 8, 16, 24, 32 (plus 4 for micro chrome only)
 */

/** CSS variable names (defined on :root in index.css) */
export const enterpriseSpaceCss = {
  1: "var(--space-1)", // 8
  2: "var(--space-2)", // 16
  3: "var(--space-3)", // 24
  4: "var(--space-4)", // 32
  micro: "var(--space-micro)", // 4 — chrome only
} as const;

/** Tailwind class bundles for section / stack rhythm */
export const enterpriseSpace = {
  /** Page section stack — default ops rhythm */
  pageStack: "space-y-4 sm:space-y-6",
  /** Dense workspace (tables, toolbars) */
  workspaceStack: "space-y-3 sm:space-y-4",
  /** KPI / card grids */
  kpiGrid: "grid gap-3 sm:gap-4",
  /** Card internal padding */
  cardPad: "p-4 sm:p-5",
  /** Compact KPI pad */
  kpiPad: "p-3",
  /** Section header gap below title */
  sectionGap: "mb-3 sm:mb-4",
  /** Inline control gaps */
  controlGap: "gap-2 sm:gap-3",
  /** Dialog body pad */
  dialogPad: "px-5 py-4",
} as const;

export type EnterpriseSpaceKey = keyof typeof enterpriseSpace;
