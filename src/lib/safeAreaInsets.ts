/** CSS value for bottom padding that respects gesture nav and keyboard. */
export function combinedBottomInsetStyle(keyboardInsetPx: number): string | undefined {
  if (keyboardInsetPx > 0) {
    return `max(${keyboardInsetPx}px, env(safe-area-inset-bottom, 0px))`;
  }
  return undefined;
}

/**
 * Keyboard occlusion height from layout vs visual viewport.
 * Uses both offset-aware and height-only formulas — Android can scroll the layout
 * when an input focuses, inflating offsetTop and under-counting with height-only.
 */
export function visualViewportKeyboardGap(
  layoutHeight: number,
  viewportHeight: number,
  offsetTop = 0,
): number {
  const withOffset = Math.max(0, Math.round(layoutHeight - viewportHeight - offsetTop));
  const heightOnly = Math.max(0, Math.round(layoutHeight - viewportHeight));
  return Math.max(withOffset, heightOnly);
}

export const SAFE_AREA_TOP_CLASS = "pt-[max(0.5rem,env(safe-area-inset-top,0px))]";
export const SAFE_AREA_BOTTOM_CLASS = "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]";
