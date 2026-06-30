/**
 * Waka brand design tokens — single source of truth for the application UI.
 * Visual values match `resources/brand/README.md` and `tailwind.config.ts` (waka scale).
 *
 * Note: The product brand is WAKA (Waka POS / waka.ug). Use these tokens everywhere
 * instead of ad-hoc orange-*, slate-*, or one-off hex values in app screens.
 */

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

/** Tailwind class bundles — prefer these over scattered utility strings */
export const wakaUi = {
  pageBg: "bg-background text-foreground",
  surface: "rounded-2xl border border-border bg-card shadow-waka-sm",
  surfaceMuted: "rounded-2xl border border-border bg-muted/40",
  heading: "font-black tracking-tight text-foreground",
  subheading: "font-medium text-muted-foreground",
  btnPrimary:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl bg-waka-600 px-4 py-2.5 text-sm font-black text-white shadow-waka-sm transition-waka active:bg-waka-700 disabled:cursor-not-allowed disabled:opacity-50",
  btnSecondary:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground shadow-sm transition-waka active:bg-muted",
  btnGhost:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold text-waka-700 transition-waka active:bg-waka-50",
  input:
    "min-h-[48px] w-full rounded-xl border border-input bg-card px-4 text-base text-foreground shadow-sm outline-none transition-waka placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 focus:ring-waka-200",
  chip:
    "inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-foreground shadow-sm",
  chipActive: "border-waka-500 bg-waka-50 text-waka-900 ring-1 ring-waka-200",
  link: "font-bold text-waka-700 underline decoration-waka-300 underline-offset-2 hover:text-waka-800",
} as const;
