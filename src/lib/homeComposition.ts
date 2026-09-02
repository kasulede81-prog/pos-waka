/**
 * HOME V8 — Premium POS operating console tokens.
 * Presentation only. Does not change sale, cash, or shop authorities.
 *
 * Remix of Statify / POS console / dark-bento canvas patterns, in WAKA color.
 * 12-column desktop track. Shared 12px gutter. Shop scene is atmosphere, not a column.
 *
 *   Console     12  — 7 | 5       (today + CTA stack | supporting KPIs)
 *   Command     12  — 7 | 5       (primary work | live engine)
 *   Operations  12  — equal cells
 *   Admin       12  — compact equal cells
 */

export const HOME_COMPOSITION_COLUMNS = 12;
export const HOME_COMPOSITION_GAP_PX = 12;

export const HOME_COMPOSITION_SPAN = {
  heroLead: 7,
  heroSupport: 5,
  heroMetrics: 7,
  heroShop: 0,
  heroHealth: 5,
  primary: 7,
  live: 5,
  cta: 12,
} as const;

export const HOME_TYPE_SCALE = {
  greeting: "text-base font-bold tracking-tight sm:text-lg",
  greetingSub: "text-sm font-medium text-muted-foreground",
  section: "text-lg font-bold tracking-tight sm:text-xl",
  metric: "text-5xl font-black tabular-nums tracking-tight xl:text-6xl",
  tileTitle: "text-base font-bold sm:text-lg",
  cta: "text-xl font-black tracking-wide sm:text-2xl",
} as const;

export function homeCommandLastTileSpansRow(index: number, count: number): boolean {
  return count % 2 === 1 && index === count - 1;
}
