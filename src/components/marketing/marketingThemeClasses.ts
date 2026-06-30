/** Shared Tailwind class tokens for marketing light/dark themes (CSS vars on `.marketing-site`). */

export const mktPage = "bg-mkt-bg text-mkt-text transition-[background-color,color] duration-500 ease-out";

export const mktHeading = "text-mkt-text";

export const mktSubtext = "text-mkt-text-secondary";

export const mktEyebrow = "text-waka- dark:text-waka-";

export const mktCard =
  "rounded-2xl border border-mkt-border bg-mkt-card shadow-mkt transition-[background-color,border-color,box-shadow] duration-500 ease-out";

export const mktCardLg =
  "rounded-3xl border border-mkt-border bg-mkt-card shadow-mkt transition-[background-color,border-color,box-shadow] duration-500 ease-out";

export const mktSectionMuted = "border-mkt-border bg-mkt-bg-secondary";

export const mktNav =
  "sticky top-0 z-50 border-b border-mkt-border/80 bg-mkt-nav/90 backdrop-blur-xl transition-[background-color,border-color] duration-500";

export const mktNavLink =
  "rounded-full px-3 py-2 text-sm font-bold text-mkt-text-secondary transition hover:bg-mkt-bg-secondary hover:text-waka- dark:hover:text-waka- focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka- focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktBtnPrimary =
  "inline-flex items-center justify-center rounded-2xl bg-waka- font-black text-white shadow-lg shadow-orange-600/20 transition hover:bg-waka- focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka- focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktBtnSecondary =
  "inline-flex items-center justify-center rounded-2xl border-2 border-mkt-border bg-mkt-card font-black text-mkt-text transition hover:border-waka- hover:bg-mkt-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka- focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg";

export const mktChip =
  "inline-flex items-center gap-2 rounded-full border border-mkt-border bg-mkt-card px-3 py-1.5 text-sm font-bold text-mkt-text shadow-mkt transition-[background-color,border-color,box-shadow] duration-500";

export const mktInputPill =
  "rounded-full border border-mkt-border bg-mkt-bg-secondary p-1 text-xs font-black";

export const mktFooter =
  "mt-16 border-t border-mkt-border bg-mkt-footer text-mkt-text-secondary transition-[background-color,border-color,color] duration-500";

export const mktHeroGlow =
  "pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(234,88,12,0.12),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(234,88,12,0.28),transparent)] transition-[background] duration-500";

export const mktDeviceFrame =
  "rounded-2xl border border-mkt-border bg-mkt-card p-2 shadow-mkt-lg transition-[background-color,border-color,box-shadow] duration-500";

export const mktPopularPlan =
  "border-waka- bg-gradient-to-b from-waka- to-white ring-2 ring-waka- dark:from-waka-/40 dark:to-mkt-card dark:ring-waka-/30";

export const mktChartBar = "rounded-sm bg-waka- dark:bg-waka-/40 transition-colors duration-500";
