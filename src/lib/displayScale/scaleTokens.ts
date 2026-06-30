/** POS Display Scale — responsive density tokens (not browser zoom). */

export const DISPLAY_SCALE_LEVELS = ["compact", "normal", "large", "extra_large"] as const;

export type DisplayScaleLevel = (typeof DISPLAY_SCALE_LEVELS)[number];

export const DEFAULT_DISPLAY_SCALE_LEVEL: DisplayScaleLevel = "normal";

export type DisplayScaleMeta = {
  labelKey: string;
  percent: number;
  multiplier: number;
  columnDelta: number;
};

export const DISPLAY_SCALE_META: Record<DisplayScaleLevel, DisplayScaleMeta> = {
  compact: { labelKey: "displayScaleCompact", percent: 88, multiplier: 0.88, columnDelta: 2 },
  normal: { labelKey: "displayScaleNormal", percent: 100, multiplier: 1, columnDelta: 0 },
  large: { labelKey: "displayScaleLarge", percent: 112, multiplier: 1.12, columnDelta: -2 },
  extra_large: { labelKey: "displayScaleExtraLarge", percent: 128, multiplier: 1.28, columnDelta: -3 },
};

const MIN_TOUCH_PX = 48;

function px(base: number, multiplier: number): string {
  return `${Math.max(MIN_TOUCH_PX, Math.round(base * multiplier))}px`;
}

function rem(base: number, multiplier: number): string {
  return `${(base * multiplier).toFixed(4)}rem`;
}

/** CSS custom properties applied on `html.pos-display-scale-active`. */
export function displayScaleCssVars(level: DisplayScaleLevel): Record<string, string> {
  const m = DISPLAY_SCALE_META[level].multiplier;
  return {
    "--ds-scale": String(m),
    "--ds-transition": "200ms",
    "--ds-font-2xs": rem(0.5625, m),
    "--ds-font-xs": rem(0.6875, m),
    "--ds-font-sm": rem(0.75, m),
    "--ds-font-base": rem(0.875, m),
    "--ds-font-md": rem(1, m),
    "--ds-font-lg": rem(1.125, m),
    "--ds-font-xl": rem(1.25, m),
    "--ds-gap-1": rem(0.25, m),
    "--ds-gap-2": rem(0.5, m),
    "--ds-gap-3": rem(0.75, m),
    "--ds-gap-4": rem(1, m),
    "--ds-radius-sm": rem(0.5, m),
    "--ds-radius-md": rem(0.75, m),
    "--ds-radius-lg": rem(1, m),
    "--ds-radius-xl": rem(1.25, m),
    "--ds-touch-min": px(48, m),
    "--ds-btn-min-h": px(44, m),
    "--ds-input-min-h": px(48, m),
    "--ds-product-card-min-h": px(108, m),
    "--ds-product-avatar": px(40, m),
    "--ds-chip-min-h": px(32, m),
    "--ds-checkout-pad": rem(0.75, m),
    "--ds-icon-sm": rem(0.875, m),
    "--ds-icon-md": rem(1.125, m),
    "--ds-icon-lg": rem(1.25, m),
  };
}

export function applyDisplayScaleCssVars(target: HTMLElement, level: DisplayScaleLevel): void {
  const vars = displayScaleCssVars(level);
  for (const [key, value] of Object.entries(vars)) {
    target.style.setProperty(key, value);
  }
  target.dataset.displayScale = level;
}

export function clearDisplayScaleCssVars(target: HTMLElement): void {
  const vars = displayScaleCssVars(DEFAULT_DISPLAY_SCALE_LEVEL);
  for (const key of Object.keys(vars)) {
    target.style.removeProperty(key);
  }
  delete target.dataset.displayScale;
}

export function clampDisplayScaleLevel(level: string | null | undefined): DisplayScaleLevel {
  if (level && DISPLAY_SCALE_LEVELS.includes(level as DisplayScaleLevel)) {
    return level as DisplayScaleLevel;
  }
  return DEFAULT_DISPLAY_SCALE_LEVEL;
}

export function stepDisplayScaleLevel(level: DisplayScaleLevel, direction: 1 | -1): DisplayScaleLevel {
  const idx = DISPLAY_SCALE_LEVELS.indexOf(level);
  const next = Math.min(DISPLAY_SCALE_LEVELS.length - 1, Math.max(0, idx + direction));
  return DISPLAY_SCALE_LEVELS[next] ?? DEFAULT_DISPLAY_SCALE_LEVEL;
}

export function catalogColumnDeltaForScale(level: DisplayScaleLevel): number {
  return DISPLAY_SCALE_META[level].columnDelta;
}
