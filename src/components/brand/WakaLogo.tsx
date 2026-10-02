import type { ImgHTMLAttributes } from "react";
import clsx from "clsx";
import { useAppTheme } from "../../context/AppThemeProvider";
import { publicAssetUrl } from "../../lib/publicAssetUrl";

/**
 * DKASU lockup, derived from the supplied artwork (cropped and background-keyed — never redrawn).
 *
 * THE LOCKUP IS THEME-AWARE. The `on-light` (black) artwork is the light-mode default because the
 * in-app surfaces that render it sit on a light/cream background (`#fffaf5` splash, auth cards,
 * builder shell). In DARK MODE that artwork disappears against the dark background, so the official
 * white transparent lockup is used instead.
 *
 * The choice comes from the app's real theme state (`useAppTheme().resolved`) — the same state the
 * theme toggle drives — NOT from a `prefers-color-scheme` media query, so the logo swaps the
 * instant the in-app toggle flips.
 *
 * Both files are used exactly as supplied: never recoloured, redrawn, cropped or distorted. Each
 * keeps its own intrinsic aspect ratio under the shared height classes.
 */
const LOGO_SRC = publicAssetUrl("brand/dkasu/logo-horizontal-on-light-transparent.png");
/**
 * The SAME horizontal lockup in white (symbol + wordmark + tagline, transparent), tightly cropped
 * from the supplied `DKASU_White_Logo_Transparent.png` master — only the colour differs from the
 * light lockup, never the layout or proportions.
 */
const LOGO_SRC_DARK = publicAssetUrl("brand/dkasu/logo-horizontal-on-dark-transparent.png");
/** Real aspect of each lockup, so the reserved box matches and layout does not shift. */
const LOGO_W = 834;
const LOGO_H = 258;
const LOGO_DARK_W = 835;
const LOGO_DARK_H = 262;

type LogoProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Tailwind height class, e.g. `h-12` */
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "splash";
  /** Cream-backed app icon (default) vs transparent W-only mark */
  variant?: "app" | "symbol";
};

const SIZE_CLASS: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: "h-8",
  sm: "h-10",
  md: "h-14",
  lg: "h-20",
  xl: "h-28",
  splash: "h-[min(42vh,300px)]",
};

const SYMBOL_BY_SIZE: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: publicAssetUrl("brand/d-icon-32-cream.png"),
  sm: publicAssetUrl("brand/d-icon-48-cream.png"),
  md: publicAssetUrl("brand/d-icon-64-cream.png"),
  lg: publicAssetUrl("brand/d-icon-96-cream.png"),
  xl: publicAssetUrl("brand/d-icon-128-cream.png"),
  splash: LOGO_SRC,
};

/** Full DKASU POS logo (PNG) — use in app shell, auth, and marketing headers */
export function WakaPosLogo({
  size = "md",
  variant = "app",
  className,
  alt = "DKASU POS",
  ...rest
}: LogoProps) {
  const { resolved } = useAppTheme();
  const isSymbol = variant === "symbol";
  const isDark = resolved === "dark";
  // The compact W mark keeps its cream tile in both themes; only the full lockup swaps.
  const src = isSymbol ? SYMBOL_BY_SIZE[size] : isDark ? LOGO_SRC_DARK : LOGO_SRC;
  return (
    <img
      src={src}
      alt={alt}
      width={isSymbol ? 512 : isDark ? LOGO_DARK_W : LOGO_W}
      height={isSymbol ? 512 : isDark ? LOGO_DARK_H : LOGO_H}
      decoding="async"
      className={clsx("w-auto max-w-full object-contain object-center", SIZE_CLASS[size], className)}
      {...rest}
    />
  );
}

/** Compact W mark for nav, sidebar, and tight UI (optimized small PNGs). */
export function WakaSymbolIcon({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  return <WakaPosLogo size={size} variant="symbol" className={className} aria-hidden alt="" />;
}

/** @deprecated Use WakaSymbolIcon or DKASU POSLogo */
export function WakaMarkIcon({ className }: { className?: string }) {
  return <WakaSymbolIcon className={className} size="sm" />;
}

/** Marketing header wordmark */
export function WakaBrandWordmark({ className, size = "md" }: { className?: string; size?: LogoProps["size"] }) {
  return <WakaPosLogo size={size} className={className} />;
}
