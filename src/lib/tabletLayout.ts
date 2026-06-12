/** Tailwind `md` breakpoint — sidebar nav from 768px+. */
export const TABLET_SIDEBAR_MIN_PX = 768;

export function usesTabletSidebar(widthPx: number): boolean {
  return widthPx >= TABLET_SIDEBAR_MIN_PX;
}
