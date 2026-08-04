/** Shared Tailwind class tokens for marketing light/dark themes (CSS vars on `.marketing-site`).
 * Phase 29.1 — restored full `waka-*` shade classes (truncated `bg-waka-` broke Light hierarchy).
 */

export const mktPage = "bg-mkt-bg text-mkt-text transition-[background-color,color] duration-500 ease-out";

export const mktHeading = "text-mkt-text";

export const mktSubtext = "text-mkt-text-secondary";

export const mktEyebrow = "text-waka-600 dark:text-waka-400";

export const mktCard =
  "rounded-2xl border border-mkt-border bg-mkt-card shadow-mkt transition-[background-color,border-color,box-shadow] duration-500 ease-out";

export const mktCardLg =
  "rounded-3xl border border-mkt-border bg-mkt-card shadow-mkt transition-[background-color,border-color,box-shadow] duration-500 ease-out";

export const mktSectionMuted = "border-mkt-border bg-mkt-bg-secondary";

export const mktNav =
  "sticky top-0 z-50 border-b border-mkt-border/80 bg-mkt-nav/90 backdrop-blur-xl transition-[background-color,border-color] duration-500";

export const mktNavLink =
  "rounded-full px-3 py-2 text-sm font-bold text-mkt-text-secondary transition hover:bg-mkt-bg-secondary hover:text-waka-700 dark:hover:text-waka-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktBtnPrimary =
  "inline-flex items-center justify-center rounded-2xl bg-waka-600 font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-waka-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktBtnSecondary =
  "inline-flex items-center justify-center rounded-2xl border-2 border-mkt-border bg-mkt-card font-bold text-mkt-text transition hover:border-waka-500 hover:bg-mkt-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktChip =
  "inline-flex items-center gap-2 rounded-full border border-mkt-border bg-mkt-card px-3 py-1.5 text-sm font-bold text-mkt-text shadow-mkt transition-[background-color,border-color,box-shadow] duration-500";

export const mktInputPill =
  "rounded-full border border-mkt-border bg-mkt-bg-secondary p-1 text-xs font-bold";

export const mktFooter =
  "mt-16 border-t border-mkt-border bg-mkt-footer text-mkt-text-secondary transition-[background-color,border-color,color] duration-500";

export const mktHeroGlow =
  "pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(234,88,12,0.12),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(234,88,12,0.28),transparent)] transition-[background] duration-500";

export const mktDeviceFrame =
  "rounded-2xl border border-mkt-border bg-mkt-card p-2 shadow-mkt-lg transition-[background-color,border-color,box-shadow] duration-500";

export const mktPopularPlan =
  "border-waka-500 bg-gradient-to-b from-waka-50 to-white ring-2 ring-waka-500 dark:from-waka-950/40 dark:to-mkt-card dark:ring-waka-500/30";

export const mktChartBar = "rounded-sm bg-waka-600 dark:bg-waka-500/40 transition-colors duration-500";
