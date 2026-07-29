/**
 * Phase 29.1 — WCAG contrast guards for semantic theme tokens.
 * Values mirror src/index.css :root / .dark (keep in sync when retuning).
 */
import { describe, expect, it } from "vitest";

type Hsl = readonly [h: number, s: number, l: number];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = h / 360;
  const ss = s / 100;
  const ll = l / 100;
  if (ss === 0) return [ll, ll, ll];
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: Hsl, b: Hsl): number {
  const L1 = relativeLuminance(hslToRgb(...a));
  const L2 = relativeLuminance(hslToRgb(...b));
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Light :root (Phase 29.1) */
const light = {
  background: [30, 15, 96] as Hsl,
  card: [30, 20, 99] as Hsl,
  mutedForeground: [20, 10, 44] as Hsl,
  success: [152, 72, 28] as Hsl,
  successMuted: [152, 40, 92] as Hsl,
  danger: [0, 72, 45] as Hsl,
  dangerMuted: [0, 86, 94] as Hsl,
  info: [199, 89, 34] as Hsl,
  infoMuted: [204, 94, 94] as Hsl,
  warningForeground: [26, 80, 14] as Hsl,
  warningMuted: [48, 96, 89] as Hsl,
  white: [0, 0, 100] as Hsl,
};

/** Dark .dark (Phase 29.1) */
const dark = {
  background: [24, 10, 6] as Hsl,
  card: [24, 12, 13] as Hsl,
  elevated: [24, 13, 18] as Hsl,
  dialog: [24, 13, 15] as Hsl,
  border: [24, 10, 28] as Hsl,
  mutedForeground: [30, 8, 72] as Hsl,
  success: [152, 55, 55] as Hsl,
  successMuted: [152, 35, 18] as Hsl,
  danger: [0, 72, 65] as Hsl,
  dangerMuted: [0, 40, 18] as Hsl,
  info: [199, 89, 62] as Hsl,
  infoMuted: [199, 40, 18] as Hsl,
  warningForeground: [48, 96, 92] as Hsl,
  warningMuted: [38, 40, 18] as Hsl,
};

describe("themeContrast Phase 29.1", () => {
  it("light muted-foreground meets AA on background and card", () => {
    expect(contrastRatio(light.background, light.mutedForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.card, light.mutedForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("light status text on muted fills meets AA", () => {
    expect(contrastRatio(light.successMuted, light.success)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.dangerMuted, light.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.infoMuted, light.info)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.warningMuted, light.warningForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("light solid status fills keep white readable", () => {
    expect(contrastRatio(light.success, light.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.danger, light.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.info, light.white)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark status text on muted fills meets AA", () => {
    expect(contrastRatio(dark.successMuted, dark.success)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.dangerMuted, dark.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.infoMuted, dark.info)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.warningMuted, dark.warningForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark muted-foreground meets AA on card", () => {
    expect(contrastRatio(dark.card, dark.mutedForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark surface hierarchy separates bg < card < dialog ≤ elevated and strengthens borders", () => {
    const cardBg = contrastRatio(dark.background, dark.card);
    const elevBg = contrastRatio(dark.background, dark.elevated);
    const borderBg = contrastRatio(dark.background, dark.border);
    const dialogBg = contrastRatio(dark.background, dark.dialog);
    // Absolute ratios between dark greys stay modest; guard relative ordering + border strength.
    expect(elevBg).toBeGreaterThan(cardBg);
    expect(dialogBg).toBeGreaterThanOrEqual(cardBg);
    expect(borderBg).toBeGreaterThan(1.8);
    expect(cardBg).toBeGreaterThan(1.15);
  });
});
