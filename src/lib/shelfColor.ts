import type { PosShelfColor } from "../types";

export const PRESET_SHELF_HEX: Record<PosShelfColor, string> = {
  default: "#78716c",
  red: "#e11d48",
  orange: "#ea580c",
  blue: "#0284c7",
  green: "#059669",
  purple: "#7c3aed",
};

/** Light surround behind the live shop preview on the home hero. */
export const DEFAULT_HOME_HERO_PREVIEW_BG = "#ecfdf5";

export const HOME_HERO_PREVIEW_BG_PRESETS = [
  { id: "green", hex: DEFAULT_HOME_HERO_PREVIEW_BG },
  { id: "blue", hex: "#eff6ff" },
  { id: "orange", hex: "#fff7ed" },
  { id: "purple", hex: "#f5f3ff" },
  { id: "red", hex: "#fef2f2" },
  { id: "white", hex: "#ffffff" },
] as const;

export function resolveHomeHeroPreviewBgColor(custom: string | null | undefined): string {
  return normalizeShelfHex(custom) ?? DEFAULT_HOME_HERO_PREVIEW_BG;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeShelfHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toByte = (n: number) => Math.round((n + m) * 255);
  const rr = toByte(r).toString(16).padStart(2, "0");
  const gg = toByte(g).toString(16).padStart(2, "0");
  const bb = toByte(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const byte = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Pastel tile background + readable text from a picked hex. */
export function shelfTileColorStyle(hex: string, featured: boolean): {
  background: string;
  borderColor: string;
  color: string;
  boxShadow?: string;
} {
  const base = hexToRgb(hex);
  const lightA = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.88);
  const lightB = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.78);
  const border = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.55);
  const text = mixRgb(base, { r: 0, g: 0, b: 0 }, 0.72);
  return {
    background: `linear-gradient(to bottom right, ${rgbToHex(lightA)}, ${rgbToHex(lightB)})`,
    borderColor: rgbToHex(border),
    color: rgbToHex(text),
    ...(featured ? { boxShadow: `inset 0 0 0 1px ${rgbToHex(mixRgb(base, { r: 255, g: 255, b: 255 }, 0.35))}` } : {}),
  };
}

/** Bold tile background + white text (home menu tiles — like the Sell hero). */
export function launcherBoldTileColorStyle(hex: string, pinned: boolean): {
  background: string;
  borderColor: string;
  color: string;
  boxShadow: string;
} {
  const base = hexToRgb(hex);
  const gradientFrom = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.12);
  const gradientTo = mixRgb(base, { r: 0, g: 0, b: 0 }, 0.22);
  const glow = mixRgb(base, { r: 0, g: 0, b: 0 }, 0.35);
  return {
    background: `linear-gradient(to bottom right, ${rgbToHex(gradientFrom)}, ${rgbToHex(gradientTo)})`,
    borderColor: "rgba(255,255,255,0.3)",
    color: "#ffffff",
    boxShadow: pinned
      ? `0 8px 28px ${rgbToHex(glow)}66, inset 0 0 0 2px rgba(255,255,255,0.35)`
      : `0 8px 28px ${rgbToHex(glow)}55`,
  };
}

export function resolveShelfHex(customColor: string | null | undefined, preset: PosShelfColor): string {
  return normalizeShelfHex(customColor) ?? PRESET_SHELF_HEX[preset];
}
