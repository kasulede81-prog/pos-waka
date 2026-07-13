/**
 * Phase 22.2 — Enterprise typography hierarchy (6 semantic roles).
 * Use these instead of ad-hoc font sizes/weights. Fractional sizes are POS-density only.
 */

import clsx from "clsx";

export type EnterpriseTypeRole =
  | "display"
  | "pageTitle"
  | "sectionTitle"
  | "body"
  | "caption"
  | "monoNumber";

/** Tailwind class bundles for each role — light + dark safe via semantic tokens. */
export const enterpriseType: Record<EnterpriseTypeRole, string> = {
  display:
    "font-black tracking-tight text-foreground text-2xl sm:text-3xl lg:text-4xl",
  pageTitle: "font-black tracking-tight text-foreground text-xl sm:text-2xl",
  sectionTitle: "font-bold tracking-tight text-foreground text-base sm:text-lg",
  body: "font-medium text-foreground text-sm sm:text-base leading-relaxed",
  caption: "font-semibold text-muted-foreground text-xs uppercase tracking-wide",
  monoNumber: "font-black tabular-nums lining-nums text-foreground tracking-tight",
};

export function enterpriseTypeClass(role: EnterpriseTypeRole, className?: string): string {
  return clsx(enterpriseType[role], className);
}

/** Currency / UGX amounts in KPIs, tables, and reports */
export function enterpriseCurrencyClass(className?: string): string {
  return clsx(enterpriseType.monoNumber, "text-base sm:text-lg", className);
}

/** Dialog / sheet titles */
export const enterpriseDialogTitle = enterpriseType.pageTitle;

/** POS shelf density — only place fractional sizes are allowed */
export const enterprisePosDensityType = {
  micro: "text-[10px] font-bold leading-tight",
  shelfPrice: "font-black tabular-nums",
} as const;

/** Prohibited outside POS density (for lint script reference) */
export const PROHIBITED_FRACTIONAL_TYPE = [
  "text-[8px]",
  "text-[9px]",
  "text-[11px]",
  "text-[13px]",
  "text-[15px]",
  "text-[17px]",
  "text-[18px]",
  "text-[22px]",
] as const;
