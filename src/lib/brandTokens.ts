/**
 * Waka brand design tokens — single source of truth for the application UI.
 * Visual values match `resources/brand/README.md` and `tailwind.config.ts` (waka scale).
 *
 * Note: The product brand is WAKA (Waka POS / waka.ug). Use themeUi / wakaUi from
 * themeTokens.ts instead of ad-hoc orange-*, slate-*, or one-off hex values in app screens.
 */

export { themeUi, wakaUi, type ThemeUiKey } from "./themeTokens";

/** Official brand orange — Play Store icon, CTAs, primary actions */
export const WAKA_BRAND_ORANGE = "#f97316" as const;
/** Tailwind waka-600 — pressed / hover primary */
export const WAKA_BRAND_ORANGE_DARK = "#ea580c" as const;
/** Cream app icon background */
export const WAKA_BRAND_CREAM = "#fffaf5" as const;
/** Warm auth / marketing wash */
export const WAKA_BRAND_CREAM_WASH = "#faf7f4" as const;

export const WAKA_BRAND_FONT_STACK =
  '"DM Sans", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' as const;

export const WAKA_BRAND_RADIUS = {
  sm: "0.75rem",
  md: "0.875rem",
  lg: "1rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  pill: "9999px",
} as const;

export const WAKA_BRAND_SHADOW = {
  sm: "0 1px 2px rgb(28 25 23 / 0.05), 0 4px 12px rgb(234 88 12 / 0.06)",
  md: "0 1px 2px rgb(28 25 23 / 0.06), 0 8px 24px rgb(234 88 12 / 0.08)",
} as const;
