import type { ImgHTMLAttributes } from "react";
import clsx from "clsx";

const LOGO_SRC = "/waka-logo.png";

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
  splash: "h-[min(52vh,320px)]",
};

const SYMBOL_BY_SIZE: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: "/brand/w-icon-32-cream.png",
  sm: "/brand/w-icon-48-cream.png",
  md: "/brand/w-icon-64-cream.png",
  lg: "/brand/w-icon-96-cream.png",
  xl: "/brand/w-icon-128-cream.png",
  splash: LOGO_SRC,
};

/** Full Waka POS logo (PNG) — use in app shell, auth, and marketing headers */
export function WakaPosLogo({
  size = "md",
  variant = "app",
  className,
  alt = "Waka POS",
  ...rest
}: LogoProps) {
  const src = variant === "symbol" ? SYMBOL_BY_SIZE[size] : LOGO_SRC;
  return (
    <img
      src={src}
      alt={alt}
      width={512}
      height={512}
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

/** @deprecated Use WakaSymbolIcon or WakaPosLogo */
export function WakaMarkIcon({ className }: { className?: string }) {
  return <WakaSymbolIcon className={className} size="sm" />;
}

/** Marketing header wordmark */
export function WakaBrandWordmark({ className, size = "md" }: { className?: string; size?: LogoProps["size"] }) {
  return <WakaPosLogo size={size} className={className} />;
}
