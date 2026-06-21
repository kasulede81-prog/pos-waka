/** CSS value for bottom padding that respects gesture nav and keyboard. */
export function combinedBottomInsetStyle(keyboardInsetPx: number): string | undefined {
  if (keyboardInsetPx > 0) {
    return `max(${keyboardInsetPx}px, env(safe-area-inset-bottom, 0px))`;
  }
  return undefined;
}

export const SAFE_AREA_TOP_CLASS = "pt-[max(0.5rem,env(safe-area-inset-top,0px))]";
export const SAFE_AREA_BOTTOM_CLASS = "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]";
