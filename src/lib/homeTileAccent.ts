import type { CSSProperties } from "react";
import type { LauncherTileColor } from "../types";
import { hexToRgb, normalizeShelfHex, PRESET_SHELF_HEX } from "./shelfColor";

export const HOME_TILE_ACCENT_PRESETS: LauncherTileColor[] = [
  "default",
  "red",
  "orange",
  "blue",
  "green",
  "purple",
];

const ICON_ON_DARK = "#ffffff";
const ICON_ON_LIGHT = "#1c1917";

export type HomeTileAccentInput = {
  color?: LauncherTileColor | null;
  customColor?: string | null;
};

export type HomeTileAccent = {
  hex: string;
  iconHex: string;
  source: "custom" | "preset";
  preset: LauncherTileColor;
  wellStyle: CSSProperties;
  railStyle: CSSProperties;
};

function channelToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance for a normalized `#rrggbb` hex. */
export function hexRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function hexContrastRatio(a: string, b: string): number {
  const l1 = hexRelativeLuminance(a);
  const l2 = hexRelativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick white or near-black icon/foreground for a filled accent well. */
export function readableOnHex(backgroundHex: string): string {
  const vsWhite = hexContrastRatio(backgroundHex, ICON_ON_DARK);
  const vsDark = hexContrastRatio(backgroundHex, ICON_ON_LIGHT);
  return vsWhite >= vsDark ? ICON_ON_DARK : ICON_ON_LIGHT;
}

/**
 * Shared Home tile accent for live Home and Settings preview.
 * Card fill stays `bg-card`; only icon well + left rail use this color.
 */
export function resolveHomeTileAccent(tile: HomeTileAccentInput): HomeTileAccent {
  const preset: LauncherTileColor = tile.color ?? "default";
  const customHex = normalizeShelfHex(tile.customColor);
  const hex = customHex ?? PRESET_SHELF_HEX[preset];
  const iconHex = readableOnHex(hex);
  return {
    hex,
    iconHex,
    source: customHex ? "custom" : "preset",
    preset,
    wellStyle: {
      backgroundColor: hex,
      color: iconHex,
    },
    railStyle: {
      backgroundColor: hex,
    },
  };
}
