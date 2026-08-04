/**
 * Enterprise semantic theme tokens — Tailwind class bundles backed by CSS variables.
 * Phase 17.9 surfaces + Phase 29.1 spacing / elevation consolidation.
 */

import { enterpriseSpace } from "./enterpriseSpacing";

export const themeUi = {
  pageBg: "bg-background text-foreground",
  /** Canonical production card — border + elev shadow (use EnterpriseCard) */
  surface: "rounded-2xl border border-border bg-card shadow-elev",
  surfaceElevated: "rounded-2xl border border-border bg-surface-elevated shadow-elev-md",
  surfaceMuted: "rounded-2xl border border-border bg-surface-muted/80 shadow-elev",
  dialog: "rounded-3xl border border-border bg-dialog text-dialog-foreground shadow-elev-md",
  dialogHeader: "shrink-0 border-b border-border px-5 py-4",
  dialogFooter: "shrink-0 border-t border-border bg-dialog px-5 py-4",
  divider: "border-divider",
  /** Prefer enterpriseType.pageTitle / sectionTitle — kept for legacy imports */
  heading: "font-bold tracking-tight text-foreground text-xl sm:text-2xl",
  subheading: "font-medium text-muted-foreground text-sm sm:text-base",
  caption: "text-xs font-semibold text-muted-foreground",
  link: "font-bold text-waka-700 underline decoration-waka-300 underline-offset-2 hover:text-primary-hover dark:text-waka-400 dark:hover:text-waka-300",
  backLink: "inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-waka-800 active:opacity-70 dark:text-waka-400",
  overlay: "bg-overlay/55",
  skeleton: "waka-skeleton-bar",
  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  btnPrimary:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-elev transition-waka hover:bg-primary-hover active:bg-waka-700 disabled:cursor-not-allowed disabled:opacity-50",
  btnSecondary:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground shadow-elev transition-waka hover:bg-muted active:bg-muted disabled:opacity-50",
  btnGhost:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-waka-700 transition-waka hover:bg-muted active:bg-muted dark:text-waka-400",
  input:
    "min-h-[48px] w-full rounded-xl border border-input bg-card px-4 text-base text-foreground shadow-elev outline-none transition-waka placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 focus:ring-waka-200/60 disabled:cursor-not-allowed disabled:opacity-50",
  chip:
    "inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-foreground shadow-elev",
  chipActive: "border-business/40 bg-business-muted text-business ring-1 ring-business/30",
  fab:
    "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/90 bg-card/95 text-foreground shadow-elev-md backdrop-blur transition-waka hover:bg-muted active:scale-95 md:h-9 md:w-9",
  switchTrackOff: "bg-border",
  switchTrackOn: "bg-primary",
  switchThumb: "bg-card shadow",
  adminPage: "bg-background text-foreground font-admin",
  adminSurface: "rounded-2xl border border-border bg-card shadow-elev",
  chartShell: "rounded-2xl border border-border/90 bg-card p-4 shadow-elev",
  btnInverse:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-sm font-bold text-background shadow-elev transition-waka hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50",
  tableRow: "border-b border-border transition-waka hover:bg-muted/40 active:bg-muted/60",
  tableHead: "bg-muted px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground",
  /** Phase 29.1 spacing recipes */
  pageStack: enterpriseSpace.pageStack,
  workspaceStack: enterpriseSpace.workspaceStack,
  kpiGrid: enterpriseSpace.kpiGrid,
  cardPad: enterpriseSpace.cardPad,
  sectionGap: enterpriseSpace.sectionGap,
  controlGap: enterpriseSpace.controlGap,
} as const;

/** @deprecated Use themeUi — kept for backward-compatible imports */
export const wakaUi = themeUi;

export type ThemeUiKey = keyof typeof themeUi;

export { enterpriseType, enterpriseTypeClass, enterpriseDialogTitle } from "./enterpriseTypography";
export { enterpriseMotion, enterpriseDurationMs } from "./enterpriseMotion";
export { enterpriseIconClass, ENTERPRISE_ICON_STROKE, type EnterpriseIconSize } from "./enterpriseIcons";
export { enterpriseSpace, enterpriseSpaceCss } from "./enterpriseSpacing";
