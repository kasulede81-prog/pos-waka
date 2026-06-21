/** Tailwind `md` breakpoint — sidebar nav and POS desktop split from 768px+. */
export const TABLET_SIDEBAR_MIN_PX = 768;

/** POS catalog + checkout side-by-side from tablet width (was 1024). */
export const POS_DESKTOP_LAYOUT_MIN_PX = 768;

export function usesTabletSidebar(widthPx: number): boolean {
  return widthPx >= TABLET_SIDEBAR_MIN_PX;
}

export function usesPosDesktopLayout(widthPx: number): boolean {
  return widthPx >= POS_DESKTOP_LAYOUT_MIN_PX;
}
