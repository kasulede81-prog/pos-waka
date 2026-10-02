import type { ImgHTMLAttributes } from "react";
import clsx from "clsx";
import { publicAssetUrl } from "../../lib/publicAssetUrl";

/**
 * DKASU lockup, derived from the supplied artwork (cropped and background-keyed — never redrawn).
 *
 * The `on-light` variant is the DEFAULT because every in-app surface that renders this logo sits on
 * a light/cream background (`#fffaf5` splash, auth cards, builder shell). The supplied on-dark
 * lockup lives at `brand/dkasu/logo-horizontal-on-dark.png` for dark contexts.
 */
const LOGO_SRC = publicAssetUrl("brand/dkasu/logo-horizontal-on-light-transparent.png");
/** Real aspect of the lockup, so the reserved box matches and layout does not shift. */
const LOGO_W = 834;
const LOGO_H = 258;

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
  const src = variant === "symbol" ? SYMBOL_BY_SIZE[size] : LOGO_SRC;
  return (
    <img
      src={src}
      alt={alt}
      width={variant === "symbol" ? 512 : LOGO_W}
      height={variant === "symbol" ? 512 : LOGO_H}
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
