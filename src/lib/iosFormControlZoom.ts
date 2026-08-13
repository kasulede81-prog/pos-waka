/**
 * Phase MOBILE-UX-1.0 — iOS Safari zooms the page when a focused form control
 * is rendered below 16px, then often leaves that zoom in place (horizontal clip).
 *
 * Display Scale tokens are density, not browser zoom. `--ds-font-base` is 0.875rem
 * (14px at a 16px root; ~12.3px in Compact). `.pos-ds-input` uses that token.
 */

import { displayScaleCssVars, type DisplayScaleLevel } from "./displayScale/scaleTokens";

export const IOS_FORM_CONTROL_AUTOZOOM_MIN_PX = 16;

const ROOT_PX = 16;

export function remTokenToPx(remValue: string, rootPx = ROOT_PX): number {
  const n = parseFloat(remValue);
  if (!Number.isFinite(n)) return NaN;
  return n * rootPx;
}

export function displayScaleInputFontPx(level: DisplayScaleLevel, rootPx = ROOT_PX): number {
  return remTokenToPx(displayScaleCssVars(level)["--ds-font-base"], rootPx);
}

export function isIosInputAutoZoomRisk(fontPx: number): boolean {
  return fontPx < IOS_FORM_CONTROL_AUTOZOOM_MIN_PX;
}

export function cashierDensityInputAutoZoomRisks(): Record<DisplayScaleLevel, boolean> {
  return {
    compact: isIosInputAutoZoomRisk(displayScaleInputFontPx("compact")),
    normal: isIosInputAutoZoomRisk(displayScaleInputFontPx("normal")),
    large: isIosInputAutoZoomRisk(displayScaleInputFontPx("large")),
    extra_large: isIosInputAutoZoomRisk(displayScaleInputFontPx("extra_large")),
  };
}

export function viewportMetaAllowsAccessibilityZoom(content: string): boolean {
  const normalized = content.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("user-scalable=no") || normalized.includes("user-scalable=0")) return false;
  if (normalized.includes("maximum-scale=1") || normalized.includes("maximum-scale=1.0")) return false;
  return normalized.includes("width=device-width") && normalized.includes("initial-scale=1");
}
