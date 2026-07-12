/**
 * Phase 22.2 — Enterprise icon size map (Lucide).
 */

import clsx from "clsx";

export type EnterpriseIconSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<EnterpriseIconSize, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
};

export function enterpriseIconClass(size: EnterpriseIconSize = "sm", className?: string): string {
  return clsx(SIZE_CLASS[size], "shrink-0", className);
}

/** Default Lucide stroke — use consistently */
export const ENTERPRISE_ICON_STROKE = 2 as const;
